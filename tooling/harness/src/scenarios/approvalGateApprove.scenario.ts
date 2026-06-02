import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate approve", () => {
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

  it("approves a pending gate and lets the run continue", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Approve a high risk mock action.",
      definitionOfDone: ["Run continues after approval."],
      requestedActions: [{ actionType: "modify_code", payload: { path: "apps/api/src/index.ts" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    const gate = run.approvalGates[0];
    expect(await runtime.api.approveGateStatus(gate.id, { resolvedBy: "human" })).toBe(400);

    run = await runtime.api.approveGate(gate.id, {
      resolvedBy: "human",
      reason: "Approved for mock execution"
    });
    expect(run.status).toBe("running");
    expect(run.approvalGates[0].status).toBe("approved");

    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    expect(run.status).toBe("completed");
    expect(run.steps.find((step) => step.type === "execute_mock_task")?.status).toBe("succeeded");

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["approval_gate_resolved", "agent_run_completed"]);
  });
});
