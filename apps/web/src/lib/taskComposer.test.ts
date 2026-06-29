import { describe, expect, it } from "vitest";
import { validateTaskComposer, type TaskComposerInput } from "./taskComposer.js";

function input(over: Partial<TaskComposerInput> = {}): TaskComposerInput {
  return {
    objective: "add an export feature",
    scope: "src/a.ts\nsrc/b.ts",
    nonGoals: "",
    acceptanceCriteria: "feature works\ntests pass",
    risk: "medium",
    mode: "specialist",
    budgetUnits: "10",
    readPaths: "src",
    writePaths: "src",
    blockedPaths: ".git",
    maxFilesChanged: "5",
    timeoutMs: "60000",
    repairRounds: "3",
    ...over
  };
}

describe("validateTaskComposer — same contract as the backend", () => {
  it("accepts a valid task and normalizes path lists", () => {
    const r = validateTaskComposer(input({ scope: "  src/a.ts \n\n  src/b.ts  " }));
    expect(r.valid).toBe(true);
    expect(r.task?.spec.objective).toBe("add an export feature");
    expect(r.task?.spec.scope).toEqual(["src/a.ts", "src/b.ts"]); // trimmed, empties dropped
    expect(r.task?.policy.writePaths).toEqual(["src"]);
    expect(r.task?.policy.maxFilesChanged).toBe(5);
    expect(r.task?.risk).toBe("medium");
    expect(r.task?.mode).toBe("specialist");
  });

  it("rejects an empty objective (A1 TaskSpecification rule)", () => {
    const r = validateTaskComposer(input({ objective: "   " }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "objective")).toBe(true);
  });

  it("rejects a negative budget", () => {
    const r = validateTaskComposer(input({ budgetUnits: "-5" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "budgetUnits")).toBe(true);
  });

  it("rejects maxFilesChanged < 1 (A5.2 shape)", () => {
    const r = validateTaskComposer(input({ maxFilesChanged: "0" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "maxFilesChanged")).toBe(true);
  });

  it("rejects an out-of-enum risk or mode", () => {
    expect(validateTaskComposer(input({ risk: "extreme" })).errors.some((e) => e.field === "risk")).toBe(true);
    expect(validateTaskComposer(input({ mode: "solo" })).errors.some((e) => e.field === "mode")).toBe(true);
  });

  it("rejects non-integer numeric fields", () => {
    const r = validateTaskComposer(input({ timeoutMs: "abc", repairRounds: "1.5" }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "timeoutMs")).toBe(true);
    expect(r.errors.some((e) => e.field === "repairRounds")).toBe(true);
  });
});
