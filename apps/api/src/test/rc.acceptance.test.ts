/**
 * A9.8 Release-candidate end-to-end acceptance index (mandate §11 A9.8).
 *
 * Ties the release-candidate scenarios to the TriForge 1.0 Definition of Done. The heavy
 * real-git scenarios live in their own suites (run by CI every PR); this index asserts
 * they are present AND re-asserts the cross-cutting RC invariants by composing the real
 * building blocks deterministically:
 *   1. writable run end-to-end in an isolated worktree   → writableRun.e2e.test.ts
 *   2. competitive run, winner by evidence               → competitiveRun.e2e.test.ts
 *   3. a run that must NOT merge (blocked/rejected)       → here (governance) + the E2E
 *   4. quota/auth degradation pauses / hard-stops         → here (routing) + chaos
 *   5. recovery after restart (ledger reload + verify)    → here (ledger) + recovery suite
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityBinding, FindingsSummary, ProviderId, TestSummary } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import { QuotaManager } from "../providers/quota/index.js";
import { profileTask, routeQuotaAware } from "../orchestration/index.js";
import { decideVerdict, type GovernanceInputs } from "../execution/governance/index.js";
import { MutationLedger, type MutationLedgerOptions } from "../execution/ledger/mutationLedger.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const RC_SCENARIO_SUITES = [
  "apps/api/src/test/writableRun.e2e.test.ts", // (1) + (3) negative no-merge
  "apps/api/src/test/competitiveRun.e2e.test.ts", // (2)
  "apps/api/src/test/chaos.failureSurface.test.ts", // (4) degradation, bounded failures
  "apps/api/src/test/security.acceptance.test.ts", // A0.5 SATs
  "apps/api/src/test/recovery.restart.test.ts", // (5)
  "apps/api/src/test/runReconstruction.test.ts" // observability
];

describe("A9.8 RC acceptance — the release-candidate scenario suite is present", () => {
  it("every release-candidate scenario suite exists in the repo (CI runs them)", () => {
    for (const suite of RC_SCENARIO_SUITES) {
      expect(existsSync(path.join(repoRoot, suite)), suite).toBe(true);
    }
  });
});

// --- RC invariant compositions (deterministic) -------------------------------

const PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];
function quota(): QuotaManager {
  const m = new QuotaManager();
  m.configureBudget({ provider: "codex", capacity: 100, unit: "codex_invocations" });
  m.configureBudget({ provider: "claude", capacity: 100, unit: "claude_invocations" });
  return m;
}
function prof() {
  return profileTask({ objective: "ship", scope: [], nonGoals: [], invariants: [], acceptanceCriteria: [], failureModes: [], relationToPriorDecisions: [] });
}

const BINDING: CapabilityBinding = {
  threat: ["T-INT-04"],
  control: ["A5.5 ledger", "A5.6 gates"],
  milestone: "A5.8",
  verification: ["rc.acceptance.test.ts"],
  recovery: "revert",
  residualRisk: "RR-4"
};
const NO_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };
const TESTS: TestSummary = { passed: 10, failed: 0, skipped: 0, total: 10 };
function gInputs(over: Partial<GovernanceInputs> = {}): GovernanceInputs {
  return {
    task: "t", specHash: "s", acceptanceCriteria: ["x"], contextHash: "c", owner: "codex", reviewer: "claude",
    worktree: "/wt", branch: "triforge/run1/t", diffHash: "d", ledgerHeadHash: "l", ledgerTampered: false,
    gateTampered: false, gatesPassed: true, gateTestedDiffHash: "d", gateResultHash: "g", findings: NO_FINDINGS,
    tests: TESTS, repairState: "accepted", repairRounds: 1, quota: null, unresolvedRisks: [], capabilityBinding: BINDING, ...over
  };
}

describe("A9.8 RC invariants — degradation, no-false-merge, recovery", () => {
  it("RC-4: a quota/auth degradation pauses or hard-stops (never a fabricated route)", () => {
    const exhausted = quota();
    exhausted.hardStop("codex", "x");
    exhausted.hardStop("claude", "x");
    const p = prof();
    expect(routeQuotaAware({ profile: p.profile, extended: p.extended, providers: PROVIDERS, quota: exhausted, authState: { codex: "authenticated", claude: "authenticated" } }).status).toBe("hard_stop");
    expect(routeQuotaAware({ profile: p.profile, extended: p.extended, providers: PROVIDERS, quota: quota(), authState: { codex: "expired", claude: "expired" } }).status).toBe("paused");
  });

  it("RC-3: a run with a blocker / tampered ledger NEVER yields merge", () => {
    expect(decideVerdict(gInputs()).verdict).toBe("merge"); // clean run merges
    expect(decideVerdict(gInputs({ findings: { ...NO_FINDINGS, blocker: 1 } })).verdict).not.toBe("merge");
    expect(decideVerdict(gInputs({ ledgerTampered: true })).verdict).not.toBe("merge");
    expect(decideVerdict(gInputs({ gatesPassed: false })).verdict).not.toBe("merge");
  });

  it("RC-5: a run recovers after a restart (ledger reloads + verifies its chain)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "triforge-rc-"));
    try {
      const p = path.join(dir, "m.jsonl");
      const opts: MutationLedgerOptions = { runId: "r", taskId: "t", owner: "codex", worktree: "/wt", branch: "b", clock: new ManualClock(0), ledgerPath: p };
      const first = new MutationLedger(opts);
      await first.record({ file: "src/a.ts", operation: "modify", hashBefore: "h0", hashAfter: "h1", tool: "codex", reason: "edit" });
      const reloaded = await MutationLedger.load(p, opts);
      expect(reloaded.verifyChain()).toBe(true);
      expect(reloaded.entries()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
