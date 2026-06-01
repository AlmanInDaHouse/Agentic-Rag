import type { AgentProposal } from "@triforge/shared";
import type { Judge, JudgeDecision } from "../domain/ports.js";

export class HighestConfidenceJudge implements Judge {
  async decide(_goal: unknown, proposals: AgentProposal[]): Promise<JudgeDecision> {
    if (proposals.length === 0) {
      throw new Error("Cannot judge an empty proposal set");
    }

    const winner = proposals.reduce((best, proposal) =>
      proposal.confidence > best.confidence ? proposal : best
    );

    return {
      winningProposalId: winner.id,
      rationale: `Selected ${winner.agentId} because it had the highest mock confidence (${winner.confidence.toFixed(3)}).`
    };
  }
}
