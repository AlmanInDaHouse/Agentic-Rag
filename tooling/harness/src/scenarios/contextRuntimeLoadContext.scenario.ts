import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: runtime load_context uses context engine", () => {
  let runtime: HarnessRuntime;
  let schemaName: string;

  beforeAll(async () => {
    runtime = await startHarnessRuntime({});
    schemaName = runtime.schemaName;
  });

  afterAll(async () => {
    await runtime?.stop();
    if (schemaName) {
      expect(await harnessSchemaExists(databaseUrl, schemaName)).toBe(false);
    }
  });

  it("stores retrieval results in the load_context step output", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Runtime context",
      type: "project_note",
      metadata: {}
    });
    await runtime.api.addContextDocument(source.id, {
      title: "Runtime objective note",
      content: "Drive the deterministic agent runtime to completion with context retrieval.",
      metadata: {}
    });

    const created = await runtime.api.createRun(goal.id, {
      objective: "Drive the deterministic agent runtime to completion.",
      definitionOfDone: ["Runtime reaches completed status."],
      budget: { maxSteps: 12, maxFailures: 3 }
    });
    let run = await runtime.api.startRun(created.id);
    run = await runtime.api.advanceRun(run.id);

    const loadContext = run.steps.find((step) => step.type === "load_context");
    expect(loadContext?.status).toBe("succeeded");
    expect(loadContext?.output?.retrievalId).toEqual(expect.any(String));
    const results = loadContext?.output?.results;
    expect(Array.isArray(results)).toBe(true);
    expect((results as unknown[]).length).toBeGreaterThan(0);

    const retrievals = await runtime.api.listContextRetrievals(goal.id);
    expect(retrievals.length).toBe(1);
    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["context_retrieval_created", "agent_step_succeeded"]);
  });
});
