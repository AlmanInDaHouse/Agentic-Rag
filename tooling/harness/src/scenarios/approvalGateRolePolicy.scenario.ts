import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate role policy", () => {
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

  it("enforces actor roles and strict approval payloads", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Validate approval role policy.",
      definitionOfDone: ["Human operator approves high risk action."],
      requestedActions: [{ actionType: "modify_code", payload: { path: "apps/api/src/index.ts" } }],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }
    const gateId = run.approvalGates[0].id;

    expect(
      await runtime.api.approveGateStatus(gateId, {
        resolvedBy: "system",
        actorRole: "system",
        reason: "System cannot approve high risk"
      })
    ).toBe(409);

    expect(
      await runtime.api.approveGateStatus(gateId, {
        resolvedBy: "human",
        actorRole: "human_operator",
        reason: "Approved for mock execution",
        extra: true
      })
    ).toBe(400);

    run = await runtime.api.approveGate(gateId, {
      resolvedBy: "human",
      actorRole: "human_operator",
      reason: "Approved for mock execution"
    });

    expect(run.status).toBe("running");
    expect(run.approvalGates[0]).toMatchObject({
      status: "approved",
      actorRole: "human_operator"
    });
  });
});
