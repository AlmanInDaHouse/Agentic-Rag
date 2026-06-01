import { describe, expect, it } from "vitest";
import type { AgentProposal } from "@triforge/shared";
import { HighestConfidenceJudge } from "../services/mockJudge.js";

const baseProposal = {
  debateRoundId: "22222222-2222-4222-8222-222222222222",
  goalId: "11111111-1111-4111-8111-111111111111",
  proposal: "proposal",
  createdAt: new Date("2026-06-01T10:00:00.000Z").toISOString()
};

describe("HighestConfidenceJudge", () => {
  it("selects the proposal with the highest confidence", async () => {
    const proposals: AgentProposal[] = [
      {
        ...baseProposal,
        id: "33333333-3333-4333-8333-333333333331",
        agentId: "gemini_researcher",
        confidence: 0.7
      },
      {
        ...baseProposal,
        id: "33333333-3333-4333-8333-333333333332",
        agentId: "claude_critic",
        confidence: 0.9
      }
    ];

    const decision = await new HighestConfidenceJudge().decide({}, proposals);

    expect(decision.winningProposalId).toBe("33333333-3333-4333-8333-333333333332");
    expect(decision.rationale).toContain("claude_critic");
  });
});
