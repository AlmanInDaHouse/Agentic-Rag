import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: agent runtime cancel", () => {
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

  it("cancels a run and rejects further advance", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Cancel a deterministic runtime before execution.",
      definitionOfDone: ["Cancellation is persisted."],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    const cancelled = await runtime.api.cancelRun(created.id);
    expect(cancelled.status).toBe("cancelled");

    const recovered = await runtime.api.getRun(cancelled.id);
    expect(recovered.status).toBe("cancelled");

    const advanceStatus = await runtime.api.advanceRunStatus(cancelled.id);
    expect(advanceStatus).toBe(409);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["agent_run_created", "agent_run_cancelled"]);
  });
});
