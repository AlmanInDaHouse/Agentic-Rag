import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate reject", () => {
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

  it("rejects a pending gate and stops the run", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Reject a high risk mock action.",
      definitionOfDone: ["Run stops after rejection."],
      requestedActions: [{ actionType: "external_adapter_call", payload: { adapter: "codex" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }

    run = await runtime.api.rejectGate(run.approvalGates[0].id, {
      resolvedBy: "human",
      reason: "Rejected for harness validation"
    });

    expect(run.status).toBe("stopped");
    expect(run.approvalGates[0].status).toBe("rejected");
    expect(await runtime.api.advanceRunStatus(run.id)).toBe(409);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["approval_gate_resolved", "agent_run_stopped"]);
  });
});
