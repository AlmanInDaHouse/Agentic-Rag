import type {
  AgentId,
  AgentProposal,
  AgentRun,
  AgentRunStatus,
  AgentRunWithDetails,
  AgentStep,
  AgentStepStatus,
  AgentStepType,
  ApprovalGate,
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

export type CreateRunInput = {
  goalId: string;
  objective: string;
  definitionOfDone: string[];
  maxSteps: number;
  maxFailures: number;
};

export type CreateStepInput = {
  runId: string;
  stepIndex: number;
  type: AgentStepType;
  input?: Record<string, unknown>;
};

export type CompleteStepInput = {
  stepId: string;
  output: Record<string, unknown>;
};

export type FailStepInput = {
  stepId: string;
  error: Record<string, unknown>;
};

export interface AgentRunRepository {
  create(input: CreateRunInput): Promise<AgentRun>;
  findById(id: string): Promise<AgentRun | null>;
  listByGoal(goalId: string): Promise<AgentRun[]>;
  updateStatus(id: string, status: AgentRunStatus): Promise<AgentRun>;
  markStarted(id: string): Promise<AgentRun>;
  markCompleted(id: string): Promise<AgentRun>;
  advanceIndex(id: string, nextStepIndex: number): Promise<AgentRun>;
  incrementFailure(id: string): Promise<AgentRun>;
}

export interface AgentStepRepository {
  create(input: CreateStepInput): Promise<AgentStep>;
  updateStatus(id: string, status: AgentStepStatus): Promise<AgentStep>;
  complete(input: CompleteStepInput): Promise<AgentStep>;
  fail(input: FailStepInput): Promise<AgentStep>;
  listByRun(runId: string): Promise<AgentStep[]>;
}

export interface ApprovalGateRepository {
  listByRun(runId: string): Promise<ApprovalGate[]>;
}

export interface AgentRuntimeReadRepository {
  findRunWithDetails(runId: string): Promise<AgentRunWithDetails | null>;
}
