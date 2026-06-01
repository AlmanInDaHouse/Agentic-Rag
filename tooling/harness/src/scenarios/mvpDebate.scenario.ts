import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { assertCompletedHappyPathDebate } from "../assertions/assertDebateRound.js";
import { assertTimelineContains } from "../assertions/assertTimeline.js";
import { harnessSchemaExists, queryHarnessSchema } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: MVP debate", () => {
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

  it("creates a goal, runs debate and recovers latest round plus timeline via HTTP", async () => {
    expect(await runtime.api.health()).toBe(true);

    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const debate = await runtime.api.runDebate(goal.id);
    assertCompletedHappyPathDebate(debate);

    const latest = await runtime.api.latestDebate(goal.id);
    expect(latest.id).toBe(debate.id);
    assertCompletedHappyPathDebate(latest);

    const timeline = await runtime.api.timeline(goal.id);
    assertTimelineContains(timeline, [
      "goal_created",
      "debate_round_started",
      "agent_proposal_created",
      "judge_decision_created",
      "debate_round_completed"
    ]);

    const goalCount = await queryHarnessSchema<{ count: string }>(
      databaseUrl,
      runtime.schemaName,
      "SELECT count(*) AS count FROM goals WHERE id = $1",
      [goal.id]
    );
    expect(Number(goalCount[0].count)).toBe(1);
  });
});
