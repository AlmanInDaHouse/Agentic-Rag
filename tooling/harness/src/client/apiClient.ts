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
  RedactionPreviewRequestSchema,
  RedactionResultSchema,
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
  type CreateAgentRun,
  type CreateContextDocument,
  type CreateContextSource,
  type CreateGoalRequest,
  type DebateRoundWithProposals,
  type EmbeddingModel,
  type GenerateEmbeddingsRequest,
  type Goal,
  type RedactionPreviewRequest,
  type RedactionResult,
  type TimelineEvent
} from "@triforge/shared";

export class HarnessApiClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  async createGoal(input: CreateGoalRequest): Promise<Goal> {
    const parsed = createGoalRequestSchema.parse(input);
    const body = await this.request("/api/goals", {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return goalSchema.parse(body);
  }

  async runDebate(goalId: string): Promise<DebateRoundWithProposals> {
    const body = await this.request(`/api/goals/${goalId}/debate-rounds`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return debateRoundWithProposalsSchema.parse(body);
  }

  async latestDebate(goalId: string): Promise<DebateRoundWithProposals> {
    const body = await this.request(`/api/goals/${goalId}/debate-rounds/latest`);
    return debateRoundWithProposalsSchema.parse(body);
  }

  async timeline(goalId: string): Promise<TimelineEvent[]> {
    const body = await this.request(`/api/goals/${goalId}/timeline`);
    return timelineEventSchema.array().parse(body);
  }

  async createRun(goalId: string, input: CreateAgentRun): Promise<AgentRunWithDetails> {
    const parsed = CreateAgentRunSchema.parse(input);
    const body = await this.request(`/api/goals/${goalId}/runs`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async listRuns(goalId: string): Promise<AgentRun[]> {
    const body = await this.request(`/api/goals/${goalId}/runs`);
    return AgentRunSchema.array().parse(body);
  }

  async getRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}`);
    return AgentRunWithDetailsSchema.parse(body);
  }

  async startRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/start`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async startRunStatus(runId: string, body: unknown = {}): Promise<number> {
    const response = await this.rawRequest(`/api/runs/${runId}/start`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async advanceRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/advance`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async cancelRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async listApprovalGates(runId: string): Promise<ApprovalGate[]> {
    const body = await this.request(`/api/runs/${runId}/approval-gates`);
    return ApprovalGateSchema.array().parse(body);
  }

  async approveGate(
    gateId: string,
    input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
  ): Promise<AgentRunWithDetails> {
    const parsed = ResolveApprovalGateSchema.parse(input);
    const body = await this.request(`/api/approval-gates/${gateId}/approve`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async rejectGate(
    gateId: string,
    input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
  ): Promise<AgentRunWithDetails> {
    const parsed = ResolveApprovalGateSchema.parse(input);
    const body = await this.request(`/api/approval-gates/${gateId}/reject`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async advanceRunStatus(runId: string): Promise<number> {
    const response = await this.rawRequest(`/api/runs/${runId}/advance`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await response.text();
    return response.status;
  }

  async approveGateStatus(gateId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/approval-gates/${gateId}/approve`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async rejectGateStatus(gateId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/approval-gates/${gateId}/reject`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async createContextSource(
    goalId: string,
    input: CreateContextSource
  ): Promise<ContextSource> {
    const parsed = CreateContextSourceSchema.parse(input);
    const body = await this.request(`/api/goals/${goalId}/context/sources`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return ContextSourceSchema.parse(body);
  }

  async listContextSources(goalId: string): Promise<ContextSource[]> {
    const body = await this.request(`/api/goals/${goalId}/context/sources`);
    return ContextSourceSchema.array().parse(body);
  }

  async addContextDocument(
    sourceId: string,
    input: CreateContextDocument
  ): Promise<{ document: ContextDocument; chunks: ContextChunk[] }> {
    const parsed = CreateContextDocumentSchema.parse(input);
    const body = await this.request(`/api/context/sources/${sourceId}/documents`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    const candidate = body as { document?: unknown; chunks?: unknown };
    return {
      document: ContextDocumentSchema.parse(candidate.document),
      chunks: ContextChunkSchema.array().parse(candidate.chunks)
    };
  }

  async addContextDocumentStatus(sourceId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/context/sources/${sourceId}/documents`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async listContextDocuments(sourceId: string): Promise<ContextDocument[]> {
    const body = await this.request(`/api/context/sources/${sourceId}/documents`);
    return ContextDocumentSchema.array().parse(body);
  }

  async listContextChunks(documentId: string): Promise<ContextChunk[]> {
    const body = await this.request(`/api/context/documents/${documentId}/chunks`);
    return ContextChunkSchema.array().parse(body);
  }

  async searchContext(goalId: string, input: ContextSearch): Promise<ContextRetrieval> {
    const parsed = ContextSearchSchema.parse(input);
    const body = await this.request(`/api/goals/${goalId}/context/search`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return ContextRetrievalSchema.parse(body);
  }

  async searchContextStatus(goalId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/goals/${goalId}/context/search`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async listContextRetrievals(goalId: string): Promise<ContextRetrieval[]> {
    const body = await this.request(`/api/goals/${goalId}/context/retrievals`);
    return ContextRetrievalSchema.array().parse(body);
  }

  async previewContextRedaction(input: RedactionPreviewRequest): Promise<RedactionResult> {
    const parsed = RedactionPreviewRequestSchema.parse(input);
    const body = await this.request("/api/context/redact/preview", {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return RedactionResultSchema.parse(body);
  }

  async previewContextRedactionStatus(body: unknown): Promise<number> {
    const response = await this.rawRequest("/api/context/redact/preview", {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async listEmbeddingModels(): Promise<EmbeddingModel[]> {
    const body = await this.request("/api/embedding-models");
    return EmbeddingModelSchema.array().parse(body);
  }

  async generateDocumentMockEmbeddings(
    documentId: string,
    input: GenerateEmbeddingsRequest = { force: false }
  ): Promise<EmbeddingGenerationResponse> {
    const parsed = GenerateEmbeddingsRequestSchema.parse(input);
    const body = await this.request(`/api/context/documents/${documentId}/embeddings/mock`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return parseEmbeddingGenerationResponse(body);
  }

  async generateSourceMockEmbeddings(
    sourceId: string,
    input: GenerateEmbeddingsRequest = { force: false }
  ): Promise<EmbeddingGenerationResponse> {
    const parsed = GenerateEmbeddingsRequestSchema.parse(input);
    const body = await this.request(`/api/context/sources/${sourceId}/embeddings/mock`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return parseEmbeddingGenerationResponse(body);
  }

  async getDocumentEmbeddingCoverage(documentId: string): Promise<DocumentEmbeddingCoverage> {
    const body = await this.request(`/api/context/documents/${documentId}/embeddings`);
    const candidate = body as {
      documentId?: unknown;
      model?: unknown;
      chunkCount?: unknown;
      embeddedChunkCount?: unknown;
      coverage?: unknown;
      embeddings?: unknown;
    };
    return {
      documentId: String(candidate.documentId),
      model: EmbeddingModelSchema.parse(candidate.model),
      chunkCount: Number(candidate.chunkCount),
      embeddedChunkCount: Number(candidate.embeddedChunkCount),
      coverage: Number(candidate.coverage),
      embeddings: ChunkEmbeddingSchema.array().parse(candidate.embeddings)
    };
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.rawRequest(path, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Harness API request failed ${response.status}: ${text}`);
    }

    return response.json();
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
  }
}

export type EmbeddingGenerationResponse = {
  model: EmbeddingModel;
  documentId?: string;
  sourceId?: string;
  generatedCount: number;
  skippedCount: number;
  embeddings: ChunkEmbedding[];
};

export type DocumentEmbeddingCoverage = {
  documentId: string;
  model: EmbeddingModel;
  chunkCount: number;
  embeddedChunkCount: number;
  coverage: number;
  embeddings: ChunkEmbedding[];
};

function parseEmbeddingGenerationResponse(body: unknown): EmbeddingGenerationResponse {
  const candidate = body as {
    model?: unknown;
    documentId?: unknown;
    sourceId?: unknown;
    generatedCount?: unknown;
    skippedCount?: unknown;
    embeddings?: unknown;
  };
  return {
    model: EmbeddingModelSchema.parse(candidate.model),
    documentId: typeof candidate.documentId === "string" ? candidate.documentId : undefined,
    sourceId: typeof candidate.sourceId === "string" ? candidate.sourceId : undefined,
    generatedCount: Number(candidate.generatedCount),
    skippedCount: Number(candidate.skippedCount),
    embeddings: ChunkEmbeddingSchema.array().parse(candidate.embeddings)
  };
}
