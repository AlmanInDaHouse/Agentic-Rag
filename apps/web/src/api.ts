import {
  AgentRunSchema,
  AgentRunWithDetailsSchema,
  ApprovalGateSchema,
  ChunkEmbeddingSchema,
  ContextChunkSchema,
  ContextDocumentSchema,
  ContextRetrievalSchema,
  ContextSearchSchema,
  ContextSourceSchema,
  CreateAgentRunSchema,
  CreateContextDocumentSchema,
  CreateContextSourceSchema,
  EmbeddingModelSchema,
  GenerateEmbeddingsRequestSchema,
  ResolveApprovalGateSchema,
  createGoalRequestSchema,
  debateRoundWithProposalsSchema,
  goalSchema,
  timelineEventSchema,
  type AgentRun,
  type AgentRunWithDetails,
  type ApprovalGate,
  type ChunkEmbedding,
  type ContextChunk,
  type ContextDocument,
  type ContextRetrieval,
  type ContextSearch,
  type ContextSource,
  type CreateContextDocument,
  type CreateContextSource,
  type CreateAgentRun,
  type CreateGoalRequest,
  type DebateRoundWithProposals,
  type EmbeddingModel,
  type GenerateEmbeddingsRequest,
  type Goal,
  type TimelineEvent
} from "@triforge/shared";
import { z } from "zod";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listGoals(): Promise<Goal[]> {
  const body = await request<unknown>("/api/goals");
  return z.array(goalSchema).parse(body);
}

export async function createGoal(input: CreateGoalRequest): Promise<Goal> {
  const parsed = createGoalRequestSchema.parse(input);
  const body = await request<unknown>("/api/goals", {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return goalSchema.parse(body);
}

export async function runDebate(goalId: string): Promise<DebateRoundWithProposals> {
  const body = await request<unknown>(`/api/goals/${goalId}/debate-rounds`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return debateRoundWithProposalsSchema.parse(body);
}

export async function getLatestDebate(goalId: string): Promise<DebateRoundWithProposals | null> {
  try {
    const body = await request<unknown>(`/api/goals/${goalId}/debate-rounds/latest`);
    return debateRoundWithProposalsSchema.parse(body);
  } catch (error) {
    if (error instanceof Error && error.message.includes("No debate round found")) {
      return null;
    }
    throw error;
  }
}

export async function getTimeline(goalId: string): Promise<TimelineEvent[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/timeline`);
  return z.array(timelineEventSchema).parse(body);
}

export async function createRun(
  goalId: string,
  input: CreateAgentRun
): Promise<AgentRunWithDetails> {
  const parsed = CreateAgentRunSchema.parse(input);
  const body = await request<unknown>(`/api/goals/${goalId}/runs`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function listRuns(goalId: string): Promise<AgentRun[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/runs`);
  return z.array(AgentRunSchema).parse(body);
}

export async function getRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}`);
  return AgentRunWithDetailsSchema.parse(body);
}

export async function startRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/start`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function advanceRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/advance`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function cancelRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function listApprovalGates(runId: string): Promise<ApprovalGate[]> {
  const body = await request<unknown>(`/api/runs/${runId}/approval-gates`);
  return z.array(ApprovalGateSchema).parse(body);
}

export async function approveGate(
  gateId: string,
  input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
): Promise<AgentRunWithDetails> {
  const parsed = ResolveApprovalGateSchema.parse(input);
  const body = await request<unknown>(`/api/approval-gates/${gateId}/approve`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function rejectGate(
  gateId: string,
  input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
): Promise<AgentRunWithDetails> {
  const parsed = ResolveApprovalGateSchema.parse(input);
  const body = await request<unknown>(`/api/approval-gates/${gateId}/reject`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function createContextSource(
  goalId: string,
  input: CreateContextSource
): Promise<ContextSource> {
  const parsed = CreateContextSourceSchema.parse(input);
  const body = await request<unknown>(`/api/goals/${goalId}/context/sources`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return ContextSourceSchema.parse(body);
}

export async function listContextSources(goalId: string): Promise<ContextSource[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/context/sources`);
  return z.array(ContextSourceSchema).parse(body);
}

export async function addContextDocument(
  sourceId: string,
  input: CreateContextDocument
): Promise<{ document: ContextDocument; chunks: ContextChunk[] }> {
  const parsed = CreateContextDocumentSchema.parse(input);
  const body = await request<unknown>(`/api/context/sources/${sourceId}/documents`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return z.object({
    document: ContextDocumentSchema,
    chunks: z.array(ContextChunkSchema)
  }).parse(body);
}

export async function listContextDocuments(sourceId: string): Promise<ContextDocument[]> {
  const body = await request<unknown>(`/api/context/sources/${sourceId}/documents`);
  return z.array(ContextDocumentSchema).parse(body);
}

export async function listContextChunks(documentId: string): Promise<ContextChunk[]> {
  const body = await request<unknown>(`/api/context/documents/${documentId}/chunks`);
  return z.array(ContextChunkSchema).parse(body);
}

export async function searchContext(
  goalId: string,
  input: ContextSearch
): Promise<ContextRetrieval> {
  const parsed = ContextSearchSchema.parse(input);
  const body = await request<unknown>(`/api/goals/${goalId}/context/search`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return ContextRetrievalSchema.parse(body);
}

export async function listContextRetrievals(goalId: string): Promise<ContextRetrieval[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/context/retrievals`);
  return z.array(ContextRetrievalSchema).parse(body);
}

export async function listEmbeddingModels(): Promise<EmbeddingModel[]> {
  const body = await request<unknown>("/api/embedding-models");
  return z.array(EmbeddingModelSchema).parse(body);
}

export async function generateDocumentMockEmbeddings(
  documentId: string,
  input: GenerateEmbeddingsRequest = { force: false }
): Promise<EmbeddingGenerationResponse> {
  const parsed = GenerateEmbeddingsRequestSchema.parse(input);
  const body = await request<unknown>(`/api/context/documents/${documentId}/embeddings/mock`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return EmbeddingGenerationResponseSchema.parse(body);
}

export async function generateSourceMockEmbeddings(
  sourceId: string,
  input: GenerateEmbeddingsRequest = { force: false }
): Promise<EmbeddingGenerationResponse> {
  const parsed = GenerateEmbeddingsRequestSchema.parse(input);
  const body = await request<unknown>(`/api/context/sources/${sourceId}/embeddings/mock`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return EmbeddingGenerationResponseSchema.parse(body);
}

export async function getDocumentEmbeddingCoverage(
  documentId: string
): Promise<DocumentEmbeddingCoverageResponse> {
  const body = await request<unknown>(`/api/context/documents/${documentId}/embeddings`);
  return DocumentEmbeddingCoverageResponseSchema.parse(body);
}

const EmbeddingGenerationResponseSchema = z.object({
  model: EmbeddingModelSchema,
  documentId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  generatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  embeddings: z.array(ChunkEmbeddingSchema)
});

const DocumentEmbeddingCoverageResponseSchema = z.object({
  documentId: z.string().uuid(),
  model: EmbeddingModelSchema,
  chunkCount: z.number().int().nonnegative(),
  embeddedChunkCount: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  embeddings: z.array(ChunkEmbeddingSchema)
});

export type EmbeddingGenerationResponse = z.infer<typeof EmbeddingGenerationResponseSchema>;
export type DocumentEmbeddingCoverageResponse = z.infer<typeof DocumentEmbeddingCoverageResponseSchema>;
export type { ChunkEmbedding };
