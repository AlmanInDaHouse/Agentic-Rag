import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate required", () => {
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

  it("creates a gate and blocks advance for a high risk mock action", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Request a high risk mock action.",
      definitionOfDone: ["Approval gate is created."],
      requestedActions: [{ actionType: "run_command", payload: { command: "pnpm test" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    expect(run.status).toBe("waiting_for_approval");
    expect(run.approvalGates).toHaveLength(1);
    expect(run.approvalGates[0]).toMatchObject({
      status: "pending",
      riskLevel: "high",
      actionType: "run_command"
    });
    expect(await runtime.api.advanceRunStatus(run.id)).toBe(409);

    const listedGates = await runtime.api.listApprovalGates(run.id);
    expect(listedGates).toHaveLength(1);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, [
      "approval_gate_created",
      "agent_run_waiting_for_approval"
    ]);
  });
});
