import { describe, expect, it } from "vitest";
import type { FindingsSummary, ProviderId } from "@triforge/shared";
import {
  MetricsStore,
  buildRepositoryProfile,
  profileTask,
  REPO_PROFILE_VERSION,
  type RunMetric
} from "../orchestration/index.js";

const NO_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };
const PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];

function sample(runId: string, owner: ProviderId, taskType: string, firstPass: boolean): RunMetric {
  return {
    runId,
    taskId: "t",
    taskType,
    owner,
    reviewer: owner === "codex" ? "claude" : "codex",
    providerVersions: {},
    mode: "specialist",
    firstPassSuccess: firstPass,
    repairRounds: firstPass ? 0 : 2,
    findings: NO_FINDINGS,
    regressions: 0,
    wallTimeMs: 1,
    commandCount: 1,
    filesChanged: 1,
    diffSize: 10,
    governanceDecision: "merge",
    mergeResult: "merged",
    rollback: false,
    failureReason: null,
    provenance: "re_derived",
    recordedAt: "2026-06-29T00:00:00.000Z"
  };
}

function recordN(store: MetricsStore, n: number, owner: ProviderId, taskType: string, firstPass: boolean): void {
  for (let i = 0; i < n; i += 1) {
    store.record(sample(`${owner}-${taskType}-${i}`, owner, taskType, firstPass));
  }
}

function profileOf(objective: string) {
  return profileTask({
    objective,
    scope: [],
    nonGoals: [],
    invariants: [],
    acceptanceCriteria: [],
    failureModes: [],
    relationToPriorDecisions: []
  });
}

describe("buildRepositoryProfile — evidence-gated, repo-scoped, no generalization", () => {
  function storeWithData(): MetricsStore {
    const store = new MetricsStore();
    // feature: codex strong (6× pass), claude weak (6× fail) → a rule should form.
    recordN(store, 6, "codex", "feature", true);
    recordN(store, 6, "claude", "feature", false);
    // refactor: data present but below the 5-sample gate → UNKNOWN.
    recordN(store, 3, "codex", "refactor", true);
    recordN(store, 3, "claude", "refactor", false);
    // docs: ample samples but equal rates → below the difference gate → UNKNOWN.
    recordN(store, 6, "codex", "docs", true);
    recordN(store, 6, "claude", "docs", true);
    return store;
  }

  it("derives a rule only where the sample + difference gates are met", () => {
    const profile = buildRepositoryProfile(storeWithData(), "repoX", PROVIDERS, ["feature", "refactor", "docs"]);
    expect(profile.rules.map((r) => r.id)).toEqual(["repo-repoX-feature-favor-codex"]);
    expect(profile.unknownFamilies.sort()).toEqual(["docs", "refactor"]);
    const rule = profile.rules[0];
    expect(rule.version).toBe(REPO_PROFILE_VERSION);
    expect(rule.confidence).toBeCloseTo(1); // diff = 1.0
    expect(rule.evidenceBasis).toMatch(/repository repoX/);
    expect(rule.evidenceBasis).toMatch(/n=6\/6/);
  });

  it("the derived rule fires ONLY in its repository and task family (no generalization)", () => {
    const profile = buildRepositoryProfile(storeWithData(), "repoX", PROVIDERS, ["feature"]);
    const rule = profile.rules[0];
    const feat = profileOf("implement a feature");
    const refac = profileOf("refactor the parser");

    // Same repo + task family → applies (favors codex).
    const inRepo = rule.apply(feat.profile, feat.extended, PROVIDERS, { repoId: "repoX" });
    expect(inRepo?.deltas.codex).toBeGreaterThan(0);

    // Different repository → inert (NOT generalized).
    expect(rule.apply(feat.profile, feat.extended, PROVIDERS, { repoId: "otherRepo" })).toBeNull();
    // Different task family → inert.
    expect(rule.apply(refac.profile, refac.extended, PROVIDERS, { repoId: "repoX" })).toBeNull();
  });

  it("produces NO rule when there is insufficient data (reports UNKNOWN, never a preference)", () => {
    const store = new MetricsStore();
    recordN(store, 2, "codex", "feature", true);
    recordN(store, 2, "claude", "feature", false);
    const profile = buildRepositoryProfile(store, "repoX", PROVIDERS, ["feature"]);
    expect(profile.rules).toHaveLength(0);
    expect(profile.unknownFamilies).toEqual(["feature"]);
  });
});
