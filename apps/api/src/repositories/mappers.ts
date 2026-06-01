import type { AgentProposal, DebateRound, Goal, TimelineEvent } from "@triforge/shared";

type GoalRow = {
  id: string;
  title: string;
  description: string;
  status: Goal["status"];
  created_at: Date;
  updated_at: Date;
};

type DebateRoundRow = {
  id: string;
  goal_id: string;
  round_number: number;
  status: DebateRound["status"];
  winning_proposal_id: string | null;
  judge_rationale: string | null;
  created_at: Date;
  completed_at: Date | null;
};

type AgentProposalRow = {
  id: string;
  debate_round_id: string;
  goal_id: string;
  agent_id: AgentProposal["agentId"];
  proposal: string;
  confidence: string | number;
  created_at: Date;
};

type TimelineEventRow = {
  id: string;
  goal_id: string;
  type: TimelineEvent["type"];
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

const iso = (date: Date): string => date.toISOString();

export const mapGoal = (row: GoalRow): Goal => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const mapDebateRound = (row: DebateRoundRow): DebateRound => ({
  id: row.id,
  goalId: row.goal_id,
  roundNumber: row.round_number,
  status: row.status,
  winningProposalId: row.winning_proposal_id,
  judgeRationale: row.judge_rationale,
  createdAt: iso(row.created_at),
  completedAt: row.completed_at ? iso(row.completed_at) : null
});

export const mapAgentProposal = (row: AgentProposalRow): AgentProposal => ({
  id: row.id,
  debateRoundId: row.debate_round_id,
  goalId: row.goal_id,
  agentId: row.agent_id,
  proposal: row.proposal,
  confidence: Number(row.confidence),
  createdAt: iso(row.created_at)
});

export const mapTimelineEvent = (row: TimelineEventRow): TimelineEvent => ({
  id: row.id,
  goalId: row.goal_id,
  type: row.type,
  message: row.message,
  payload: row.payload,
  createdAt: iso(row.created_at)
});
