import { z } from "zod";

// Provider contracts (A1) — provider-agnostic adapter, event, capability and
// artifact contracts. See docs/specs/PROVIDER_CONTRACTS_SPEC.md and ADR 0033.
export * from "./provider/common.js";
export * from "./provider/events.js";
export * from "./provider/capability.js";
export * from "./provider/adapter.js";
export * from "./provider/artifacts.js";

// Capability evidence model (A10) — machine-readable evidence registry + the
// final-operational release readiness evaluation. See
// docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json and ADR 0054.
export * from "./provider/evidence.js";

// Execution platform boundary (A10-W) — the single OS-portability seam that
// funnels all platform-specific path/process/isolation behavior behind one
// interface. See docs/specs/NATIVE_WINDOWS_OPERATIONAL_CLOSURE_SPEC.md and ADR 0056.
export * from "./platform/executionPlatform.js";

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
  "approval_gate_resolved",
  "context_retrieval_created"
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

export const ContextSourceTypeSchema = z.enum(["manual_text", "project_note", "artifact"]);

export const DataClassificationSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "secret",
  "restricted"
]);

export const RedactionStatusSchema = z.enum([
  "not_scanned",
  "clean",
  "redacted",
  "blocked"
]);

export const SensitiveFindingTypeSchema = z.enum([
  "email",
  "phone",
  "dni_nie",
  "iban",
  "credit_card_like",
  "api_key_like",
  "jwt_like",
  "private_key_like",
  "password_like",
  "secret_token_like",
  "url_with_token"
]);

export const SensitiveFindingSchema = z.object({
  type: SensitiveFindingTypeSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  replacement: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"])
});

export const RedactionResultSchema = z.object({
  classification: DataClassificationSchema,
  redactionStatus: RedactionStatusSchema,
  findings: z.array(SensitiveFindingSchema),
  redactedContent: z.string()
});

export const ContextDataPolicySchema = z.object({
  public: z.literal("allowed"),
  internal: z.literal("local_allowed"),
  confidential: z.literal("local_allowed_with_metadata"),
  secret: z.literal("redact_before_embedding_or_search"),
  restricted: z.literal("blocked_by_default")
});

export const CreateContextSourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: ContextSourceTypeSchema,
  metadata: z.record(z.unknown()).default({})
}).strict();

export const ContextSourceSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid().nullable(),
  name: z.string(),
  type: ContextSourceTypeSchema,
  metadata: z.record(z.unknown()),
  deletedAt: z.string().datetime().nullable().default(null),
  deletedReason: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const CreateContextDocumentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(250_000),
  metadata: z.record(z.unknown()).default({})
}).strict();

export const ContextDocumentSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  title: z.string(),
  contentHash: z.string(),
  classification: DataClassificationSchema.default("internal"),
  redactionStatus: RedactionStatusSchema.default("not_scanned"),
  sensitiveFindings: z.array(SensitiveFindingSchema).default([]),
  redactedContentHash: z.string().nullable().default(null),
  contentSize: z.number().int().nonnegative().default(0),
  deletedAt: z.string().datetime().nullable().default(null),
  deletedReason: z.string().nullable().default(null),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ContextChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  redactionStatus: RedactionStatusSchema.default("not_scanned"),
  contentSize: z.number().int().nonnegative().default(0),
  deletedAt: z.string().datetime().nullable().default(null),
  deletedReason: z.string().nullable().default(null),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime()
});

export const RedactionPreviewRequestSchema = z.object({
  content: z.string().min(1).max(100_000)
}).strict();

export const ContextRetentionPolicySchema = z.object({
  maxDocumentsPerGoal: z.number().int().positive().default(100),
  maxDocumentCharacters: z.number().int().positive().default(200_000),
  maxChunksPerDocument: z.number().int().positive().default(500),
  maxChunkCharacters: z.number().int().positive().default(2_000),
  maxRetrievalsPerGoal: z.number().int().positive().default(1_000),
  maxEmbeddingRowsPerDocument: z.number().int().positive().default(500),
  hardDeleteAllowed: z.boolean().default(false),
  softDeleteDefault: z.boolean().default(true)
}).strict();

export const ContextAuditEventTypeSchema = z.enum([
  "context_source_deleted",
  "context_document_deleted",
  "context_document_restored",
  "context_quota_rejected",
  "context_retention_pruned",
  "context_hard_deleted"
]);

export const ContextAuditEventSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  chunkId: z.string().uuid().nullable(),
  eventType: ContextAuditEventTypeSchema,
  actor: z.string(),
  reason: z.string().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime()
});

export const DeleteContextDocumentSchema = z.object({
  actor: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(1000).optional(),
  hardDelete: z.boolean().default(false)
}).strict();

export const RestoreContextDocumentSchema = z.object({
  actor: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(1000).optional()
}).strict();

export const ContextQuotaStatusSchema = z.object({
  goalId: z.string().uuid(),
  policy: ContextRetentionPolicySchema,
  activeDocuments: z.number().int().nonnegative(),
  maxDocumentsPerGoal: z.number().int().positive(),
  remainingDocuments: z.number().int().nonnegative(),
  retrievals: z.number().int().nonnegative(),
  maxRetrievalsPerGoal: z.number().int().positive(),
  shouldPruneRetrievals: z.boolean()
});

export const EmbeddingProviderSchema = z.enum(["mock", "local"]);
export const EmbeddingStorageKindSchema = z.enum(["jsonb", "pgvector"]);

export const EmbeddingModelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  provider: EmbeddingProviderSchema,
  dimension: z.number().int().positive(),
  storageKind: EmbeddingStorageKindSchema.default("jsonb"),
  isActive: z.boolean(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const EmbeddingVectorSchema = z.array(z.number().finite()).min(1).max(4096);

export const ChunkEmbeddingSchema = z.object({
  id: z.string().uuid(),
  chunkId: z.string().uuid(),
  modelId: z.string().uuid(),
  embedding: EmbeddingVectorSchema,
  embeddingHash: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const EmbeddingRequestSchema = z.object({
  input: z.string().trim().min(1).max(100_000)
}).strict();

export const EmbeddingResultSchema = z.object({
  modelId: z.string().uuid(),
  provider: EmbeddingProviderSchema,
  dimension: z.number().int().positive(),
  embedding: EmbeddingVectorSchema,
  embeddingHash: z.string()
});

export const GenerateEmbeddingsRequestSchema = z.object({
  force: z.boolean().default(false)
}).strict();

export const RagSearchModeSchema = z.enum(["lexical", "mock_vector", "hybrid"]);
export const RagQueryTypeSchema = z.enum(["answerable", "no_answer", "ambiguous", "redaction"]);

export const RagAbstentionReasonSchema = z.enum([
  "sufficient_context",
  "insufficient_context",
  "no_results",
  "low_score",
  "fallback_only",
  "redacted_or_restricted",
  "deleted_context_excluded"
]);

export const RagAnswerabilitySchema = z.enum(["answerable", "abstain"]);

export const RagAnswerabilityPolicySchema = z.object({
  minRequiredScore: z.number().finite().min(0).max(1).default(0.35),
  minSupportingResults: z.number().int().positive().max(20).default(1),
  fallbackAllowed: z.boolean().default(true),
  fallbackPenalty: z.number().finite().min(0).max(1).default(0.1)
}).strict();

export const RagAnswerabilityModePolicySchema = z.object({
  minRequiredScore: z.number().finite().min(0).max(1).optional(),
  minSupportingResults: z.number().int().positive().max(20).optional(),
  fallbackAllowed: z.boolean().optional(),
  fallbackPenalty: z.number().finite().min(0).max(1).optional()
}).strict();

export const RagAnswerabilityQueryTypePolicySchema = z.object({
  minRequiredScore: z.number().finite().min(0).max(1).optional(),
  minSupportingResults: z.number().int().positive().max(20).optional(),
  fallbackAllowed: z.boolean().optional(),
  fallbackPenalty: z.number().finite().min(0).max(1).optional()
}).strict();

export const RagAnswerabilityCalibrationSchema = z.object({
  default: RagAnswerabilityPolicySchema.default({}),
  modes: z.object({
    lexical: RagAnswerabilityModePolicySchema.optional(),
    mock_vector: RagAnswerabilityModePolicySchema.optional(),
    hybrid: RagAnswerabilityModePolicySchema.optional()
  }).strict().default({}),
  queryTypes: z.object({
    answerable: RagAnswerabilityQueryTypePolicySchema.optional(),
    no_answer: RagAnswerabilityQueryTypePolicySchema.optional(),
    ambiguous: RagAnswerabilityQueryTypePolicySchema.optional(),
    redaction: RagAnswerabilityQueryTypePolicySchema.optional()
  }).strict().default({}),
  fallback: z.object({
    fallbackAllowed: z.boolean().default(true),
    fallbackPenalty: z.number().finite().min(0).max(1).default(0.1)
  }).strict().default({})
}).strict();

export const RagAnswerabilityResultSchema = z.object({
  shouldAnswer: z.boolean(),
  answerability: RagAnswerabilitySchema,
  reason: RagAbstentionReasonSchema,
  confidence: z.number().min(0).max(1),
  topScore: z.number().finite().nonnegative().nullable(),
  minRequiredScore: z.number().finite().min(0).max(1),
  effectiveMinRequiredScore: z.number().finite().min(0).max(1).optional(),
  effectiveFallbackAllowed: z.boolean().optional(),
  effectivePolicySource: z.array(z.string()).optional(),
  supportingResultIds: z.array(z.string().uuid()),
  warnings: z.array(z.string())
});

export const RagStatusSchema = z.object({
  activeEmbeddingProvider: EmbeddingProviderSchema,
  configuredEmbeddingProvider: EmbeddingProviderSchema,
  embeddingStorage: EmbeddingStorageKindSchema,
  effectiveEmbeddingStorage: EmbeddingStorageKindSchema,
  configuredEmbeddingStorage: EmbeddingStorageKindSchema,
  pgvectorAvailable: z.boolean(),
  pgvectorExtensionAvailable: z.boolean(),
  pgvectorTableAvailable: z.boolean(),
  localEmbeddingAvailable: z.boolean(),
  localEmbeddingConfigured: z.boolean(),
  pgvectorConfigured: z.boolean(),
  vectorSearchEnabled: z.boolean(),
  fallbackReason: z.string().nullable(),
  fallbackMode: z.enum(["none", "mock", "lexical", "mock_then_lexical"]),
  warnings: z.array(z.string())
});

export const ContextSearchSchema = z.object({
  query: z.string().trim().min(1).max(5000),
  limit: z.number().int().positive().max(20).default(5),
  mode: RagSearchModeSchema.default("lexical"),
  queryType: RagQueryTypeSchema.default("answerable"),
  answerabilityPolicy: RagAnswerabilityPolicySchema.partial().optional()
}).strict();

export const ContextSearchResultSchema = z.object({
  source: ContextSourceSchema,
  document: ContextDocumentSchema,
  chunk: ContextChunkSchema,
  score: z.number().nonnegative(),
  finalScore: z.number().nonnegative().default(0),
  lexicalScore: z.number().nonnegative().default(0),
  vectorScore: z.number().nonnegative().nullable().default(null),
  mode: RagSearchModeSchema.default("lexical"),
  searchMode: RagSearchModeSchema.default("lexical"),
  vectorStorageUsed: z.enum(["jsonb", "pgvector", "none"]).default("none"),
  fallbackUsed: z.boolean().default(false),
  fallbackReason: z.string().nullable().default(null)
});

export const ContextRetrievalSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid().nullable(),
  query: z.string(),
  results: z.array(ContextSearchResultSchema),
  answerability: RagAnswerabilityResultSchema.optional(),
  createdAt: z.string().datetime()
});

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
export type ContextSourceType = z.infer<typeof ContextSourceTypeSchema>;
export type DataClassification = z.infer<typeof DataClassificationSchema>;
export type RedactionStatus = z.infer<typeof RedactionStatusSchema>;
export type SensitiveFindingType = z.infer<typeof SensitiveFindingTypeSchema>;
export type SensitiveFinding = z.infer<typeof SensitiveFindingSchema>;
export type RedactionResult = z.infer<typeof RedactionResultSchema>;
export type ContextDataPolicy = z.infer<typeof ContextDataPolicySchema>;
export type CreateContextSource = z.infer<typeof CreateContextSourceSchema>;
export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type CreateContextDocument = z.infer<typeof CreateContextDocumentSchema>;
export type ContextDocument = z.infer<typeof ContextDocumentSchema>;
export type ContextChunk = z.infer<typeof ContextChunkSchema>;
export type RedactionPreviewRequest = z.infer<typeof RedactionPreviewRequestSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type EmbeddingStorageKind = z.infer<typeof EmbeddingStorageKindSchema>;
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;
export type EmbeddingVector = z.infer<typeof EmbeddingVectorSchema>;
export type ChunkEmbedding = z.infer<typeof ChunkEmbeddingSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;
export type GenerateEmbeddingsRequest = z.infer<typeof GenerateEmbeddingsRequestSchema>;
export type RagSearchMode = z.infer<typeof RagSearchModeSchema>;
export type RagQueryType = z.infer<typeof RagQueryTypeSchema>;
export type RagAbstentionReason = z.infer<typeof RagAbstentionReasonSchema>;
export type RagAnswerability = z.infer<typeof RagAnswerabilitySchema>;
export type RagAnswerabilityPolicy = z.infer<typeof RagAnswerabilityPolicySchema>;
export type RagAnswerabilityModePolicy = z.infer<typeof RagAnswerabilityModePolicySchema>;
export type RagAnswerabilityQueryTypePolicy = z.infer<typeof RagAnswerabilityQueryTypePolicySchema>;
export type RagAnswerabilityCalibration = z.infer<typeof RagAnswerabilityCalibrationSchema>;
export type RagAnswerabilityResult = z.infer<typeof RagAnswerabilityResultSchema>;
export type RagStatus = z.infer<typeof RagStatusSchema>;
export type ContextSearch = z.input<typeof ContextSearchSchema>;
export type ContextSearchResult = z.infer<typeof ContextSearchResultSchema>;
export type ContextRetrieval = z.infer<typeof ContextRetrievalSchema>;
export type ContextRetentionPolicy = z.infer<typeof ContextRetentionPolicySchema>;
export type ContextAuditEventType = z.infer<typeof ContextAuditEventTypeSchema>;
export type ContextAuditEvent = z.infer<typeof ContextAuditEventSchema>;
export type DeleteContextDocument = z.infer<typeof DeleteContextDocumentSchema>;
export type RestoreContextDocument = z.infer<typeof RestoreContextDocumentSchema>;
export type ContextQuotaStatus = z.infer<typeof ContextQuotaStatusSchema>;
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
