import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: blocked action", () => {
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

  it("fails the run without creating a gate for blocked actions", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Request a blocked mock action.",
      definitionOfDone: ["Blocked action fails the run."],
      requestedActions: [{ actionType: "delete_file", payload: { path: "important.ts" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    expect(run.status).toBe("failed");
    expect(run.approvalGates).toEqual([]);
    expect(await runtime.api.listApprovalGates(run.id)).toEqual([]);
    expect(run.steps.find((step) => step.type === "execute_mock_task")?.error).toMatchObject({
      code: "ACTION_BLOCKED"
    });

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["agent_step_failed", "agent_run_failed"]);
  });
});
