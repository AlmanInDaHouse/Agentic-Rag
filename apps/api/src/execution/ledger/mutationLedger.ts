/**
 * Mutation Ledger (A5.5) — an append-only, hash-chained record of every file
 * mutation an owner makes inside a worktree (mandate §A5.5; threat-model T-INJ-11,
 * T-INT-04; SAT-A5-6).
 *
 * The ledger is INDEPENDENT evidence: it is later reconciled against the REAL
 * worktree (computed from git, not from provider narrative) so an unrecorded file
 * change — a forged structured result or an out-of-band mutation — is detected and
 * the run can be marked tampered (`reconcile.ts`). Each entry is chained
 * (`entryHash = H(entry || prevHash)`), so the append-only history is tamper-evident;
 * the head hash binds the diff to the `GovernanceDecision` (A5.8). Secrets are
 * redacted before anything is persisted, and oversized text is safely truncated
 * WITHOUT losing the integrity hash of the full content.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type MutationOperation = "create" | "modify" | "delete" | "rename";

export interface MutationInput {
  /** Workspace-relative path of the mutated file. */
  file: string;
  operation: MutationOperation;
  /** Content hash before the mutation (null for a create). */
  hashBefore: string | null;
  /** Content hash after the mutation (null for a delete). */
  hashAfter: string | null;
  /** For a rename, the previous path. */
  renamedFrom?: string;
  /** The command that produced the mutation, if any. */
  command?: string;
  /** The tool/agent that performed it. */
  tool: string;
  /** Why the mutation was made. Redacted before persistence. */
  reason: string;
  /** Related test ids/paths. */
  tests?: string[];
  /** Reference to the authorizing policy/role decision. */
  policyDecisionRef?: string;
}

export interface MutationEntry extends MutationInput {
  sequence: number;
  runId: string;
  taskId: string;
  owner: string;
  worktree: string;
  branch: string;
  timestamp: string;
  /** True when `reason` was truncated; `reasonFullHash` covers the original. */
  truncated: boolean;
  reasonFullHash: string;
  /** Hash of the previous entry (or the genesis seed for sequence 0). */
  prevHash: string;
  /** `H(canonical(entry without entryHash) || prevHash)`. */
  entryHash: string;
}

const GENESIS = "triforge-ledger-genesis";
const MAX_REASON_LENGTH = 4096;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// --- secret redaction ------------------------------------------------------
// Focused redactor for ledger persistence (mandate §A5.5 "no secrets without
// redaction"). The harness secretScan (A2.2) remains the detection gate; this masks
// the high-value shapes before they could be written to the ledger.

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g, // PEM
  // key/token/secret/password assignments → mask the value
  /(?<=\b(?:api[_-]?key|apikey|token|secret|password|passwd|credential|pat)\b\s*[:=]\s*['"]?)[^\s'"]{6,}/gi
];

/** Replace secret-shaped substrings with a redaction marker. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "«redacted»");
  }
  return out;
}

export interface MutationLedgerOptions {
  runId: string;
  taskId: string;
  owner: string;
  worktree: string;
  branch: string;
  clock: { iso(): string };
  /** When set, every entry is appended to this JSONL file (crash recovery). */
  ledgerPath?: string;
}

export class MutationLedger {
  private readonly opts: MutationLedgerOptions;
  private readonly entryList: MutationEntry[] = [];
  private prevHash = GENESIS;

  constructor(options: MutationLedgerOptions) {
    this.opts = options;
  }

  /** Append a mutation. Returns the chained, redacted, persisted entry. */
  async record(input: MutationInput): Promise<MutationEntry> {
    const reasonRaw = input.reason ?? "";
    const reasonFullHash = sha256(reasonRaw);
    const redacted = redactSecrets(reasonRaw);
    const truncated = redacted.length > MAX_REASON_LENGTH;
    const reason = truncated ? `${redacted.slice(0, MAX_REASON_LENGTH)}…[truncated]` : redacted;

    const base: Omit<MutationEntry, "entryHash"> = {
      ...input,
      reason,
      sequence: this.entryList.length,
      runId: this.opts.runId,
      taskId: this.opts.taskId,
      owner: this.opts.owner,
      worktree: this.opts.worktree,
      branch: this.opts.branch,
      timestamp: this.opts.clock.iso(),
      truncated,
      reasonFullHash,
      prevHash: this.prevHash
    };
    const entryHash = sha256(canonicalize(base) + this.prevHash);
    const entry: MutationEntry = { ...base, entryHash };

    this.entryList.push(entry);
    this.prevHash = entryHash;
    await this.persist(entry);
    return entry;
  }

  /** All entries in append order. */
  entries(): readonly MutationEntry[] {
    return this.entryList;
  }

  /** The head hash — binds the recorded diff to a GovernanceDecision. */
  headHash(): string {
    return this.prevHash;
  }

  /**
   * Recompute the chain and return false if any entry was altered or reordered
   * (tamper-evidence for the append-only history).
   */
  verifyChain(): boolean {
    let prev = GENESIS;
    for (let i = 0; i < this.entryList.length; i += 1) {
      const e = this.entryList[i];
      if (e.sequence !== i || e.prevHash !== prev) {
        return false;
      }
      const { entryHash, ...base } = e;
      if (sha256(canonicalize(base) + prev) !== entryHash) {
        return false;
      }
      prev = entryHash;
    }
    return true;
  }

  private async persist(entry: MutationEntry): Promise<void> {
    if (this.opts.ledgerPath === undefined) {
      return;
    }
    await fs.mkdir(path.dirname(this.opts.ledgerPath), { recursive: true });
    await fs.appendFile(this.opts.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /**
   * Reload a ledger from its JSONL file (crash recovery) and verify the chain.
   * Throws if the persisted chain is broken.
   */
  static async load(ledgerPath: string, options: MutationLedgerOptions): Promise<MutationLedger> {
    const ledger = new MutationLedger(options);
    let raw: string;
    try {
      raw = await fs.readFile(ledgerPath, "utf8");
    } catch {
      return ledger; // no file yet
    }
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      const entry = JSON.parse(line) as MutationEntry;
      ledger.entryList.push(entry);
      ledger.prevHash = entry.entryHash;
    }
    if (!ledger.verifyChain()) {
      throw new Error(`mutation ledger chain is broken: ${ledgerPath}`);
    }
    return ledger;
  }
}

/** Stable serialization (sorted keys) so the hash is order-independent. */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

export { sha256 as ledgerSha256 };
