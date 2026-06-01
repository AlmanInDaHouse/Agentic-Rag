import { agentIdSchema, type DebateRoundWithProposals } from "@triforge/shared";
import { z } from "zod";
import { NotFoundError } from "../domain/errors.js";
import type {
  Agent,
  DebateRepository,
  GoalsRepository,
  Judge,
  TimelineEventsRepository
} from "../domain/ports.js";

const proposalDraftSchema = z.object({
  agentId: agentIdSchema,
  proposal: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export class DebateService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly debateRepository: DebateRepository,
    private readonly agents: Agent[],
    private readonly judge: Judge,
    private readonly timelineEventsRepository: TimelineEventsRepository
  ) {}

  async runDebateRound(goalId: string): Promise<DebateRoundWithProposals> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }

    await this.goalsRepository.updateStatus(goalId, "debating");

    const roundNumber = await this.debateRepository.nextRoundNumber(goalId);
    const round = await this.debateRepository.createRound(goalId, roundNumber);
    await this.timelineEventsRepository.create({
      goalId,
      type: "debate_round_started",
      message: `Debate round ${round.roundNumber} started.`,
      payload: { debateRoundId: round.id, roundNumber: round.roundNumber }
    });

    const proposals = [];
    for (const agent of this.agents) {
      try {
        const rawDraft = await agent.propose(goal, round.roundNumber);
        const draft = proposalDraftSchema.parse(rawDraft);
        const proposal = await this.debateRepository.createProposal({
          ...draft,
          debateRoundId: round.id,
          goalId
        });
        proposals.push(proposal);
        await this.timelineEventsRepository.create({
          goalId,
          type: "agent_proposal_created",
          message: `${proposal.agentId} created a proposal.`,
          payload: {
            debateRoundId: round.id,
            proposalId: proposal.id,
            confidence: proposal.confidence
          }
        });
      } catch (error) {
        await this.timelineEventsRepository.create({
          goalId,
          type: "agent_proposal_failed",
          message: `${agent.id} failed to produce a valid proposal.`,
          payload: {
            debateRoundId: round.id,
            agentId: agent.id,
            error: error instanceof Error ? error.message : "Unknown agent error"
          }
        });
      }
    }

    if (proposals.length === 0) {
      const reason = "Debate round failed because no valid proposals were produced.";
      const failedRound = await this.debateRepository.failRound(round.id, reason);
      await this.timelineEventsRepository.create({
        goalId,
        type: "debate_round_failed",
        message: reason,
        payload: { debateRoundId: round.id }
      });

      return {
        ...failedRound,
        proposals
      };
    }

    const decision = await this.judge.decide(goal, proposals);
    await this.timelineEventsRepository.create({
      goalId,
      type: "judge_decision_created",
      message: "Judge created a decision.",
      payload: {
        debateRoundId: round.id,
        winningProposalId: decision.winningProposalId
      }
    });

    const completedRound = await this.debateRepository.completeRound(round.id, decision);
    await this.timelineEventsRepository.create({
      goalId,
      type: "debate_round_completed",
      message: `Debate round ${round.roundNumber} completed.`,
      payload: {
        debateRoundId: round.id,
        winningProposalId: decision.winningProposalId
      }
    });
    await this.goalsRepository.updateStatus(goalId, "decided");

    return {
      ...completedRound,
      proposals
    };
  }
}
