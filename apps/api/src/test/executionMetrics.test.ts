import { describe, expect, it } from "vitest";
import type { FindingsSummary, ProviderId } from "@triforge/shared";
import { MetricsStore, type RunMetric } from "../orchestration/index.js";

const NO_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };

function metric(over: Partial<RunMetric> = {}): RunMetric {
  return {
    runId: "run1",
    taskId: "taskA",
    taskType: "feature",
    owner: "codex" as ProviderId,
    reviewer: "claude" as ProviderId,
    providerVersions: { codex: "0.101.0" },
    mode: "specialist",
    firstPassSuccess: true,
    repairRounds: 0,
    findings: NO_FINDINGS,
    regressions: 0,
    wallTimeMs: 1000,
    commandCount: 2,
    filesChanged: 1,
    diffSize: 20,
    governanceDecision: "merge",
    mergeResult: "merged",
    rollback: false,
    failureReason: null,
    provenance: "re_derived",
    recordedAt: "2026-06-29T00:00:00.000Z",
    ...over
  };
}

describe("MetricsStore — protected execution metrics", () => {
  it("DEDUPLICATES: a repeat (runId, taskId) is idempotently ignored", () => {
    const store = new MetricsStore();
    expect(store.record(metric()).recorded).toBe(true);
    const dup = store.record(metric({ firstPassSuccess: false }));
    expect(dup.recorded).toBe(false);
    expect(dup.reason).toMatch(/duplicate/);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].firstPassSuccess).toBe(true); // the original, not the dup
  });

  it("does not let one run CONTAMINATE another (run-scoped keys)", () => {
    const store = new MetricsStore();
    store.record(metric({ runId: "run1", taskId: "t" }));
    store.record(metric({ runId: "run2", taskId: "t", firstPassSuccess: false }));
    expect(store.all()).toHaveLength(2);
    expect(store.aggregate().n).toBe(2);
  });

  it("EXCLUDES unverified provider-reported samples from aggregates (kept for audit)", () => {
    const store = new MetricsStore();
    store.record(metric({ runId: "r1", firstPassSuccess: true, provenance: "re_derived" }));
    store.record(metric({ runId: "r2", firstPassSuccess: false, provenance: "provider_reported" }));
    const agg = store.aggregate();
    expect(agg.n).toBe(1); // only the re-derived sample
    expect(agg.firstPassSuccessRate).toBe(1);
    expect(agg.excludedUnverified).toBe(1);
    expect(store.all()).toHaveLength(2); // both retained
  });

  it("reports UNKNOWN (never a fabricated 0) when there are no samples", () => {
    const store = new MetricsStore();
    const agg = store.aggregate({ taskType: "refactor" });
    expect(agg.n).toBe(0);
    expect(agg.firstPassSuccessRate).toBe("unknown");
    expect(agg.avgRepairRounds).toBe("unknown");
    expect(agg.mergeRate).toBe("unknown");
  });

  it("is APPEND-ONLY (no cherry-picking) and reports the sample count n", () => {
    const store = new MetricsStore();
    store.record(metric({ runId: "r1", firstPassSuccess: true }));
    store.record(metric({ runId: "r2", firstPassSuccess: false }));
    store.record(metric({ runId: "r3", firstPassSuccess: true }));
    const agg = store.aggregate();
    expect(agg.n).toBe(3); // all samples, none dropped
    expect(agg.firstPassSuccessRate).toBeCloseTo(2 / 3);
    expect(typeof (store as unknown as { delete?: unknown }).delete).toBe("undefined"); // no removal API
  });

  it("filters aggregates by task type + owner", () => {
    const store = new MetricsStore();
    store.record(metric({ runId: "r1", taskType: "feature", owner: "codex", repairRounds: 2 }));
    store.record(metric({ runId: "r2", taskType: "refactor", owner: "codex", repairRounds: 4 }));
    store.record(metric({ runId: "r3", taskType: "feature", owner: "claude", repairRounds: 1 }));
    const featCodex = store.aggregate({ taskType: "feature", owner: "codex" });
    expect(featCodex.n).toBe(1);
    expect(featCodex.avgRepairRounds).toBe(2);
  });
});
