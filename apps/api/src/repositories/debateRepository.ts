import type { AgentProposal, DebateRound, DebateRoundWithProposals } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import type { DebateRepository, JudgeDecision, ProposalDraft } from "../domain/ports.js";
import { mapAgentProposal, mapDebateRound } from "./mappers.js";

export class PgDebateRepository implements DebateRepository {
  constructor(private readonly db: DbPool) {}

  async nextRoundNumber(goalId: string): Promise<number> {
    const result = await this.db.query<{ next_round: number }>(
      "SELECT COALESCE(MAX(round_number), 0) + 1 AS next_round FROM debate_rounds WHERE goal_id = $1",
      [goalId]
    );
    return Number(result.rows[0].next_round);
  }

  async createRound(goalId: string, roundNumber: number): Promise<DebateRound> {
    const result = await this.db.query(
      `
        INSERT INTO debate_rounds (goal_id, round_number)
        VALUES ($1, $2)
        RETURNING *
      `,
      [goalId, roundNumber]
    );
    return mapDebateRound(result.rows[0]);
  }

  async createProposal(
    input: ProposalDraft & { debateRoundId: string; goalId: string }
  ): Promise<AgentProposal> {
    const result = await this.db.query(
      `
        INSERT INTO agent_proposals (debate_round_id, goal_id, agent_id, proposal, confidence)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.debateRoundId, input.goalId, input.agentId, input.proposal, input.confidence]
    );
    return mapAgentProposal(result.rows[0]);
  }

  async completeRound(roundId: string, decision: JudgeDecision): Promise<DebateRound> {
    if (!decision.winningProposalId || !decision.rationale) {
      throw new Error("Cannot complete a debate round without a judge decision");
    }

    const result = await this.db.query(
      `
        UPDATE debate_rounds
        SET status = 'completed',
            winning_proposal_id = $2,
            judge_rationale = $3,
            completed_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [roundId, decision.winningProposalId, decision.rationale]
    );
    return mapDebateRound(result.rows[0]);
  }

  async failRound(roundId: string, reason: string): Promise<DebateRound> {
    const result = await this.db.query(
      `
        UPDATE debate_rounds
        SET status = 'failed',
            judge_rationale = $2,
            completed_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [roundId, reason]
    );
    return mapDebateRound(result.rows[0]);
  }

  async latestRoundWithProposals(goalId: string): Promise<DebateRoundWithProposals | null> {
    const roundResult = await this.db.query(
      `
        SELECT *
        FROM debate_rounds
        WHERE goal_id = $1
        ORDER BY round_number DESC
        LIMIT 1
      `,
      [goalId]
    );

    if (!roundResult.rows[0]) {
      return null;
    }

    const round = mapDebateRound(roundResult.rows[0]);
    const proposalsResult = await this.db.query(
      `
        SELECT *
        FROM agent_proposals
        WHERE debate_round_id = $1
        ORDER BY created_at ASC
      `,
      [round.id]
    );

    return {
      ...round,
      proposals: proposalsResult.rows.map(mapAgentProposal)
    };
  }
}
