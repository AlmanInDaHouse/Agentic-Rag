import { describe, expect, it } from "vitest";
import { TaskProfileSchema, type TaskSpecification } from "@triforge/shared";
import { profileTask, TASK_PROFILER_VERSION } from "../orchestration/index.js";

function spec(over: Partial<TaskSpecification> = {}): TaskSpecification {
  return {
    objective: "add a feature",
    scope: [],
    nonGoals: [],
    invariants: [],
    acceptanceCriteria: [],
    failureModes: [],
    relationToPriorDecisions: [],
    ...over
  };
}

describe("profileTask — deterministic classification", () => {
  it("classifies a feature task and produces a schema-valid profile", () => {
    const r = profileTask(spec({ objective: "implement a new export feature", scope: ["src/export.ts"] }), {
      filesTouched: ["src/export.ts"]
    });
    expect(r.profile.taskKind).toBe("feature");
    expect(r.profile.blastRadius).toBe("file");
    expect(() => TaskProfileSchema.parse(r.profile)).not.toThrow();
    expect(r.extended.requiredProviderCapabilities).toContain("test");
    expect(r.extended.profilerVersion).toBe(TASK_PROFILER_VERSION);
  });

  it("classifies a security task as high sensitivity / high-or-critical risk", () => {
    const r = profileTask(spec({ objective: "fix an auth token leak in the credential store" }));
    expect(r.profile.taskKind).toBe("security");
    expect(r.extended.securitySensitivity).toBeGreaterThanOrEqual(0.7);
    expect(["high", "critical"]).toContain(r.profile.risk);
  });

  it("flags behavioural preservation for refactor and migration", () => {
    expect(profileTask(spec({ objective: "refactor the parser" })).profile.behavioralPreservationRequired).toBe(true);
    const mig = profileTask(spec({ objective: "migrate the database schema to v2" }));
    expect(mig.profile.taskKind).toBe("migration");
    expect(mig.profile.behavioralPreservationRequired).toBe(true);
    expect(mig.extended.migrationImpact).toBeGreaterThan(0.5);
  });

  it("derives blast radius from the files touched", () => {
    expect(profileTask(spec(), { filesTouched: ["src/a.ts"] }).profile.blastRadius).toBe("file");
    expect(profileTask(spec(), { filesTouched: ["src/a.ts", "src/b.ts"] }).profile.blastRadius).toBe("module");
    expect(
      profileTask(spec(), { filesTouched: ["pkgA/a.ts", "pkgB/b.ts"] }).profile.blastRadius
    ).toBe("repository");
  });

  it("infers language from file extensions", () => {
    expect(profileTask(spec(), { filesTouched: ["src/x.py"] }).extended.language).toBe("python");
    expect(profileTask(spec(), { filesTouched: ["src/x.ts"] }).extended.language).toBe("typescript");
  });
});

describe("profileTask — reproducible, versioned, overrideable", () => {
  it("is reproducible (same input → identical output)", () => {
    const s = spec({ objective: "refactor the router", scope: ["src/router.ts", "src/index.ts"] });
    const sig = { filesTouched: ["src/router.ts", "src/index.ts"] };
    expect(profileTask(s, sig)).toEqual(profileTask(s, sig));
  });

  it("applies an explicit override (override wins) and records it", () => {
    const r = profileTask(spec({ objective: "small doc tweak" }), {}, { profile: { risk: "critical" } });
    expect(r.profile.risk).toBe("critical");
    expect(r.overriddenFields).toContain("profile.risk");
    expect(r.rationale.some((x) => x.includes("override"))).toBe(true);
    // The overridden profile is still schema-valid.
    expect(() => TaskProfileSchema.parse(r.profile)).not.toThrow();
  });

  it("rejects an override that violates the A1 contract", () => {
    expect(() =>
      profileTask(spec(), {}, { profile: { complexity: "extreme" as never } })
    ).toThrow();
  });

  it("does not record an override that equals the computed value", () => {
    const computed = profileTask(spec({ objective: "implement feature" }));
    const r = profileTask(spec({ objective: "implement feature" }), {}, { profile: { taskKind: computed.profile.taskKind } });
    expect(r.overriddenFields).not.toContain("profile.taskKind");
  });
});
