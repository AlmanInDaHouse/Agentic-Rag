import { z } from "zod";

export const agentIdSchema = z.enum([
  "codex_architect",
  "claude_critic",
  "gemini_researcher"
]);

export const goalStatusSchema = z.enum(["open", "debating", "decided"]);
export const debateRoundStatusSchema = z.enum(["running", "completed", "failed"]);
export const timelineEventTypeSchema = z.enum([
  "goal_created",
  "debate_round_started",
  "agent_proposal_created",
  "agent_proposal_failed",
  "judge_decision_created",
  "debate_round_completed",
  "debate_round_failed"
]);

export const createGoalRequestSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000)
});

export const goalSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: goalStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const agentProposalSchema = z.object({
  id: z.string().uuid(),
  debateRoundId: z.string().uuid(),
  goalId: z.string().uuid(),
  agentId: agentIdSchema,
  proposal: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime()
});

export const debateRoundSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  roundNumber: z.number().int().positive(),
  status: debateRoundStatusSchema,
  winningProposalId: z.string().uuid().nullable(),
  judgeRationale: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export const debateRoundWithProposalsSchema = debateRoundSchema.extend({
  proposals: z.array(agentProposalSchema)
});

export const timelineEventSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  type: timelineEventTypeSchema,
  message: z.string(),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime()
});

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string()
});

export type AgentId = z.infer<typeof agentIdSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type DebateRoundStatus = z.infer<typeof debateRoundStatusSchema>;
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;
export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type DebateRound = z.infer<typeof debateRoundSchema>;
export type DebateRoundWithProposals = z.infer<typeof debateRoundWithProposalsSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
