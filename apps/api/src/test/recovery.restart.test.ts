/**
 * A9.4 Recovery & restart (mandate §11 A9.4).
 *
 * Asserts the runtime RECOVERS across a simulated restart: the A5.5 mutation ledger
 * reloads from its persisted JSONL and re-verifies the hash chain (a tampered/broken
 * chain THROWS, not silently loads); a reconstructed mutation set matches the recorded
 * one (no lost mutations); and secrets were redacted BEFORE persistence (nothing secret
 * on disk to recover). Worktree stale-detection / crash-recovery is covered by the A5.1
 * suite (real git worktrees, CI). Deterministic (injected Clock; real tmp fs).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { MutationLedger, type MutationInput, type MutationLedgerOptions } from "../execution/ledger/mutationLedger.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function ledgerPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-rec-"));
  tempDirs.push(dir);
  return path.join(dir, "mutations.jsonl");
}

function options(p: string): MutationLedgerOptions {
  return { runId: "run1", taskId: "taskA", owner: "codex", worktree: "/wt", branch: "triforge/run1/taskA", clock: new ManualClock(0), ledgerPath: p };
}

function mutation(file: string, hashAfter: string, reason = "edit"): MutationInput {
  return { file, operation: "modify", hashBefore: "h0", hashAfter, tool: "codex", reason };
}

describe("A9.4 recovery — the mutation ledger survives a restart", () => {
  it("reloads from its JSONL, verifies the chain, and reconstructs every mutation", async () => {
    const p = ledgerPath();
    const first = new MutationLedger(options(p));
    await first.record(mutation("src/a.ts", "h1"));
    await first.record(mutation("src/b.ts", "h2"));
    await first.record(mutation("src/c.ts", "h3"));
    const head = first.headHash();

    // Simulated restart: a fresh process reloads the ledger from disk.
    const reloaded = await MutationLedger.load(p, options(p));
    expect(reloaded.verifyChain()).toBe(true);
    expect(reloaded.headHash()).toBe(head); // chain head preserved
    expect(reloaded.entries().map((e) => e.file)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(reloaded.entries().map((e) => e.hashAfter)).toEqual(["h1", "h2", "h3"]);
  });

  it("REJECTS a corrupted persisted chain on reload (throws, never silently loads)", async () => {
    const p = ledgerPath();
    const first = new MutationLedger(options(p));
    await first.record(mutation("src/a.ts", "h1"));
    await first.record(mutation("src/b.ts", "h2"));

    // Tamper the persisted history: alter the first entry's recorded hash.
    const raw = readFileSync(p, "utf8");
    writeFileSync(p, raw.replace('"hashAfter":"h1"', '"hashAfter":"TAMPERED"'), "utf8");

    await expect(MutationLedger.load(p, options(p))).rejects.toThrow(/chain is broken/);
  });

  it("recovers gracefully from a missing ledger file (a run that never wrote)", async () => {
    const p = ledgerPath(); // file not created
    const reloaded = await MutationLedger.load(p, options(p));
    expect(reloaded.entries()).toHaveLength(0);
    expect(reloaded.verifyChain()).toBe(true);
  });

  it("persisted NO secret to recover (redaction happens before write)", async () => {
    const p = ledgerPath();
    const first = new MutationLedger(options(p));
    await first.record(mutation("src/a.ts", "h1", "set token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX"));

    const onDisk = readFileSync(p, "utf8");
    expect(onDisk).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWX");

    const reloaded = await MutationLedger.load(p, options(p));
    expect(reloaded.entries()[0].reason).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWX");
  });
});
