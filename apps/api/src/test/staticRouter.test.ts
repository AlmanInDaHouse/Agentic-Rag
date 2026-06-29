import { describe, expect, it } from "vitest";
import type { ProviderId } from "@triforge/shared";
import { profileTask, routeStatically, STATIC_ROUTER_VERSION, type CapabilityRule } from "../orchestration/index.js";

const PROVIDERS: readonly ProviderId[] = ["codex", "claude"];

function profileFor(objective: string) {
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

describe("routeStatically — honest, evidence-based capability scores", () => {
  it("defaults to NEUTRAL scores (no stereotype) without evidence", () => {
    const p = profileFor("implement a feature");
    const r = routeStatically(p.profile, p.extended, PROVIDERS);
    expect(r.capabilityScores.codex).toBe(0.5);
    expect(r.capabilityScores.claude).toBe(0.5);
    expect(r.routerVersion).toBe(STATIC_ROUTER_VERSION);
    // The neutral-baseline rule documents the stance but applies no adjustment.
    expect(r.appliedRules).toHaveLength(0);
  });

  it("drives a provider to 0 when it lacks a REQUIRED capability (snapshot fact)", () => {
    const p = profileFor("implement a feature"); // requires read/write_local/test/build
    const r = routeStatically(p.profile, p.extended, PROVIDERS, {
      context: {
        providerCapabilities: {
          codex: ["read", "write_local", "test", "build"],
          claude: ["read", "write_local"] // missing test + build
        }
      }
    });
    expect(r.capabilityScores.codex).toBe(0.5);
    expect(r.capabilityScores.claude).toBe(0);
    const applied = r.appliedRules.find((a) => a.id === "required-capability-snapshot");
    expect(applied).toBeDefined();
    expect(applied?.evidenceBasis).toMatch(/capability snapshot/i);
    expect(applied?.confidence).toBe(1);
    expect(applied?.reason).toMatch(/claude lacks required/i);
  });

  it("stays neutral when both providers support all required capabilities", () => {
    const p = profileFor("implement a feature");
    const r = routeStatically(p.profile, p.extended, PROVIDERS, {
      context: {
        providerCapabilities: {
          codex: ["read", "write_local", "test", "build"],
          claude: ["read", "write_local", "test", "build"]
        }
      }
    });
    expect(r.capabilityScores).toEqual({ codex: 0.5, claude: 0.5 });
    expect(r.appliedRules).toHaveLength(0);
  });

  it("is overridable with a custom evidence-bearing rule (versioned, recorded)", () => {
    const p = profileFor("refactor the parser");
    const customRule: CapabilityRule = {
      id: "repo-evidence-refactor",
      version: "2.1.0",
      evidenceBasis: "this repository's A6.4 metrics: codex first-pass success higher on refactors (n=30)",
      confidence: 0.7,
      fallback: "neutral",
      apply: (profile, _ext, _providers) =>
        profile.taskKind === "refactor"
          ? { deltas: { codex: 0.3 }, reason: "refactor task; repo metrics favor codex" }
          : null
    };
    const r = routeStatically(p.profile, p.extended, PROVIDERS, { rules: [customRule] });
    expect(r.capabilityScores.codex).toBeCloseTo(0.8);
    expect(r.capabilityScores.claude).toBe(0.5);
    expect(r.appliedRules[0]).toMatchObject({ id: "repo-evidence-refactor", version: "2.1.0", confidence: 0.7 });
  });

  it("is deterministic / reproducible (same input → identical output)", () => {
    const p = profileFor("implement a feature");
    const ctx = { context: { providerCapabilities: { codex: ["read"], claude: ["read", "write_local", "test", "build"] } } };
    expect(routeStatically(p.profile, p.extended, PROVIDERS, ctx)).toEqual(
      routeStatically(p.profile, p.extended, PROVIDERS, ctx)
    );
  });
});
