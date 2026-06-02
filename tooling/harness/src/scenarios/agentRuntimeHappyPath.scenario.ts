import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateAgentRunSchema, type CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: agent runtime happy path", () => {
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

  it("creates, starts and advances a run to completion over HTTP", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const createRunInput = CreateAgentRunSchema.parse({
      objective: "Drive the deterministic agent runtime to completion.",
      definitionOfDone: ["Runtime reaches completed status."],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    const created = await runtime.api.createRun(goal.id, createRunInput);
    expect(created.status).toBe("created");
    expect(created.steps).toEqual([]);

    const listedRuns = await runtime.api.listRuns(goal.id);
    expect(listedRuns.map((run) => run.id)).toContain(created.id);
    expect(await runtime.api.startRunStatus(created.id, { unexpected: true })).toBe(400);

    let run = await runtime.api.startRun(created.id);
    expect(run.status).toBe("running");

    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    expect(run.status).toBe("completed");
    expect(run.steps.map((step) => step.type)).toEqual([
      "load_context",
      "plan",
      "debate",
      "judge",
      "execute_mock_task",
      "validate",
      "summarize"
    ]);
    expect(run.steps.every((step) => step.status === "succeeded")).toBe(true);

    const recovered = await runtime.api.getRun(run.id);
    expect(recovered.status).toBe("completed");
    expect(recovered.steps).toHaveLength(7);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, [
      "agent_run_created",
      "agent_run_started",
      "agent_step_started",
      "agent_step_succeeded",
      "agent_run_completed"
    ]);
  });
});
