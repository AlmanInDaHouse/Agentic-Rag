/**
 * A10-W.8 — REAL collaboration modes on the native Windows host.
 *
 * verified_real_provider evidence for specialist_mode_real, pair_mode_real,
 * full_debate_mode_real and real_quota_usage_signals. Runs the read-only collaboration
 * runtime (`runSpecialist` / `runPair` / `runFullDebate`) with REAL Codex + Claude
 * adapters. Collaboration is READ-ONLY (no writes); writable execution is the W.7 pilot.
 *
 * DOUBLE-GATED: `win32` AND `TRIFORGE_REAL_PROVIDER=1`. Claude steps use `--model sonnet`
 * (per-provider model threading) to conserve the 7-day quota; codex (the default owner)
 * runs on its ChatGPT subscription. Run locally:
 *   $env:TRIFORGE_REAL_PROVIDER = "1"
 *   corepack pnpm --filter @triforge/api exec vitest run collaborationModes.host
 */

import { describe, expect, it } from "vitest";
import {
  RoutingDecisionSchema,
  TaskProfileSchema,
  TaskSpecificationSchema,
  type ProviderAdapter,
  type ProviderId,
  type RoutingDecision,
  type TaskProfile,
  type TaskSpecification
} from "@triforge/shared";
import { QuotaManager, type ProviderBudgetConfig } from "../providers/quota/index.js";
import { runFullDebate, runPair, runSpecialist } from "../orchestration/index.js";
import { createRealAdapter } from "../providers/real/index.js";

const RUN = process.platform === "win32" && process.env.TRIFORGE_REAL_PROVIDER === "1";
const MODELS: Partial<Record<ProviderId, string>> = { claude: "sonnet" }; // codex uses its default

function realAdapters(): Record<ProviderId, ProviderAdapter> {
  return { codex: createRealAdapter("codex"), claude: createRealAdapter("claude") };
}
function bigQuota(): QuotaManager {
  const m = new QuotaManager();
  for (const p of ["codex", "claude"] as ProviderId[]) {
    const cfg: ProviderBudgetConfig = { provider: p, capacity: 100, unit: `${p}_invocations` };
    const r = m.configureBudget(cfg);
    if (!r.ok) {
      throw new Error(`budget config failed: ${r.error.code}`);
    }
  }
  return m;
}
function profile(over: Partial<TaskProfile> = {}): TaskProfile {
  return TaskProfileSchema.parse({
    taskKind: "feature",
    complexity: "low",
    risk: "low",
    blastRadius: "file",
    reasoningDepthRequired: 0.1,
    repetitiveWorkRatio: 0.2,
    testBurden: 0.3,
    behavioralPreservationRequired: false,
    ...over
  });
}
function spec(): TaskSpecification {
  return TaskSpecificationSchema.parse({
    objective: "Add a small typed helper that formats a duration in ms as a human string.",
    acceptanceCriteria: ["returns '1s' for 1000", "returns '1m 1s' for 61000"]
  });
}
function routing(owner: ProviderId): RoutingDecision {
  return RoutingDecisionSchema.parse({
    preferredOwner: owner,
    assignedOwner: owner,
    capabilityScore: 0.9,
    quotaAvailabilityScore: 0.9,
    historicalPerformanceScore: 0.7,
    risk: "low",
    degradedFromPreferredOwner: false,
    reason: ["host pilot"],
    humanApprovalRequired: false
  });
}

function noWrites(steps: { events: { type: string }[] }[]): void {
  for (const s of steps) {
    for (const e of s.events) {
      expect(e.type).not.toBe("file.changed"); // collaboration is strictly read-only
    }
  }
}

describe.runIf(RUN)("A10-W.8 — real collaboration modes (verified_real_provider)", () => {
  it("Specialist with a real CODEX owner completes (owner-only on a low-risk task)", async () => {
    const r = await runSpecialist({
      profile: profile({ risk: "low" }),
      spec: spec(),
      routing: routing("codex"),
      adapters: realAdapters(),
      quota: bigQuota(),
      models: MODELS
    });
    // eslint-disable-next-line no-console
    console.log(`[Specialist/codex] status=${r.status} owner=${r.owner} steps=${r.steps.length} second=${r.secondProviderInvoked}`);
    expect(r.status).toBe("completed");
    expect(r.owner).toBe("codex");
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps.every((s) => !s.blocked)).toBe(true);
    noWrites(r.steps);
  }, 300_000);

  it("Specialist with a real CLAUDE owner (sonnet) completes", async () => {
    const r = await runSpecialist({
      profile: profile({ risk: "low" }),
      spec: spec(),
      routing: routing("claude"),
      adapters: realAdapters(),
      quota: bigQuota(),
      models: MODELS
    });
    // eslint-disable-next-line no-console
    console.log(`[Specialist/claude] status=${r.status} owner=${r.owner} steps=${r.steps.length}`);
    expect(r.status).toBe("completed");
    expect(r.owner).toBe("claude");
    noWrites(r.steps);
  }, 300_000);

  it("Pair: real codex owner + real claude critique completes; real usage/quota signals flow", async () => {
    const r = await runPair({
      profile: profile({ risk: "high", complexity: "high" }),
      spec: spec(),
      routing: routing("codex"),
      adapters: realAdapters(),
      quota: bigQuota(),
      models: MODELS
    });
    const claudeStep = r.steps.find((s) => s.provider === "claude");
    const claudeTypes = [...new Set((claudeStep?.events ?? []).map((e) => e.type))];
    // eslint-disable-next-line no-console
    console.log(`[Pair] status=${r.status} second=${r.secondProviderInvoked} claudeEvents=${JSON.stringify(claudeTypes)}`);
    expect(r.status).toBe("completed");
    expect(r.secondProviderInvoked).toBe(true);
    noWrites(r.steps);
    // real_quota_usage_signals: a real claude step surfaces a real usage signal.
    expect(claudeStep).toBeDefined();
    expect(claudeTypes).toContain("usage.updated");
  }, 420_000);

  it("Full Debate: two real independent plans + cross-review completes", async () => {
    const r = await runFullDebate({
      profile: profile({ taskKind: "architecture", risk: "high" }),
      spec: spec(),
      routing: routing("codex"),
      adapters: realAdapters(),
      quota: bigQuota(),
      models: MODELS
    });
    // eslint-disable-next-line no-console
    console.log(`[FullDebate] status=${r.status} plans=${r.plans.length} crossReviews=${r.crossReviews.length} second=${r.secondProviderInvoked}`);
    expect(r.status).toBe("completed");
    expect(r.plans.length).toBe(2);
    expect(r.crossReviews.length).toBeGreaterThanOrEqual(2);
    expect(r.secondProviderInvoked).toBe(true);
    noWrites(r.steps);
  }, 600_000);
});
