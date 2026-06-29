import { describe, expect, it } from "vitest";
import type { ProviderId } from "@triforge/shared";
import {
  profileTask,
  routeAdaptive,
  ADAPTIVE_ROUTER_VERSION,
  type CapabilityRule
} from "../orchestration/index.js";

const PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];

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

/** A repo-scoped learned rule favoring `favor` on `taskType` at the given confidence. */
function learnedRule(taskType: string, favor: ProviderId, confidence: number): CapabilityRule {
  return {
    id: `repo-repoX-${taskType}-favor-${favor}`,
    version: "test-1.0.0",
    evidenceBasis: `repository repoX metrics (n=10)`,
    confidence,
    fallback: "neutral",
    apply: (profile, _ext, _providers, ctx) =>
      ctx.repoId === "repoX" && profile.taskKind === taskType
        ? { deltas: { [favor]: confidence * 0.3 } as Partial<Record<ProviderId, number>>, reason: `favor ${favor}` }
        : null
  };
}

describe("routeAdaptive — protected adaptive routing (closes A6)", () => {
  it("APPLIES a confident learned rule for a non-security task (adaptive mode)", () => {
    const p = profileOf("implement a feature");
    const r = routeAdaptive({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      repoId: "repoX",
      repoRules: [learnedRule("feature", "codex", 1)]
    });
    expect(r.mode).toBe("adaptive");
    expect(r.fallbackUsed).toBe(false);
    expect(r.capabilityScores.codex).toBeGreaterThan(r.capabilityScores.claude);
    expect(r.preferredOwner).toBe("codex");
    expect(r.activatedRules.some((a) => a.id.includes("favor-codex"))).toBe(true);
    expect(r.routerVersion).toBe(ADAPTIVE_ROUTER_VERSION);
  });

  it("FALLS BACK to static when no learned rule meets the confidence gate (sparse data)", () => {
    const p = profileOf("implement a feature");
    const r = routeAdaptive({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      repoId: "repoX",
      repoRules: [learnedRule("feature", "codex", 0.3)], // below the 0.6 gate
      minConfidence: 0.6
    });
    expect(r.mode).toBe("static");
    expect(r.fallbackUsed).toBe(true);
    expect(r.capabilityScores).toEqual({ codex: 0.5, claude: 0.5 });
    expect(r.guardOutcomes.hasConfidentLearnedRule).toBe(false);
  });

  it("does NOT apply learned routing to a security-sensitive task (correctness over speed)", () => {
    const sec = profileOf("fix an auth token leak in the credential store");
    const r = routeAdaptive({
      profile: sec.profile,
      extended: sec.extended,
      providers: PROVIDERS,
      repoId: "repoX",
      repoRules: [learnedRule("security", "codex", 1)] // a confident rule exists…
    });
    expect(r.mode).toBe("static"); // …but the security guard blocks it
    expect(r.guardOutcomes.notSecuritySensitive).toBe(false);
    expect(r.explanation.some((e) => /security/i.test(e))).toBe(true);
  });

  it("honours a HUMAN OVERRIDE outright (audited, explainable)", () => {
    const p = profileOf("implement a feature");
    const r = routeAdaptive({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      repoId: "repoX",
      repoRules: [learnedRule("feature", "codex", 1)],
      humanOverride: "claude"
    });
    expect(r.mode).toBe("override");
    expect(r.preferredOwner).toBe("claude");
    expect(r.capabilityScores).toEqual({ claude: 1, codex: 0 });
    expect(r.explanation.some((e) => /override/i.test(e))).toBe(true);
  });

  it("is EXPLAINABLE (rule trace + guard outcomes on every decision)", () => {
    const p = profileOf("implement a feature");
    const r = routeAdaptive({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      repoId: "repoX",
      repoRules: [learnedRule("feature", "codex", 1)]
    });
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(Object.keys(r.guardOutcomes)).toEqual(
      expect.arrayContaining(["notSecuritySensitive", "hasConfidentLearnedRule", "fallbackAvailable"])
    );
  });

  it("does NOT generalize a learned rule to another repository", () => {
    const p = profileOf("implement a feature");
    const r = routeAdaptive({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      repoId: "otherRepo", // the rule is scoped to repoX
      repoRules: [learnedRule("feature", "codex", 1)]
    });
    // The rule does not fire here → neutral scores even in adaptive consideration.
    expect(r.capabilityScores).toEqual({ codex: 0.5, claude: 0.5 });
  });
});
