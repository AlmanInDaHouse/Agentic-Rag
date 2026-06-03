import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: approval gate expired", () => {
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

  it("expires a pending gate before advance and stops the run", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const created = await runtime.api.createRun(goal.id, {
      objective: "Expire a high risk approval gate.",
      definitionOfDone: ["Expired gate stops the run."],
      requestedActions: [
        {
          actionType: "run_command",
          payload: {
            command: "pnpm test",
            approvalExpiresAt: "2026-01-01T00:00:00.000Z"
          }
        }
      ],
      budget: { maxSteps: 12, maxFailures: 3 }
    });

    let run = await runtime.api.startRun(created.id);
    while (run.status === "running") {
      run = await runtime.api.advanceRun(run.id);
    }
    expect(run.status).toBe("waiting_for_approval");
    expect(run.approvalGates[0].expiresAt).toBe("2026-01-01T00:00:00.000Z");

    expect(await runtime.api.advanceRunStatus(run.id)).toBe(200);

    run = await runtime.api.getRun(run.id);
    expect(run.status).toBe("stopped");
    expect(run.approvalGates[0]).toMatchObject({
      status: "expired",
      decision: "expired",
      actorRole: "system"
    });

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["approval_gate_expired", "agent_run_stopped"]);
  });
});
