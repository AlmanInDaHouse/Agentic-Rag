import type {
  AgentId,
  AgentProposal,
  CreateGoalRequest,
  DebateRound,
  DebateRoundWithProposals,
  Goal,
  TimelineEvent,
  TimelineEventType
} from "@triforge/shared";

export type ProposalDraft = {
  agentId: AgentId;
  proposal: string;
  confidence: number;
};

export type JudgeDecision = {
  winningProposalId: string;
  rationale: string;
};

export type TimelineEventInput = {
  goalId: string;
  type: TimelineEventType;
  message: string;
  payload?: Record<string, unknown>;
};

export interface Agent {
  id: AgentId;
  propose(goal: Goal, roundNumber: number): Promise<ProposalDraft>;
}

export interface Judge {
  decide(goal: Goal, proposals: AgentProposal[]): Promise<JudgeDecision>;
}

export interface GoalsRepository {
  create(input: CreateGoalRequest): Promise<Goal>;
  list(): Promise<Goal[]>;
  findById(id: string): Promise<Goal | null>;
  updateStatus(id: string, status: Goal["status"]): Promise<void>;
}

export interface DebateRepository {
  nextRoundNumber(goalId: string): Promise<number>;
  createRound(goalId: string, roundNumber: number): Promise<DebateRound>;
  createProposal(input: ProposalDraft & { debateRoundId: string; goalId: string }): Promise<AgentProposal>;
  completeRound(roundId: string, decision: JudgeDecision): Promise<DebateRound>;
  failRound(roundId: string, reason: string): Promise<DebateRound>;
  latestRoundWithProposals(goalId: string): Promise<DebateRoundWithProposals | null>;
}

export interface TimelineEventsRepository {
  create(input: TimelineEventInput): Promise<TimelineEvent>;
  listByGoal(goalId: string): Promise<TimelineEvent[]>;
}
