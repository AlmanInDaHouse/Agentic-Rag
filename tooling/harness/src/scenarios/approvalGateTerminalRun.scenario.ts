import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate terminal run", () => {
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

  it("rejects approval resolution after the run becomes terminal", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Create a gate and cancel before resolution.",
      definitionOfDone: ["Terminal runs reject approval resolution."],
      requestedActions: [{ actionType: "run_command", payload: { command: "pnpm test" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }
    const gateId = run.approvalGates[0].id;

    run = await runtime.api.cancelRun(run.id);
    expect(run.status).toBe("cancelled");

    const payload = {
      resolvedBy: "human",
      actorRole: "human_operator",
      reason: "Too late"
    };
    expect(await runtime.api.approveGateStatus(gateId, payload)).toBe(409);
    expect(await runtime.api.rejectGateStatus(gateId, payload)).toBe(409);
  });
});
