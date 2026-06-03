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
  "debate_round_failed",
  "agent_run_created",
  "agent_run_started",
  "agent_step_started",
  "agent_step_succeeded",
  "agent_step_failed",
  "agent_run_completed",
  "agent_run_failed",
  "agent_run_cancelled",
  "agent_run_stopped",
  "agent_run_waiting_for_approval",
  "approval_gate_created",
  "approval_gate_expired",
  "approval_gate_resolved"
]);

export const ActionTypeSchema = z.enum([
  "read_context",
  "plan",
  "debate",
  "judge",
  "write_artifact",
  "modify_code",
  "run_command",
  "install_dependency",
  "db_migration",
  "network_request",
  "external_adapter_call",
  "delete_file",
  "git_operation"
]);

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const ApprovalActorRoleSchema = z.enum(["human_operator", "admin", "system"]);

export const ExecutionPolicySchema = z.object({
  actionType: ActionTypeSchema,
  riskLevel: RiskLevelSchema,
  requiresApproval: z.boolean(),
  blockedByDefault: z.boolean(),
  reason: z.string()
});

export const RequestedActionSchema = z.object({
  actionType: ActionTypeSchema,
  payload: z.record(z.unknown()).default({})
}).strict();

export const ApprovalDecisionSchema = z.enum(["approved", "rejected", "expired"]);

export const CreateApprovalGateSchema = z.object({
  runId: z.string().uuid(),
  stepId: z.string().uuid().nullable().default(null),
  riskLevel: RiskLevelSchema,
  actionType: ActionTypeSchema,
  actionPayload: z.record(z.unknown()).default({}),
  reason: z.string().trim().min(1).max(1000).nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null)
}).strict();

export const ResolveApprovalGateSchema = z.object({
  resolvedBy: z.string().trim().min(1).max(160),
  actorRole: ApprovalActorRoleSchema,
  reason: z.string().trim().min(1).max(1000)
}).strict();

export const AgentRunStatusSchema = z.enum([
  "created",
  "queued",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
  "stopped"
]);

export const AgentStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "waiting_for_approval",
  "cancelled"
]);

export const AgentStepTypeSchema = z.enum([
  "load_context",
  "plan",
  "debate",
  "judge",
  "execute_mock_task",
  "validate",
  "summarize"
]);

export const StopConditionSchema = z.enum([
  "max_steps",
  "max_failures",
  "manual_stop",
  "approval_rejected",
  "approval_expired",
  "definition_of_done_met"
]);

export const RunBudgetSchema = z.object({
  maxSteps: z.number().int().positive().max(100).default(12),
  maxFailures: z.number().int().nonnegative().max(25).default(3)
}).strict();

export const CreateAgentRunSchema = z.object({
  objective: z.string().trim().min(3).max(5000),
  definitionOfDone: z.array(z.string().trim().min(1).max(500)).default([]),
  budget: RunBudgetSchema.partial().default({}),
  requestedActions: z.array(RequestedActionSchema).max(10).default([])
}).strict();

export const createGoalRequestSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000)
}).strict();

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

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  status: AgentRunStatusSchema,
  objective: z.string(),
  definitionOfDone: z.array(z.string()),
  requestedActions: z.array(RequestedActionSchema),
  currentStepIndex: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  maxFailures: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});

export const AgentStepSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  type: AgentStepTypeSchema,
  status: AgentStepStatusSchema,
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.record(z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ApprovalGateSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  stepId: z.string().uuid().nullable(),
  status: z.enum(["pending", "approved", "rejected", "expired", "cancelled"]),
  riskLevel: RiskLevelSchema,
  actionType: ActionTypeSchema,
  actionPayload: z.record(z.unknown()),
  reason: z.string().nullable(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  actorRole: ApprovalActorRoleSchema.nullable(),
  decision: ApprovalDecisionSchema.nullable(),
  expiresAt: z.string().datetime().nullable()
});

export const AgentRunWithDetailsSchema = AgentRunSchema.extend({
  steps: z.array(AgentStepSchema),
  approvalGates: z.array(ApprovalGateSchema)
});

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string()
});

export type AgentId = z.infer<typeof agentIdSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type DebateRoundStatus = z.infer<typeof debateRoundStatusSchema>;
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type ApprovalActorRole = z.infer<typeof ApprovalActorRoleSchema>;
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;
export type RequestedAction = z.infer<typeof RequestedActionSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type CreateApprovalGate = z.infer<typeof CreateApprovalGateSchema>;
export type ResolveApprovalGate = z.infer<typeof ResolveApprovalGateSchema>;
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentStepStatus = z.infer<typeof AgentStepStatusSchema>;
export type AgentStepType = z.infer<typeof AgentStepTypeSchema>;
export type StopCondition = z.infer<typeof StopConditionSchema>;
export type RunBudget = z.infer<typeof RunBudgetSchema>;
export type CreateAgentRun = z.infer<typeof CreateAgentRunSchema>;
export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type AgentProposal = z.infer<typeof agentProposalSchema>;
export type DebateRound = z.infer<typeof debateRoundSchema>;
export type DebateRoundWithProposals = z.infer<typeof debateRoundWithProposalsSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;
export type AgentRunWithDetails = z.infer<typeof AgentRunWithDetailsSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
