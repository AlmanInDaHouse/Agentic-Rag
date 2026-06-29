import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import {
  MutationLedger,
  redactSecrets,
  reconcile,
  computeWorktreeChanges,
  diffHash,
  type MutationInput,
  type MutationLedgerOptions
} from "../execution/ledger/index.js";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function git(cwd: string, args: string[]): void {
  spawnSync("git", args, { cwd, encoding: "utf8" });
}

function ledgerOpts(over: Partial<MutationLedgerOptions> = {}): MutationLedgerOptions {
  return {
    runId: "run1",
    taskId: "taskA",
    owner: "codex",
    worktree: "/wt",
    branch: "triforge/run1/taskA",
    clock: new ManualClock(),
    ...over
  };
}

function entry(file: string, hashAfter: string | null, over: Partial<MutationInput> = {}): MutationInput {
  return {
    file,
    operation: hashAfter === null ? "delete" : "modify",
    hashBefore: null,
    hashAfter,
    tool: "codex",
    reason: "change",
    ...over
  };
}

describe("MutationLedger — append-only hash chain", () => {
  it("records entries with a verifiable hash chain", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    await ledger.record(entry("src/b.ts", "hash-b"));
    expect(ledger.entries()).toHaveLength(2);
    expect(ledger.entries()[0].sequence).toBe(0);
    expect(ledger.entries()[1].prevHash).toBe(ledger.entries()[0].entryHash);
    expect(ledger.verifyChain()).toBe(true);
    expect(ledger.headHash()).toBe(ledger.entries()[1].entryHash);
  });

  it("detects tampering (a mutated entry breaks the chain)", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    await ledger.record(entry("src/b.ts", "hash-b"));
    // Tamper with a recorded entry's content after the fact.
    (ledger.entries()[0] as { hashAfter: string | null }).hashAfter = "forged";
    expect(ledger.verifyChain()).toBe(false);
  });

  it("redacts secrets in the reason before persisting, keeping a full-content hash", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    const e = await ledger.record(entry("src/a.ts", "hash-a", { reason: "set token=ghp_ABCDEFGHIJKLMNOPQRSTU and key" }));
    expect(e.reason).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTU");
    expect(e.reason).toContain("«redacted»");
    expect(e.reasonFullHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redactSecrets masks common secret shapes", () => {
    expect(redactSecrets("sk-ABCDEFGHIJKLMNOP1234")).toBe("«redacted»");
    expect(redactSecrets("api_key=supersecretvalue")).toContain("«redacted»");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});

describe("MutationLedger — persistence & crash recovery", () => {
  it("persists to JSONL and reloads with a verified chain", async () => {
    const ledgerPath = path.join(makeTempDir("triforge-ledger-"), "ledger.jsonl");
    const opts = ledgerOpts({ ledgerPath });
    const ledger = new MutationLedger(opts);
    await ledger.record(entry("src/a.ts", "hash-a"));
    await ledger.record(entry("src/b.ts", "hash-b"));

    const reloaded = await MutationLedger.load(ledgerPath, opts);
    expect(reloaded.entries()).toHaveLength(2);
    expect(reloaded.verifyChain()).toBe(true);
    expect(reloaded.headHash()).toBe(ledger.headHash());
  });

  it("throws when a persisted chain is broken", async () => {
    const dir = makeTempDir("triforge-ledger-");
    const ledgerPath = path.join(dir, "ledger.jsonl");
    const opts = ledgerOpts({ ledgerPath });
    const ledger = new MutationLedger(opts);
    const e0 = await ledger.record(entry("src/a.ts", "hash-a"));
    // Corrupt the persisted line (break the chain).
    writeFileSync(ledgerPath, `${JSON.stringify({ ...e0, entryHash: "tampered" })}\n`);
    await expect(MutationLedger.load(ledgerPath, opts)).rejects.toThrow(/chain is broken/);
  });
});

describe("reconcile — unattributed change detection (SAT-A5-6)", () => {
  it("marks a run clean when every change is recorded", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    const result = reconcile(ledger.entries(), [{ relPath: "src/a.ts", status: "modify", hash: "hash-a" }]);
    expect(result.tampered).toBe(false);
    expect(result.attributed).toHaveLength(1);
  });

  it("flags a worktree change with NO ledger entry as unattributed/tampered", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    const result = reconcile(ledger.entries(), [
      { relPath: "src/a.ts", status: "modify", hash: "hash-a" },
      { relPath: "src/sneaky.ts", status: "create", hash: "hash-x" }
    ]);
    expect(result.tampered).toBe(true);
    expect(result.unattributed.map((u) => u.relPath)).toEqual(["src/sneaky.ts"]);
  });

  it("flags a post-hash mismatch (modified after recording) as tampered", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    const result = reconcile(ledger.entries(), [{ relPath: "src/a.ts", status: "modify", hash: "DIFFERENT" }]);
    expect(result.tampered).toBe(true);
  });

  it("treats a reverted recorded file as stale, not tampered", async () => {
    const ledger = new MutationLedger(ledgerOpts());
    await ledger.record(entry("src/a.ts", "hash-a"));
    const result = reconcile(ledger.entries(), []);
    expect(result.tampered).toBe(false);
    expect(result.stale).toEqual(["src/a.ts"]);
  });
});

describe("diffHash — modification-after-review detection", () => {
  it("is order-independent and changes when a change differs", () => {
    const a = [
      { relPath: "src/a.ts", status: "modify" as const, hash: "h1" },
      { relPath: "src/b.ts", status: "create" as const, hash: "h2" }
    ];
    const reordered = [a[1], a[0]];
    expect(diffHash(a)).toBe(diffHash(reordered));
    const modified = [{ ...a[0], hash: "h1-changed" }, a[1]];
    expect(diffHash(modified)).not.toBe(diffHash(a));
  });
});

describe("computeWorktreeChanges — real git", () => {
  function makeRepo(): string {
    const repo = makeTempDir("triforge-ledger-repo-");
    git(repo, ["init", "-b", "main"]);
    git(repo, ["config", "user.email", "t@triforge.local"]);
    git(repo, ["config", "user.name", "T"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "init"]);
    return repo;
  }

  it("detects a modified + a new file with content hashes", async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 2;\n"); // modify
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 1;\n"); // create (untracked)
    const changes = await computeWorktreeChanges(new NodeGitRunner(), repo);
    const byPath = new Map(changes.map((c) => [c.relPath, c]));
    expect(byPath.get("src/a.ts")?.status).toBe("modify");
    expect(byPath.get("src/b.ts")?.status).toBe("create");
    expect(byPath.get("src/a.ts")?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reconciles the real worktree against an empty ledger as tampered (SAT-A5-6)", async () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 1;\n");
    const changes = await computeWorktreeChanges(new NodeGitRunner(), repo);
    const ledger = new MutationLedger(ledgerOpts({ worktree: repo }));
    const result = reconcile(ledger.entries(), changes);
    expect(result.tampered).toBe(true);
    expect(result.unattributed.some((u) => u.relPath === "src/b.ts")).toBe(true);

    // Now record the real change and reconcile → attributed.
    const real = changes.find((c) => c.relPath === "src/b.ts")!;
    const ledger2 = new MutationLedger(ledgerOpts({ worktree: repo }));
    await ledger2.record(entry("src/b.ts", real.hash, { operation: "create" }));
    expect(reconcile(ledger2.entries(), changes).tampered).toBe(false);
  });
});
