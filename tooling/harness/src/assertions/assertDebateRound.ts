import { expect } from "vitest";
import { agentProposalSchema, type DebateRoundWithProposals } from "@triforge/shared";

export function assertCompletedHappyPathDebate(round: DebateRoundWithProposals): void {
  expect(round.status).toBe("completed");
  expect(round.proposals).toHaveLength(3);
  expect(round.proposals.map((proposal) => proposal.agentId).sort()).toEqual([
    "claude_critic",
    "codex_architect",
    "gemini_researcher"
  ]);
  round.proposals.forEach((proposal) => agentProposalSchema.parse(proposal));
  expect(round.winningProposalId).toEqual(expect.any(String));
  expect(round.judgeRationale).toContain("Selected");
}

export function assertCompletedWithOneInvalidAgent(round: DebateRoundWithProposals): void {
  expect(round.status).toBe("completed");
  expect(round.proposals).toHaveLength(2);
  expect(round.proposals.map((proposal) => proposal.agentId).sort()).toEqual([
    "claude_critic",
    "gemini_researcher"
  ]);
  expect(round.winningProposalId).toEqual(expect.any(String));
}

export function assertFailedWithoutValidProposals(round: DebateRoundWithProposals): void {
  expect(round.status).toBe("failed");
  expect(round.proposals).toHaveLength(0);
  expect(round.winningProposalId).toBeNull();
}
