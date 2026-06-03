import type {
  AgentProposal,
  AgentRun,
  AgentStep,
  ApprovalGate,
  ChunkEmbedding,
  ContextChunk,
  ContextDocument,
  ContextRetrieval,
  ContextSource,
  DebateRound,
  EmbeddingModel,
  Goal,
  TimelineEvent
} from "@triforge/shared";

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

type AgentRunRow = {
  id: string;
  goal_id: string;
  status: AgentRun["status"];
  objective: string;
  definition_of_done: string[] | unknown;
  requested_actions: AgentRun["requestedActions"] | unknown;
  current_step_index: number;
  max_steps: number;
  max_failures: number;
  failure_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

type AgentStepRow = {
  id: string;
  run_id: string;
  step_index: number;
  type: AgentStep["type"];
  status: AgentStep["status"];
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ApprovalGateRow = {
  id: string;
  run_id: string;
  step_id: string | null;
  status: ApprovalGate["status"];
  risk_level: ApprovalGate["riskLevel"];
  action_type: ApprovalGate["actionType"];
  action_payload: Record<string, unknown>;
  reason: string | null;
  requested_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  actor_role: ApprovalGate["actorRole"];
  decision: ApprovalGate["decision"];
  expires_at: Date | null;
};

type ContextSourceRow = {
  id: string;
  goal_id: string | null;
  name: string;
  type: ContextSource["type"];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type ContextDocumentRow = {
  id: string;
  source_id: string;
  title: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type ContextChunkRow = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type ContextRetrievalRow = {
  id: string;
  goal_id: string | null;
  query: string;
  results: unknown;
  created_at: Date;
};

type EmbeddingModelRow = {
  id: string;
  name: string;
  provider: EmbeddingModel["provider"];
  dimension: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type ChunkEmbeddingRow = {
  id: string;
  chunk_id: string;
  model_id: string;
  embedding: unknown;
  embedding_hash: string;
  created_at: Date;
  updated_at: Date;
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

export const mapAgentRun = (row: AgentRunRow): AgentRun => ({
  id: row.id,
  goalId: row.goal_id,
  status: row.status,
  objective: row.objective,
  definitionOfDone: Array.isArray(row.definition_of_done) ? row.definition_of_done.map(String) : [],
  requestedActions: Array.isArray(row.requested_actions)
    ? row.requested_actions.map((action) => {
        const candidate = action as { actionType?: unknown; payload?: unknown };
        return {
          actionType: String(candidate.actionType),
          payload:
            typeof candidate.payload === "object" && candidate.payload !== null
              ? (candidate.payload as Record<string, unknown>)
              : {}
        };
      }) as AgentRun["requestedActions"]
    : [],
  currentStepIndex: row.current_step_index,
  maxSteps: row.max_steps,
  maxFailures: row.max_failures,
  failureCount: row.failure_count,
  createdAt: iso(row.created_at),
  startedAt: row.started_at ? iso(row.started_at) : null,
  completedAt: row.completed_at ? iso(row.completed_at) : null,
  updatedAt: iso(row.updated_at)
});

export const mapAgentStep = (row: AgentStepRow): AgentStep => ({
  id: row.id,
  runId: row.run_id,
  stepIndex: row.step_index,
  type: row.type,
  status: row.status,
  input: row.input,
  output: row.output,
  error: row.error,
  startedAt: row.started_at ? iso(row.started_at) : null,
  completedAt: row.completed_at ? iso(row.completed_at) : null,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const mapApprovalGate = (row: ApprovalGateRow): ApprovalGate => ({
  id: row.id,
  runId: row.run_id,
  stepId: row.step_id,
  status: row.status,
  riskLevel: row.risk_level,
  actionType: row.action_type,
  actionPayload: row.action_payload,
  reason: row.reason,
  requestedAt: iso(row.requested_at),
  resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
  resolvedBy: row.resolved_by,
  actorRole: row.actor_role,
  decision: row.decision,
  expiresAt: row.expires_at ? iso(row.expires_at) : null
});

export const mapContextSource = (row: ContextSourceRow): ContextSource => ({
  id: row.id,
  goalId: row.goal_id,
  name: row.name,
  type: row.type,
  metadata: row.metadata,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const mapContextDocument = (row: ContextDocumentRow): ContextDocument => ({
  id: row.id,
  sourceId: row.source_id,
  title: row.title,
  contentHash: row.content_hash,
  metadata: row.metadata,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const mapContextChunk = (row: ContextChunkRow): ContextChunk => ({
  id: row.id,
  documentId: row.document_id,
  chunkIndex: row.chunk_index,
  content: row.content,
  tokenEstimate: row.token_estimate,
  metadata: row.metadata,
  createdAt: iso(row.created_at)
});

export const mapContextRetrieval = (row: ContextRetrievalRow): ContextRetrieval => ({
  id: row.id,
  goalId: row.goal_id,
  query: row.query,
  results: Array.isArray(row.results) ? row.results as ContextRetrieval["results"] : [],
  createdAt: iso(row.created_at)
});

export const mapEmbeddingModel = (row: EmbeddingModelRow): EmbeddingModel => ({
  id: row.id,
  name: row.name,
  provider: row.provider,
  dimension: row.dimension,
  isActive: row.is_active,
  metadata: row.metadata,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const mapChunkEmbedding = (row: ChunkEmbeddingRow): ChunkEmbedding => ({
  id: row.id,
  chunkId: row.chunk_id,
  modelId: row.model_id,
  embedding: parseEmbeddingVector(row.embedding),
  embeddingHash: row.embedding_hash,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

function parseEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(Number);
}
