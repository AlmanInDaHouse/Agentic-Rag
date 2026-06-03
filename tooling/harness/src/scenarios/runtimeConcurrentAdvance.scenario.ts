import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: runtime concurrent advance", () => {
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

  it("does not duplicate steps or terminal events under double advance", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Validate concurrent advance locking.",
      definitionOfDone: ["Only one terminal transition is emitted."],
      requestedActions: [],
      budget: { maxSteps: 1, maxFailures: 3 }
    });
    const started = await runtime.api.startRun(created.id);

    const statuses = await Promise.all([
      runtime.api.advanceRunStatus(started.id),
      runtime.api.advanceRunStatus(started.id)
    ]);

    expect(statuses.sort()).toEqual([200, 409]);

    const run = await runtime.api.getRun(started.id);
    expect(run.status).toBe("stopped");
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].stepIndex).toBe(0);

    const timeline = await runtime.api.timeline(goal.id);
    expect(timeline.filter((event) => event.type === "agent_run_stopped")).toHaveLength(1);
  });
});
