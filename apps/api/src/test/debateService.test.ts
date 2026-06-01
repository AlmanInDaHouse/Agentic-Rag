import { describe, expect, it } from "vitest";
import type {
  AgentProposal,
  CreateGoalRequest,
  DebateRound,
  Goal,
  GoalStatus
} from "@triforge/shared";
import type {
  DebateRepository,
  GoalsRepository,
  JudgeDecision,
  ProposalDraft,
  TimelineEventInput,
  TimelineEventsRepository
} from "../domain/ports.js";
import { DebateService } from "../services/debateService.js";
import { mockAgents } from "../services/mockAgents.js";
import { HighestConfidenceJudge } from "../services/mockJudge.js";

const now = new Date("2026-06-01T10:00:00.000Z").toISOString();
const goal: Goal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Build debate MVP",
  description: "Create the first structured debate loop for TriForge.",
  status: "open",
  createdAt: now,
  updatedAt: now
};

class MemoryGoalsRepository implements GoalsRepository {
  public statusUpdates: GoalStatus[] = [];

  async create(input: CreateGoalRequest): Promise<Goal> {
    return { ...goal, ...input };
  }

  async list(): Promise<Goal[]> {
    return [goal];
  }

  async findById(id: string): Promise<Goal | null> {
    return id === goal.id ? goal : null;
  }

  async updateStatus(_id: string, status: GoalStatus): Promise<void> {
    this.statusUpdates.push(status);
  }
}

class MemoryDebateRepository implements DebateRepository {
  private proposalCounter = 0;

  async nextRoundNumber(): Promise<number> {
    return 1;
  }

  async createRound(goalId: string, roundNumber: number): Promise<DebateRound> {
    return {
      id: "22222222-2222-4222-8222-222222222222",
      goalId,
      roundNumber,
      status: "running",
      winningProposalId: null,
      judgeRationale: null,
      createdAt: now,
      completedAt: null
    };
  }

  async createProposal(
    input: ProposalDraft & { debateRoundId: string; goalId: string }
  ): Promise<AgentProposal> {
    this.proposalCounter += 1;
    return {
      id: `33333333-3333-4333-8333-33333333333${this.proposalCounter}`,
      debateRoundId: input.debateRoundId,
      goalId: input.goalId,
      agentId: input.agentId,
      proposal: input.proposal,
      confidence: input.confidence,
      createdAt: now
    };
  }

  async completeRound(roundId: string, decision: JudgeDecision): Promise<DebateRound> {
    return {
      id: roundId,
      goalId: goal.id,
      roundNumber: 1,
      status: "completed",
      winningProposalId: decision.winningProposalId,
      judgeRationale: decision.rationale,
      createdAt: now,
      completedAt: now
    };
  }

  async failRound(roundId: string, reason: string): Promise<DebateRound> {
    return {
      id: roundId,
      goalId: goal.id,
      roundNumber: 1,
      status: "failed",
      winningProposalId: null,
      judgeRationale: reason,
      createdAt: now,
      completedAt: now
    };
  }

  async latestRoundWithProposals() {
    return null;
  }
}

class MemoryTimelineEventsRepository implements TimelineEventsRepository {
  public events: TimelineEventInput[] = [];

  async create(input: TimelineEventInput) {
    this.events.push(input);
    return {
      id: "44444444-4444-4444-8444-444444444444",
      goalId: input.goalId,
      type: input.type,
      message: input.message,
      payload: input.payload ?? {},
      createdAt: now
    };
  }

  async listByGoal() {
    return [];
  }
}

describe("DebateService", () => {
  it("runs one debate round with all mock agents and persists the judge decision", async () => {
    const goalsRepository = new MemoryGoalsRepository();
    const debateRepository = new MemoryDebateRepository();
    const timelineRepository = new MemoryTimelineEventsRepository();
    const service = new DebateService(
      goalsRepository,
      debateRepository,
      mockAgents,
      new HighestConfidenceJudge(),
      timelineRepository
    );

    const result = await service.runDebateRound(goal.id);

    expect(result.status).toBe("completed");
    expect(result.roundNumber).toBe(1);
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.map((proposal) => proposal.agentId)).toEqual([
      "codex_architect",
      "claude_critic",
      "gemini_researcher"
    ]);
    expect(result.winningProposalId).toBe(result.proposals[0].id);
    expect(result.judgeRationale).toContain("codex_architect");
    expect(goalsRepository.statusUpdates).toEqual(["debating", "decided"]);
    expect(timelineRepository.events.map((event) => event.type)).toEqual([
      "debate_round_started",
      "agent_proposal_created",
      "agent_proposal_created",
      "agent_proposal_created",
      "judge_decision_created",
      "debate_round_completed"
    ]);
  });
});
