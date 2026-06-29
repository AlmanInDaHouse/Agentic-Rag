/**
 * A9.1 Failure & Chaos testing (mandate §11 A9.1).
 *
 * Composes the real runtime components (A5 repair loop + ledger reconciliation, A6
 * quota-aware routing, A1 event contract) under INJECTED FAILURES and asserts the
 * runtime DETECTS / BOUNDS / RECOVERS — producing a bounded, recorded terminal outcome,
 * never a crash or a fabricated success (no false-green). Deterministic (injected Clock;
 * no real processes — real-process chaos is exercised by the POSIX-guarded supervisor
 * tests in CI).
 */

import { describe, expect, it } from "vitest";
import type { FindingSeverity, ProviderId, ReviewFindings } from "@triforge/shared";
import { ProviderEventSchema } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import { RepairLoop, type RepairSteps } from "../execution/repair/repairLoop.js";
import { reconcile } from "../execution/ledger/reconcile.js";
import type { MutationEntry } from "../execution/ledger/mutationLedger.js";
import type { WorktreeChange } from "../execution/ledger/worktreeState.js";
import { QuotaManager } from "../providers/quota/index.js";
import { profileTask, routeQuotaAware } from "../orchestration/index.js";

// --- helpers ---------------------------------------------------------------

function findings(reviewer: ProviderId, severities: { severity: FindingSeverity; file?: string }[]): ReviewFindings {
  return {
    reviewer,
    summary: "chaos findings",
    findings: severities.map((s) => ({
      severity: s.severity,
      category: "chaos",
      file: s.file ?? null,
      line: null,
      evidence: "e",
      impact: "i",
      requiredAction: "fix",
      missingTest: null,
      confidence: 0.9
    }))
  };
}

function steps(over: Partial<RepairSteps>): RepairSteps {
  return {
    implement: async () => ({ diffHash: "h0", filesChanged: ["a.ts"], commandCount: 1, outputBytes: 10 }),
    runGates: async () => ({ overallStatus: "passed" as const }),
    review: async () => findings("codex", []),
    ...over
  };
}

function runRepair(s: Partial<RepairSteps>, limits: Partial<{ maxRounds: number; maxOutputBytes: number }> = {}, isCancelled?: () => boolean) {
  return new RepairLoop({
    steps: steps(s),
    limits: { maxRounds: 5, ...limits },
    clock: new ManualClock(0),
    isCancelled
  }).run();
}

function entry(file: string, hashAfter: string | null, operation: MutationEntry["operation"] = "modify"): MutationEntry {
  return { file, operation, hashAfter, hashBefore: null, tool: "codex", reason: "r", sequence: 0, runId: "run", taskId: "t", owner: "codex", worktree: "/wt", branch: "b", timestamp: "2026-06-30T00:00:00.000Z" } as unknown as MutationEntry;
}

function change(relPath: string, hash: string | null, status: WorktreeChange["status"] = "modify"): WorktreeChange {
  return { relPath, status, hash };
}

const PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];
function quota(): QuotaManager {
  const m = new QuotaManager();
  m.configureBudget({ provider: "codex", capacity: 100, unit: "codex_invocations" });
  m.configureBudget({ provider: "claude", capacity: 100, unit: "claude_invocations" });
  return m;
}
function prof() {
  return profileTask({ objective: "ship a feature", scope: [], nonGoals: [], invariants: [], acceptanceCriteria: [], failureModes: [], relationToPriorDecisions: [] });
}

// --- chaos cases -----------------------------------------------------------

describe("A9.1 chaos — repair loop bounds every failure mode (no false-green)", () => {
  it("PROVIDER CRASH: a throwing step ends 'failed', never accepted", async () => {
    const r = await runRepair({
      implement: async () => {
        throw new Error("provider crashed");
      }
    });
    expect(r.state).toBe("failed");
    expect(r.reason).toContain("provider crashed");
  });

  it("IGNORED CANCELLATION: a cancelled run terminates 'cancelled', no merge", async () => {
    const r = await runRepair({}, {}, () => true);
    expect(r.state).toBe("cancelled");
  });

  it("REPAIR EXHAUSTION (no progress): same diff + recurring findings → 'rejected'", async () => {
    const r = await runRepair({
      implement: async () => ({ diffHash: "stuck", filesChanged: ["a.ts"], commandCount: 1, outputBytes: 10 }),
      runGates: async () => ({ overallStatus: "failed" as const }),
      review: async () => findings("codex", [{ severity: "major" }])
    });
    expect(r.state).toBe("rejected");
    expect(r.rounds).toBeLessThanOrEqual(5);
  });

  it("OUTPUT FLOOD: exceeding the output budget ends 'exhausted'", async () => {
    const r = await runRepair(
      {
        implement: async () => ({ diffHash: "h1", filesChanged: ["a.ts"], commandCount: 1, outputBytes: 1_000_000 }),
        runGates: async () => ({ overallStatus: "failed" as const }),
        review: async () => findings("codex", [{ severity: "major" }])
      },
      { maxOutputBytes: 1000 }
    );
    expect(r.state).toBe("exhausted");
    expect(r.reason).toContain("output");
  });

  it("BLOCKER FINDING: a blocker ends 'blocked', never merged", async () => {
    const r = await runRepair({ review: async () => findings("claude", [{ severity: "blocker" }]) });
    expect(r.state).toBe("blocked");
  });
});

describe("A9.1 chaos — ledger reconciliation detects tampering (corrupted artifact / worktree)", () => {
  it("TAMPER: a worktree change with no ledger entry is unattributed → tampered", () => {
    const rec = reconcile([entry("src/a.ts", "h1")], [change("src/a.ts", "h1"), change("src/evil.ts", "hx", "create")]);
    expect(rec.tampered).toBe(true);
    expect(rec.unattributed.map((u) => u.relPath)).toContain("src/evil.ts");
  });

  it("CLEAN: every worktree change attributed to a ledger entry → not tampered", () => {
    const rec = reconcile([entry("src/a.ts", "h1")], [change("src/a.ts", "h1")]);
    expect(rec.tampered).toBe(false);
    expect(rec.unattributed).toHaveLength(0);
  });

  it("POST-HASH MISMATCH: a worktree hash differing from the ledger is unattributed", () => {
    const rec = reconcile([entry("src/a.ts", "h1")], [change("src/a.ts", "TAMPERED")]);
    expect(rec.tampered).toBe(true);
  });
});

describe("A9.1 chaos — routing hard-stops / pauses, never fabricates a route", () => {
  it("QUOTA EXHAUSTION: all providers hard-stopped → status 'hard_stop' (no paid fallback)", () => {
    const m = quota();
    m.hardStop("codex", "5h window exhausted");
    m.hardStop("claude", "weekly exhausted");
    const p = prof();
    const r = routeQuotaAware({ profile: p.profile, extended: p.extended, providers: PROVIDERS, quota: m, authState: { codex: "authenticated", claude: "authenticated" } });
    expect(r.status).toBe("hard_stop");
  });

  it("AUTH EXPIRY: no authenticated provider → status 'paused' (needs human)", () => {
    const p = prof();
    const r = routeQuotaAware({ profile: p.profile, extended: p.extended, providers: PROVIDERS, quota: quota(), authState: { codex: "expired", claude: "expired" } });
    expect(r.status).toBe("paused");
    expect(r.routing.humanApprovalRequired).toBe(true);
  });
});

describe("A9.1 chaos — malformed events are rejected, not silently accepted", () => {
  it("MALFORMED EVENT: an unknown type / negative sequence fails the A1 contract", () => {
    expect(ProviderEventSchema.safeParse({ type: "bogus_event", sequenceNumber: -1 }).success).toBe(false);
    expect(ProviderEventSchema.safeParse({}).success).toBe(false);
  });
});
