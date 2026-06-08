import { describe, expect, it } from "vitest";
import type {
  ChunkEmbedding,
  ContextAuditEvent,
  ContextChunk,
  ContextDocument,
  ContextRetrieval,
  ContextSearchResult,
  ContextSource,
  EmbeddingModel,
  Goal
} from "@triforge/shared";
import { ConflictError } from "../../../apps/api/src/domain/errors.js";
import type {
  ChunkEmbeddingRepository,
  ContextAuditEventRepository,
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  CreateContextAuditEventInput,
  CreateContextChunkInput,
  CreateContextDocumentInput,
  CreateContextSourceInput,
  EmbeddingModelRepository,
  GoalsRepository,
  UpsertChunkEmbeddingInput
} from "../../../apps/api/src/domain/ports.js";
import { ContextEngineService } from "../../../apps/api/src/services/contextEngineService.js";
import { ContextRetentionPolicyService } from "../../../apps/api/src/services/contextRetentionPolicyService.js";
import { CodeGraphContextPackIngestionService } from "./ingestion.js";
import type { CodeGraphContextPack } from "./types.js";

const now = "2026-06-08T00:00:00.000Z";
const goal: Goal = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Code Graph ingestion goal",
  description: "Validate Code Graph context pack ingestion.",
  status: "open",
  createdAt: now,
  updatedAt: now
};

describe("CodeGraphContextPackIngestionService", () => {
  it("ingests a context pack as an artifact source with traceable metadata", async () => {
    const fixture = createFixture();
    const result = await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack: samplePack(),
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });

    expect(result.sourceCreated).toBe(true);
    expect(result.documentsCreated).toBe(3);
    expect(result.chunksCreated).toBe(3);
    expect(fixture.sourceRepository.sources[0]).toMatchObject({
      type: "artifact",
      metadata: {
        generatedFrom: "code_graph",
        sourceKind: "code_graph",
        scannerVersion: "code-graph-scanner-v0",
        packVersion: "code-graph-context-pack-v0",
        artifactPath: "artifacts/code-graph/code-context-pack.json"
      }
    });

    const routeChunk = fixture.chunkRepository.chunks.find((chunk) => (
      chunk.metadata.codeGraphChunkId === "chunk:route:register-goal-routes"
    ));
    expect(routeChunk?.content).toBe("Fastify route POST /api/goals is defined in apps/api/src/routes/goals.ts.");
    expect(routeChunk?.metadata).toMatchObject({
      generatedFrom: "code_graph",
      scannerVersion: "code-graph-scanner-v0",
      packVersion: "code-graph-context-pack-v0",
      sourcePath: "apps/api/src/routes/goals.ts",
      symbolName: "registerGoalRoutes",
      symbolKind: "route",
      edgeType: null,
      targetPath: null,
      confidence: 0.99,
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });
  });

  it("is idempotent for the same goal, artifact path and context pack hash", async () => {
    const fixture = createFixture();
    const pack = samplePack();
    const first = await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack,
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });
    const second = await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack,
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });

    expect(first.sourceCreated).toBe(true);
    expect(second.sourceCreated).toBe(false);
    expect(second.documentsCreated).toBe(0);
    expect(second.documentsReused).toBe(3);
    expect(fixture.sourceRepository.sources).toHaveLength(1);
    expect(fixture.documentRepository.documents).toHaveLength(3);
    expect(fixture.chunkRepository.chunks).toHaveLength(3);
  });

  it("redacts secret-like text before chunk persistence", async () => {
    const fixture = createFixture();
    await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack: samplePack({
        chunks: [
          {
            id: "chunk:file:secret",
            documentId: "document:file:secret",
            text: "File apps/api/src/config.ts references token=abcdef1234567890.",
            metadata: {
              generatedFrom: "code_graph",
              scannerVersion: "code-graph-scanner-v0",
              sourcePath: "apps/api/src/config.ts",
              confidence: 0.9
            }
          }
        ],
        documents: [
          {
            id: "document:file:secret",
            kind: "file",
            title: "File apps/api/src/config.ts",
            sourcePath: "apps/api/src/config.ts",
            metadata: {}
          }
        ]
      }),
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });

    expect(fixture.documentRepository.documents[0]).toMatchObject({
      classification: "secret",
      redactionStatus: "redacted"
    });
    expect(fixture.chunkRepository.chunks[0].content).toContain("[REDACTED_TOKEN]");
    expect(fixture.chunkRepository.chunks[0].content).not.toContain("abcdef1234567890");
  });

  it("excludes restricted chunks instead of persisting them", async () => {
    const fixture = createFixture();
    const result = await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack: samplePack({
        chunks: [
          {
            id: "chunk:file:restricted",
            documentId: "document:file:restricted",
            text: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
            metadata: {
              generatedFrom: "code_graph",
              scannerVersion: "code-graph-scanner-v0",
              sourcePath: "apps/api/src/config.ts",
              confidence: 0.9
            }
          }
        ],
        documents: [
          {
            id: "document:file:restricted",
            kind: "file",
            title: "File apps/api/src/config.ts",
            sourcePath: "apps/api/src/config.ts",
            metadata: {}
          }
        ]
      }),
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });

    expect(result.chunksSkippedRestricted).toBe(1);
    expect(fixture.documentRepository.documents).toHaveLength(0);
    expect(fixture.chunkRepository.chunks).toHaveLength(0);
  });

  it("keeps lexical retrieval working for ingested Code Graph chunks", async () => {
    const fixture = createFixture();
    await fixture.ingestionService.ingest({
      goalId: goal.id,
      pack: samplePack(),
      artifactPath: "artifacts/code-graph/code-context-pack.json"
    });

    const lexical = await fixture.contextEngineService.search(goal.id, {
      query: "which file defines POST /api/goals",
      limit: 5,
      mode: "lexical"
    });
    const hybridFallback = await fixture.contextEngineService.search(goal.id, {
      query: "goal service import",
      limit: 5,
      mode: "hybrid"
    });

    expect(lexical.results.some((result) => result.chunk.content.includes("POST /api/goals"))).toBe(true);
    expect(lexical.results[0].source.type).toBe("artifact");
    expect(lexical.results[0].chunk.metadata.generatedFrom).toBe("code_graph");
    expect(hybridFallback.results[0]).toMatchObject({
      mode: "lexical",
      fallbackUsed: true,
      fallbackReason: "mock_embeddings_unavailable"
    });
  });
});

function samplePack(overrides: Partial<Pick<CodeGraphContextPack, "documents" | "chunks">> = {}): CodeGraphContextPack {
  const documents: CodeGraphContextPack["documents"] = overrides.documents ?? [
    {
      id: "document:file:routes-goals",
      kind: "file",
      title: "File apps/api/src/routes/goals.ts",
      sourcePath: "apps/api/src/routes/goals.ts",
      metadata: {}
    },
    {
      id: "document:route:register-goal-routes",
      kind: "route",
      title: "Route POST /api/goals",
      sourcePath: "apps/api/src/routes/goals.ts",
      metadata: {}
    },
    {
      id: "document:edge:routes-to-service",
      kind: "edge",
      title: "imports relationship apps/api/src/routes/goals.ts to apps/api/src/services/goalService.ts",
      sourcePath: "apps/api/src/routes/goals.ts",
      metadata: {}
    }
  ];
  const chunks: CodeGraphContextPack["chunks"] = overrides.chunks ?? [
    {
      id: "chunk:file:routes-goals",
      documentId: "document:file:routes-goals",
      text: "File apps/api/src/routes/goals.ts is a route file in package @fixture/api.",
      metadata: {
        generatedFrom: "code_graph",
        scannerVersion: "code-graph-scanner-v0",
        sourcePath: "apps/api/src/routes/goals.ts",
        confidence: 1
      }
    },
    {
      id: "chunk:route:register-goal-routes",
      documentId: "document:route:register-goal-routes",
      text: "Fastify route POST /api/goals is defined in apps/api/src/routes/goals.ts.",
      metadata: {
        generatedFrom: "code_graph",
        scannerVersion: "code-graph-scanner-v0",
        sourcePath: "apps/api/src/routes/goals.ts",
        symbolName: "registerGoalRoutes",
        symbolKind: "route",
        confidence: 0.99
      }
    },
    {
      id: "chunk:edge:routes-to-service",
      documentId: "document:edge:routes-to-service",
      text: "apps/api/src/routes/goals.ts imports apps/api/src/services/goalService.ts.",
      metadata: {
        generatedFrom: "code_graph",
        scannerVersion: "code-graph-scanner-v0",
        sourcePath: "apps/api/src/routes/goals.ts",
        targetPath: "apps/api/src/services/goalService.ts",
        edgeType: "imports",
        symbolName: "createGoal",
        symbolKind: "function",
        confidence: 0.95
      }
    }
  ];
  return {
    pack: {
      packVersion: "code-graph-context-pack-v0",
      generatedAt: now,
      sourceArtifactPath: "artifacts/code-graph/code-graph.json",
      scannerVersion: "code-graph-scanner-v0",
      commitSha: "fixture",
      documents: documents.length,
      chunks: chunks.length,
      warnings: 0
    },
    documents,
    chunks,
    warnings: []
  };
}

function createFixture() {
  const goalsRepository = new InMemoryGoalsRepository();
  const sourceRepository = new InMemoryContextSourceRepository();
  const documentRepository = new InMemoryContextDocumentRepository(sourceRepository);
  const chunkRepository = new InMemoryContextChunkRepository(documentRepository, sourceRepository);
  const retrievalRepository = new InMemoryContextRetrievalRepository();
  const auditEventRepository = new InMemoryContextAuditEventRepository();
  const embeddingModelRepository = new InMemoryEmbeddingModelRepository();
  const chunkEmbeddingRepository = new InMemoryChunkEmbeddingRepository();
  const retentionPolicyService = new ContextRetentionPolicyService(
    goalsRepository,
    sourceRepository,
    documentRepository,
    retrievalRepository,
    auditEventRepository
  );
  const contextEngineService = new ContextEngineService(
    goalsRepository,
    sourceRepository,
    documentRepository,
    chunkRepository,
    retrievalRepository,
    undefined,
    embeddingModelRepository,
    chunkEmbeddingRepository,
    undefined,
    undefined,
    retentionPolicyService,
    auditEventRepository
  );
  const ingestionService = new CodeGraphContextPackIngestionService(
    {
      goalsRepository,
      contextSourceRepository: sourceRepository,
      contextDocumentRepository: documentRepository,
      contextChunkRepository: chunkRepository,
      contextRetrievalRepository: retrievalRepository
    },
    retentionPolicyService
  );
  return {
    auditEventRepository,
    chunkRepository,
    contextEngineService,
    documentRepository,
    ingestionService,
    sourceRepository
  };
}

class InMemoryGoalsRepository implements GoalsRepository {
  async create() {
    return goal;
  }
  async list() {
    return [goal];
  }
  async findById(id: string) {
    return id === goal.id ? goal : null;
  }
  async updateStatus() {}
}

class InMemoryContextSourceRepository implements ContextSourceRepository {
  sources: ContextSource[] = [];

  async create(input: CreateContextSourceInput): Promise<ContextSource> {
    const source: ContextSource = {
      id: `00000000-0000-4000-8000-${String(this.sources.length + 100).padStart(12, "0")}`,
      goalId: input.goalId,
      name: input.name,
      type: input.type,
      metadata: input.metadata,
      deletedAt: null,
      deletedReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.sources.push(source);
    return source;
  }

  async findById(id: string) {
    return this.sources.find((source) => source.id === id) ?? null;
  }

  async listByGoal(goalId: string) {
    return this.sources.filter((source) => source.goalId === goalId);
  }
}

class InMemoryContextDocumentRepository implements ContextDocumentRepository {
  documents: ContextDocument[] = [];

  constructor(private readonly sources: InMemoryContextSourceRepository) {}

  async create(input: CreateContextDocumentInput): Promise<ContextDocument> {
    if (await this.findBySourceAndHash(input.sourceId, input.contentHash)) {
      throw new ConflictError("Context document already exists for this source");
    }
    const document: ContextDocument = {
      id: `00000000-0000-4000-8000-${String(this.documents.length + 200).padStart(12, "0")}`,
      sourceId: input.sourceId,
      title: input.title,
      contentHash: input.contentHash,
      classification: input.classification,
      redactionStatus: input.redactionStatus,
      sensitiveFindings: input.sensitiveFindings,
      redactedContentHash: input.redactedContentHash,
      contentSize: input.contentSize,
      deletedAt: null,
      deletedReason: null,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now
    };
    this.documents.push(document);
    return document;
  }

  async findById(id: string) {
    return this.documents.find((document) => document.id === id) ?? null;
  }

  async findBySourceAndHash(sourceId: string, contentHash: string) {
    return this.documents.find((document) => (
      document.sourceId === sourceId && document.contentHash === contentHash
    )) ?? null;
  }

  async listBySource(sourceId: string) {
    return this.documents.filter((document) => document.sourceId === sourceId);
  }

  async countActiveByGoal(goalId: string) {
    return this.documents.filter((document) => {
      const source = this.sources.sources.find((candidate) => candidate.id === document.sourceId);
      return source?.goalId === goalId && !source.deletedAt && !document.deletedAt;
    }).length;
  }

  async softDelete(id: string, reason: string | null) {
    const document = this.documents.find((candidate) => candidate.id === id);
    if (!document) {
      throw new Error("missing document");
    }
    const deleted = { ...document, deletedAt: now, deletedReason: reason, updatedAt: now };
    this.documents = this.documents.map((candidate) => candidate.id === id ? deleted : candidate);
    return deleted;
  }

  async restore(id: string, reason: string | null) {
    const document = this.documents.find((candidate) => candidate.id === id);
    if (!document) {
      throw new Error("missing document");
    }
    const restored = { ...document, deletedAt: null, deletedReason: reason, updatedAt: now };
    this.documents = this.documents.map((candidate) => candidate.id === id ? restored : candidate);
    return restored;
  }

  async hardDelete(id: string) {
    this.documents = this.documents.filter((document) => document.id !== id);
  }
}

class InMemoryContextChunkRepository implements ContextChunkRepository {
  chunks: ContextChunk[] = [];

  constructor(
    private readonly documents: InMemoryContextDocumentRepository,
    private readonly sources: InMemoryContextSourceRepository
  ) {}

  async createMany(inputs: CreateContextChunkInput[]): Promise<ContextChunk[]> {
    const created = inputs.map((input) => {
      const chunk: ContextChunk = {
        id: `00000000-0000-4000-8000-${String(this.chunks.length + 300).padStart(12, "0")}`,
        documentId: input.documentId,
        chunkIndex: input.chunkIndex,
        content: input.content,
        tokenEstimate: input.tokenEstimate,
        redactionStatus: input.redactionStatus ?? "not_scanned",
        contentSize: input.contentSize,
        deletedAt: null,
        deletedReason: null,
        metadata: input.metadata ?? {},
        createdAt: now
      };
      this.chunks.push(chunk);
      return chunk;
    });
    return created;
  }

  async listByDocument(documentId: string) {
    return this.chunks.filter((chunk) => chunk.documentId === documentId);
  }

  async listCandidatesByGoal(goalId: string): Promise<ContextSearchResult[]> {
    return this.chunks.flatMap((chunk) => {
      const document = this.documents.documents.find((candidate) => candidate.id === chunk.documentId);
      const source = document ? this.sources.sources.find((candidate) => candidate.id === document.sourceId) : null;
      if (!document || !source || source.goalId !== goalId || source.deletedAt || document.deletedAt || chunk.deletedAt) {
        return [];
      }
      return [{
        source,
        document,
        chunk,
        score: 0,
        finalScore: 0,
        lexicalScore: 0,
        vectorScore: null,
        mode: "lexical" as const,
        searchMode: "lexical" as const,
        vectorStorageUsed: "none" as const,
        fallbackUsed: false,
        fallbackReason: null
      }];
    });
  }

  async softDeleteByDocument(documentId: string, reason: string | null) {
    this.chunks = this.chunks.map((chunk) => (
      chunk.documentId === documentId ? { ...chunk, deletedAt: now, deletedReason: reason } : chunk
    ));
  }

  async restoreByDocument(documentId: string) {
    this.chunks = this.chunks.map((chunk) => (
      chunk.documentId === documentId ? { ...chunk, deletedAt: null, deletedReason: null } : chunk
    ));
  }
}

class InMemoryContextRetrievalRepository implements ContextRetrievalRepository {
  retrievals: ContextRetrieval[] = [];

  async create(input: {
    goalId: string;
    query: string;
    results: ContextSearchResult[];
    answerability?: ContextRetrieval["answerability"];
  }): Promise<ContextRetrieval> {
    const retrieval: ContextRetrieval = {
      id: `00000000-0000-4000-8000-${String(this.retrievals.length + 400).padStart(12, "0")}`,
      goalId: input.goalId,
      query: input.query,
      results: input.results,
      answerability: input.answerability,
      createdAt: now
    };
    this.retrievals.push(retrieval);
    return retrieval;
  }

  async listByGoal(goalId: string) {
    return this.retrievals.filter((retrieval) => retrieval.goalId === goalId);
  }

  async countByGoal(goalId: string) {
    return this.retrievals.filter((retrieval) => retrieval.goalId === goalId).length;
  }
}

class InMemoryContextAuditEventRepository implements ContextAuditEventRepository {
  events: ContextAuditEvent[] = [];

  async create(input: CreateContextAuditEventInput): Promise<ContextAuditEvent> {
    const event: ContextAuditEvent = {
      id: `00000000-0000-4000-8000-${String(this.events.length + 500).padStart(12, "0")}`,
      goalId: input.goalId ?? null,
      sourceId: input.sourceId ?? null,
      documentId: input.documentId ?? null,
      chunkId: input.chunkId ?? null,
      eventType: input.eventType,
      actor: input.actor ?? "system",
      reason: input.reason ?? null,
      payload: input.payload ?? {},
      createdAt: now
    };
    this.events.push(event);
    return event;
  }

  async listByGoal(goalId: string) {
    return this.events.filter((event) => event.goalId === goalId);
  }
}

class InMemoryEmbeddingModelRepository implements EmbeddingModelRepository {
  async getOrCreateMockModel(): Promise<EmbeddingModel> {
    return embeddingModel;
  }
  async getOrCreateModel(): Promise<EmbeddingModel> {
    return embeddingModel;
  }
  async listEmbeddingModels(): Promise<EmbeddingModel[]> {
    return [embeddingModel];
  }
}

class InMemoryChunkEmbeddingRepository implements ChunkEmbeddingRepository {
  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding> {
    return {
      id: "00000000-0000-4000-8000-000000000900",
      chunkId: input.chunkId,
      modelId: input.modelId,
      embedding: input.embedding,
      embeddingHash: input.embeddingHash,
      createdAt: now,
      updatedAt: now
    };
  }
  async getEmbeddingsByChunkIds() {
    return [];
  }
  async listChunkEmbeddings() {
    return [];
  }
  async softDeleteByDocument() {}
  async restoreByDocument() {}
}

const embeddingModel: EmbeddingModel = {
  id: "00000000-0000-4000-8000-000000000901",
  name: "mock_embedding_v1",
  provider: "mock",
  dimension: 32,
  storageKind: "jsonb",
  isActive: true,
  metadata: {},
  createdAt: now,
  updatedAt: now
};
