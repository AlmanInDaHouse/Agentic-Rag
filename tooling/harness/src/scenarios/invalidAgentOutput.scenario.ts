import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import {
  assertCompletedWithOneInvalidAgent,
  assertFailedWithoutValidProposals
} from "../assertions/assertDebateRound.js";
import { assertTimelineContains, assertTimelineDoesNotContain } from "../assertions/assertTimeline.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

describe("harness: invalid agent output", () => {
  let oneInvalidRuntime: HarnessRuntime;
  let allInvalidRuntime: HarnessRuntime;

  beforeAll(async () => {
    oneInvalidRuntime = await startHarnessRuntime({ failureMode: "one_invalid" });
    allInvalidRuntime = await startHarnessRuntime({ failureMode: "all_invalid" });
  });

  afterAll(async () => {
    await oneInvalidRuntime?.stop();
    await allInvalidRuntime?.stop();
  });

  it("records agent_proposal_failed and completes if valid proposals remain", async () => {
    const goal = await oneInvalidRuntime.api.createGoal(goalInput("one invalid output"));
    const debate = await oneInvalidRuntime.api.runDebate(goal.id);

    assertCompletedWithOneInvalidAgent(debate);
    const timeline = await oneInvalidRuntime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["agent_proposal_failed", "debate_round_completed"]);
  });

  it("marks the round failed when every agent output is invalid", async () => {
    const goal = await allInvalidRuntime.api.createGoal(goalInput("all invalid outputs"));
    const debate = await allInvalidRuntime.api.runDebate(goal.id);

    assertFailedWithoutValidProposals(debate);
    const timeline = await allInvalidRuntime.api.timeline(goal.id);
    assertTimelineContains(timeline, ["agent_proposal_failed", "debate_round_failed"]);
    assertTimelineDoesNotContain(timeline, "debate_round_completed");
    expect(debate.judgeRationale).toContain("no valid proposals");
  });
});

function goalInput(label: string): CreateGoalRequest {
  return {
    title: `Harness ${label}`,
    description: `Validate mock agent failure behavior for ${label} through HTTP only.`
  };
}
