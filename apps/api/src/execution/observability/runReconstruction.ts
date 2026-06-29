/**
 * A9.5 Observability — run reconstruction (mandate §11 A9.5).
 *
 * A run must be FULLY RECONSTRUCTABLE from its artifacts + mutation ledger + ordered event
 * stream, with NO hidden state: every mutation is attributable (owner / tool / reason /
 * sequence), the events form a gapless ordered stream with lifecycle bookends, the
 * recorded diff reconciles to the hash bound in governance, and every real worktree change
 * is attributed to a ledger entry (an unrecorded mutation = hidden state). Pure +
 * deterministic.
 */

export interface LedgerAttribution {
  file: string;
  owner: string;
  tool: string;
  reason: string;
  sequence: number;
}

export interface EventRef {
  sequenceNumber: number;
  type: string;
}

export interface RunObservabilityInput {
  ledger: LedgerAttribution[];
  events: EventRef[];
  /** Diff hash recorded by the ledger (A5.5). */
  recordedDiffHash: string;
  /** Diff hash bound in the GovernanceDecision (A5.8). */
  governanceDiffHash: string;
  /** Workspace-relative paths actually changed in the worktree. */
  worktreeChangedFiles: string[];
  /** Event types that must bookend a run (default: run.started + a terminal event). */
  startEventType?: string;
  terminalEventTypes?: string[];
}

export interface RunObservabilityReport {
  /** Ledger entries missing any attribution field. */
  unattributedEntries: number[];
  /** Worktree changes with NO ledger entry → hidden state. */
  unattributedMutations: string[];
  eventSequenceGapless: boolean;
  hasLifecycleBookends: boolean;
  diffReconciles: boolean;
  fullyAttributed: boolean;
  reconstructable: boolean;
}

const DEFAULT_START = "run.started";
const DEFAULT_TERMINALS = ["run.completed", "run.failed"];

function gapless(events: EventRef[]): boolean {
  if (events.length === 0) {
    return true;
  }
  const seqs = [...events].map((e) => e.sequenceNumber).sort((a, b) => a - b);
  for (let i = 0; i < seqs.length; i += 1) {
    if (seqs[i] !== seqs[0] + i) {
      return false;
    }
  }
  return true;
}

export function reconstructRun(input: RunObservabilityInput): RunObservabilityReport {
  const start = input.startEventType ?? DEFAULT_START;
  const terminals = input.terminalEventTypes ?? DEFAULT_TERMINALS;

  // Attribution: every ledger entry must carry owner + tool + reason + a sequence.
  const unattributedEntries: number[] = [];
  input.ledger.forEach((e, i) => {
    if (!e.owner || !e.tool || !e.reason || typeof e.sequence !== "number") {
      unattributedEntries.push(i);
    }
  });

  // No hidden state: every real worktree change must map to a ledger entry.
  const ledgerFiles = new Set(input.ledger.map((e) => e.file));
  const unattributedMutations = input.worktreeChangedFiles.filter((f) => !ledgerFiles.has(f));

  const types = new Set(input.events.map((e) => e.type));
  const hasLifecycleBookends = types.has(start) && terminals.some((t) => types.has(t));
  const eventSequenceGapless = gapless(input.events);
  const diffReconciles = input.recordedDiffHash === input.governanceDiffHash;
  const fullyAttributed = unattributedEntries.length === 0;

  const reconstructable =
    fullyAttributed &&
    unattributedMutations.length === 0 &&
    eventSequenceGapless &&
    hasLifecycleBookends &&
    diffReconciles;

  return {
    unattributedEntries,
    unattributedMutations,
    eventSequenceGapless,
    hasLifecycleBookends,
    diffReconciles,
    fullyAttributed,
    reconstructable
  };
}
