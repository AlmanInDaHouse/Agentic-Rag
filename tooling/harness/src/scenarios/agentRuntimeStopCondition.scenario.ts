import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: agent runtime stop condition", () => {
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

  it("stops by max_steps and rejects terminal advance", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Stop after one deterministic runtime step.",
      definitionOfDone: ["Runtime should stop before summarize."],
      budget: { maxSteps: 1, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    run = await runtime.api.advanceRun(run.id);

    expect(run.status).toBe("stopped");
    expect(run.steps.map((step) => step.type)).toEqual(["load_context"]);

    const advanceStatus = await runtime.api.advanceRunStatus(run.id);
    expect(advanceStatus).toBe(409);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["agent_run_created", "agent_run_started", "agent_run_stopped"]);
  });
});
