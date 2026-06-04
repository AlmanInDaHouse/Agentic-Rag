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
  ContextChunk,
  ContextAuditEvent,
  ContextAuditEventType,
  ChunkEmbedding,
  ContextDocument,
  ContextRetrieval,
  ContextSearchResult,
  ContextSource,
  CreateContextDocument,
  CreateContextSource,
  DataClassification,
  EmbeddingModel,
  CreateApprovalGate,
  CreateGoalRequest,
  RedactionStatus,
  SensitiveFinding,
  DebateRound,
  DebateRoundWithProposals,
  Goal,
  RequestedAction,
  ResolveApprovalGate,
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
  requestedActions: RequestedAction[];
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
  findByIdForUpdate(id: string): Promise<AgentRun | null>;
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
  create(input: CreateApprovalGate): Promise<ApprovalGate>;
  findById(id: string): Promise<ApprovalGate | null>;
  findByIdForUpdate(id: string): Promise<ApprovalGate | null>;
  listByRun(runId: string): Promise<ApprovalGate[]>;
  listPendingByRunForUpdate(runId: string): Promise<ApprovalGate[]>;
  resolve(
    id: string,
    input: ResolveApprovalGate & { decision: "approved" | "rejected" | "expired" }
  ): Promise<ApprovalGate>;
}

export interface AgentRuntimeReadRepository {
  findRunWithDetails(runId: string): Promise<AgentRunWithDetails | null>;
}

export type AgentRuntimeRepositories = {
  agentRunRepository: AgentRunRepository;
  agentStepRepository: AgentStepRepository;
  approvalGateRepository: ApprovalGateRepository;
  timelineEventsRepository: TimelineEventsRepository;
};

export interface AgentRuntimeTransactionManager {
  run<T>(callback: (repositories: AgentRuntimeRepositories) => Promise<T>): Promise<T>;
}

export type CreateContextSourceInput = CreateContextSource & {
  goalId: string;
};

export type CreateContextDocumentInput = Omit<CreateContextDocument, "content"> & {
  sourceId: string;
  contentHash: string;
  classification: DataClassification;
  redactionStatus: RedactionStatus;
  sensitiveFindings: SensitiveFinding[];
  redactedContentHash: string | null;
  contentSize: number;
};

export type CreateContextChunkInput = {
  documentId: string;
  chunkIndex: number;
  content: string;
  contentSize: number;
  tokenEstimate: number;
  redactionStatus?: RedactionStatus;
  metadata?: Record<string, unknown>;
};

export type ContextChunkCandidate = ContextSearchResult;

export interface ContextSourceRepository {
  create(input: CreateContextSourceInput): Promise<ContextSource>;
  findById(id: string): Promise<ContextSource | null>;
  listByGoal(goalId: string): Promise<ContextSource[]>;
}

export interface ContextDocumentRepository {
  create(input: CreateContextDocumentInput): Promise<ContextDocument>;
  findById(id: string): Promise<ContextDocument | null>;
  findBySourceAndHash(sourceId: string, contentHash: string): Promise<ContextDocument | null>;
  listBySource(sourceId: string): Promise<ContextDocument[]>;
  countActiveByGoal(goalId: string): Promise<number>;
  softDelete(id: string, reason: string | null): Promise<ContextDocument>;
  restore(id: string, reason: string | null): Promise<ContextDocument>;
  hardDelete(id: string): Promise<void>;
}

export interface ContextChunkRepository {
  createMany(chunks: CreateContextChunkInput[]): Promise<ContextChunk[]>;
  listByDocument(documentId: string): Promise<ContextChunk[]>;
  listCandidatesByGoal(goalId: string, limit: number): Promise<ContextChunkCandidate[]>;
  softDeleteByDocument(documentId: string, reason: string | null): Promise<void>;
  restoreByDocument(documentId: string): Promise<void>;
}

export interface ContextRetrievalRepository {
  create(input: {
    goalId: string;
    query: string;
    results: ContextSearchResult[];
  }): Promise<ContextRetrieval>;
  listByGoal(goalId: string): Promise<ContextRetrieval[]>;
  countByGoal(goalId: string): Promise<number>;
}

export type CreateContextAuditEventInput = {
  goalId?: string | null;
  sourceId?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  eventType: ContextAuditEventType;
  actor?: string;
  reason?: string | null;
  payload?: Record<string, unknown>;
};

export interface ContextAuditEventRepository {
  create(input: CreateContextAuditEventInput): Promise<ContextAuditEvent>;
  listByGoal(goalId: string): Promise<ContextAuditEvent[]>;
}

export type UpsertChunkEmbeddingInput = {
  chunkId: string;
  modelId: string;
  embedding: number[];
  embeddingHash: string;
};

export interface EmbeddingModelRepository {
  getOrCreateMockModel(): Promise<EmbeddingModel>;
  listEmbeddingModels(): Promise<EmbeddingModel[]>;
}

export interface ChunkEmbeddingRepository {
  upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding>;
  getEmbeddingsByChunkIds(chunkIds: string[], modelId: string): Promise<ChunkEmbedding[]>;
  listChunkEmbeddings(documentId: string): Promise<ChunkEmbedding[]>;
  softDeleteByDocument(documentId: string): Promise<void>;
  restoreByDocument(documentId: string): Promise<void>;
}
