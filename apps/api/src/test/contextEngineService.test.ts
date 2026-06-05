import { describe, expect, it } from "vitest";
import type {
  ContextChunk,
  ContextAuditEvent,
  ChunkEmbedding,
  ContextDocument,
  ContextRetrieval,
  ContextRetentionPolicy,
  ContextSearchResult,
  ContextSource,
  EmbeddingModel,
  Goal
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  ContextAuditEventRepository,
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  ChunkEmbeddingRepository,
  CreateContextChunkInput,
  CreateContextDocumentInput,
  CreateContextSourceInput,
  CreateContextAuditEventInput,
  EmbeddingModelRepository,
  UpsertChunkEmbeddingInput,
  GoalsRepository
} from "../domain/ports.js";
import {
  ContextEngineService,
  lexicalScore,
  stableContentHash
} from "../services/contextEngineService.js";
import { MockEmbeddingAdapter, embeddingHash } from "../services/embeddings/mockEmbeddingAdapter.js";
import type { EmbeddingStorage, EmbeddingStorageSearchResult } from "../services/embeddings/embeddingStorage.js";
import { ContextRetentionPolicyService } from "../services/contextRetentionPolicyService.js";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
const goal: Goal = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Context goal",
  description: "Validate context engine behavior.",
  status: "open",
  createdAt: now,
  updatedAt: now
};
const otherGoalId = "00000000-0000-4000-8000-000000000002";
const embeddingModel: EmbeddingModel = {
  id: "00000000-0000-4000-8000-000000000900",
  name: "mock_embedding_v1",
  provider: "mock",
  dimension: 32,
  storageKind: "jsonb",
  isActive: true,
  metadata: {},
  createdAt: now,
  updatedAt: now
};

describe("ContextEngineService", () => {
  it("uses stable hashes for normalized content", () => {
    expect(stableContentHash("alpha\r\nbeta")).toBe(stableContentHash("alpha\nbeta"));
  });

  it("scores lexical matches across source, document and chunk", () => {
    const candidate = contextCandidate({
      sourceName: "Runtime Notes",
      title: "Approval Gate",
      content: "approval approval gate context"
    });

    expect(lexicalScore(candidate, ["approval", "runtime"])).toBe(5);
  });

  it("adds a document and creates deterministic chunks", async () => {
    const fixture = createContextFixture();
    const service = fixture.service;
    const source = await service.createSource(goal.id, {
      name: "Manual source",
      type: "manual_text",
      metadata: {}
    });

    const result = await service.addDocument(source.id, {
      title: "Runtime context",
      content: "The runtime load_context step retrieves lexical chunks.",
      metadata: {}
    });

    expect(result.document.contentHash).toHaveLength(64);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      chunkIndex: 0,
      tokenEstimate: expect.any(Number)
    });
  });

  it("rejects duplicate documents for the same source", async () => {
    const fixture = createContextFixture();
    const source = await fixture.service.createSource(goal.id, {
      name: "Project note",
      type: "project_note",
      metadata: {}
    });
    const input = {
      title: "Duplicate",
      content: "Same content",
      metadata: {}
    };
    await fixture.service.addDocument(source.id, input);

    await expect(fixture.service.addDocument(source.id, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("treats the same normalized content with a different title as duplicate in one source", async () => {
    const fixture = createContextFixture();
    const source = await fixture.service.createSource(goal.id, {
      name: "Duplicate title source",
      type: "manual_text",
      metadata: {}
    });
    await fixture.service.addDocument(source.id, {
      title: "First title",
      content: "Same normalized content",
      metadata: {}
    });

    await expect(
      fixture.service.addDocument(source.id, {
        title: "Second title",
        content: "Same normalized content",
        metadata: {}
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same content in a different source", async () => {
    const fixture = createContextFixture();
    const firstSource = await fixture.service.createSource(goal.id, {
      name: "First source",
      type: "manual_text",
      metadata: {}
    });
    const secondSource = await fixture.service.createSource(goal.id, {
      name: "Second source",
      type: "artifact",
      metadata: {}
    });
    const input = {
      title: "Shared content",
      content: "Shared content is allowed across sources.",
      metadata: {}
    };

    await fixture.service.addDocument(firstSource.id, input);
    const second = await fixture.service.addDocument(secondSource.id, input);

    expect(second.document.sourceId).toBe(secondSource.id);
  });

  it("redacts sensitive content before chunking and keeps original duplicate hash policy", async () => {
    const fixture = createContextFixture();
    const source = await fixture.service.createSource(goal.id, {
      name: "Sensitive source",
      type: "manual_text",
      metadata: {}
    });
    const input = {
      title: "Sensitive document",
      content: "Contact manuel@example.com with token=abcdef1234567890 for approval.",
      metadata: {}
    };

    const result = await fixture.service.addDocument(source.id, input);

    expect(result.document.classification).toBe("secret");
    expect(result.document.redactionStatus).toBe("redacted");
    expect(result.document.sensitiveFindings.length).toBeGreaterThanOrEqual(2);
    expect(result.document.redactedContentHash).not.toBeNull();
    expect(result.chunks[0].content).toContain("[REDACTED_EMAIL]");
    expect(result.chunks[0].content).toContain("[REDACTED_TOKEN]");
    expect(result.chunks[0].content).not.toContain("manuel@example.com");
    await expect(fixture.service.addDocument(source.id, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks restricted private key content", async () => {
    const fixture = createContextFixture();
    const source = await fixture.service.createSource(goal.id, {
      name: "Restricted source",
      type: "manual_text",
      metadata: {}
    });

    await expect(
      fixture.service.addDocument(source.id, {
        title: "Private key",
        content: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        metadata: {}
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("previews redaction without persistence", () => {
    const fixture = createContextFixture();

    const preview = fixture.service.previewRedaction("Reach ops@example.com with api_key=sk_1234567890abcdef.");

    expect(preview.classification).toBe("secret");
    expect(preview.redactionStatus).toBe("redacted");
    expect(preview.redactedContent).toContain("[REDACTED_EMAIL]");
    expect(preview.redactedContent).not.toContain("ops@example.com");
  });

  it("persists search with no results", async () => {
    const fixture = createContextFixture();

    const retrieval = await fixture.service.search(goal.id, {
      query: "missing term",
      limit: 5,
      mode: "lexical"
    });

    expect(retrieval.results).toEqual([]);
    expect(await fixture.service.listRetrievals(goal.id)).toHaveLength(1);
  });

  it("returns ranked search results", async () => {
    const fixture = createContextFixture();
    const source = await fixture.service.createSource(goal.id, {
      name: "Runtime source",
      type: "manual_text",
      metadata: {}
    });
    await fixture.service.addDocument(source.id, {
      title: "Runtime context",
      content: "approval gate approval context\n\nunrelated text",
      metadata: {}
    });

    const retrieval = await fixture.service.search(goal.id, {
      query: "approval gate",
      limit: 3,
      mode: "lexical"
    });

    expect(retrieval.results).toHaveLength(1);
    expect(retrieval.results[0].chunk.content).toContain("approval gate");
    expect(retrieval.results[0].score).toBeGreaterThan(0);
  });

  it("falls back to lexical ranking for hybrid search without embeddings", async () => {
    const fixture = createContextFixture({ includeEmbeddings: true });
    const source = await fixture.service.createSource(goal.id, {
      name: "Fallback source",
      type: "manual_text",
      metadata: {}
    });
    await fixture.service.addDocument(source.id, {
      title: "Fallback context",
      content: "approval fallback context",
      metadata: {}
    });

    const retrieval = await fixture.service.search(goal.id, {
      query: "approval",
      limit: 3,
      mode: "hybrid"
    });

    expect(retrieval.results[0]).toMatchObject({
      mode: "lexical",
      fallbackUsed: true,
      fallbackReason: "mock_embeddings_unavailable"
    });
  });

  it("returns stable hybrid ranking when mock embeddings exist", async () => {
    const fixture = createContextFixture({ includeEmbeddings: true });
    const source = await fixture.service.createSource(goal.id, {
      name: "Hybrid source",
      type: "manual_text",
      metadata: {}
    });
    const result = await fixture.service.addDocument(source.id, {
      title: "Hybrid context",
      content: "approval gate context\n\nruntime summary",
      metadata: {}
    });
    await fixture.seedEmbeddings(result.chunks.map((chunk) => ({
      chunkId: chunk.id,
      content: chunk.content
    })));

    const first = await fixture.service.search(goal.id, {
      query: "approval context",
      limit: 3,
      mode: "hybrid"
    });
    const second = await fixture.service.search(goal.id, {
      query: "approval context",
      limit: 3,
      mode: "hybrid"
    });

    expect(first.results.length).toBeGreaterThan(0);
    expect(first.results[0].mode).toBe("hybrid");
    expect(first.results[0].searchMode).toBe("hybrid");
    expect(first.results[0].vectorStorageUsed).toBe("jsonb");
    expect(first.results[0].vectorScore).not.toBeNull();
    expect(first.results[0].fallbackUsed).toBe(false);
    expect(first.results[0].finalScore).toBe(first.results[0].score);
    expect(first.results.map((item) => item.chunk.id)).toEqual(
      second.results.map((item) => item.chunk.id)
    );
  });

  it("respects limit for hybrid ranking with embeddings", async () => {
    const fixture = createContextFixture({ includeEmbeddings: true });
    const source = await fixture.service.createSource(goal.id, {
      name: "Hybrid limit source",
      type: "manual_text",
      metadata: {}
    });
    const result = await fixture.service.addDocument(source.id, {
      title: "Hybrid limit context",
      content: "approval context alpha\n\napproval context beta\n\napproval context gamma",
      metadata: {}
    });
    await fixture.seedEmbeddings(result.chunks.map((chunk) => ({
      chunkId: chunk.id,
      content: chunk.content
    })));

    const retrieval = await fixture.service.search(goal.id, {
      query: "approval context",
      limit: 1,
      mode: "hybrid"
    });

    expect(retrieval.results).toHaveLength(1);
    expect(retrieval.results[0].mode).toBe("hybrid");
  });

  it("uses pgvector storage when configured and available", async () => {
    const pgvectorStorage = new InMemoryEmbeddingStorage("pgvector", true);
    const fixture = createContextFixture({
      includeEmbeddings: true,
      configuredStorage: "pgvector",
      pgvectorStorage
    });
    const source = await fixture.service.createSource(goal.id, {
      name: "Pgvector source",
      type: "manual_text",
      metadata: {}
    });
    const result = await fixture.service.addDocument(source.id, {
      title: "Pgvector context",
      content: "active pgvector retrieval path",
      metadata: {}
    });
    pgvectorStorage.seed([{ chunkId: result.chunks[0].id, vectorScore: 0.95 }]);

    const retrieval = await fixture.service.search(goal.id, {
      query: "semantic query",
      limit: 3,
      mode: "mock_vector"
    });

    expect(retrieval.results[0]).toMatchObject({
      mode: "mock_vector",
      searchMode: "mock_vector",
      vectorStorageUsed: "pgvector",
      vectorScore: 0.95,
      fallbackUsed: false
    });
  });

  it("falls back to JSONB vector storage when pgvector is configured but unavailable", async () => {
    const fixture = createContextFixture({
      includeEmbeddings: true,
      configuredStorage: "pgvector",
      pgvectorStorage: new InMemoryEmbeddingStorage("pgvector", false)
    });
    const source = await fixture.service.createSource(goal.id, {
      name: "Pgvector fallback source",
      type: "manual_text",
      metadata: {}
    });
    const result = await fixture.service.addDocument(source.id, {
      title: "Pgvector fallback context",
      content: "jsonb vector fallback content",
      metadata: {}
    });
    await fixture.seedEmbeddings(result.chunks.map((chunk) => ({
      chunkId: chunk.id,
      content: chunk.content
    })));

    const retrieval = await fixture.service.search(goal.id, {
      query: "jsonb fallback",
      limit: 3,
      mode: "hybrid"
    });

    expect(retrieval.results[0]).toMatchObject({
      mode: "hybrid",
      vectorStorageUsed: "jsonb",
      fallbackUsed: true,
      fallbackReason: "pgvector_unavailable_using_jsonb"
    });
  });

  it("does not return chunks from other goals", async () => {
    const fixture = createContextFixture();
    const firstSource = await fixture.service.createSource(goal.id, {
      name: "Goal one source",
      type: "manual_text",
      metadata: {}
    });
    const secondSource = await fixture.service.createSource(otherGoalId, {
      name: "Goal two source",
      type: "manual_text",
      metadata: {}
    });
    await fixture.service.addDocument(firstSource.id, {
      title: "Goal one context",
      content: "shared retrieval phrase from goal one",
      metadata: {}
    });
    await fixture.service.addDocument(secondSource.id, {
      title: "Goal two context",
      content: "shared retrieval phrase from goal two",
      metadata: {}
    });

    const retrieval = await fixture.service.search(goal.id, {
      query: "shared retrieval phrase",
      limit: 10,
      mode: "lexical"
    });

    expect(retrieval.results).toHaveLength(1);
    expect(retrieval.results[0].source.goalId).toBe(goal.id);
    expect(retrieval.results[0].chunk.content).toContain("goal one");
  });

  it("does not use embeddings from other goals in hybrid search", async () => {
    const fixture = createContextFixture({ includeEmbeddings: true });
    const firstSource = await fixture.service.createSource(goal.id, {
      name: "Hybrid goal one source",
      type: "manual_text",
      metadata: {}
    });
    const secondSource = await fixture.service.createSource(otherGoalId, {
      name: "Hybrid goal two source",
      type: "manual_text",
      metadata: {}
    });
    const first = await fixture.service.addDocument(firstSource.id, {
      title: "Goal one hybrid context",
      content: "shared hybrid phrase from goal one",
      metadata: {}
    });
    const second = await fixture.service.addDocument(secondSource.id, {
      title: "Goal two hybrid context",
      content: "shared hybrid phrase from goal two",
      metadata: {}
    });
    await fixture.seedEmbeddings([
      ...first.chunks.map((chunk) => ({ chunkId: chunk.id, content: chunk.content })),
      ...second.chunks.map((chunk) => ({ chunkId: chunk.id, content: chunk.content }))
    ]);

    const retrieval = await fixture.service.search(goal.id, {
      query: "shared hybrid phrase",
      limit: 10,
      mode: "hybrid"
    });

    expect(retrieval.results).toHaveLength(1);
    expect(retrieval.results[0].source.goalId).toBe(goal.id);
    expect(retrieval.results[0].chunk.content).toContain("goal one");
    expect(retrieval.results[0].chunk.content).not.toContain("goal two");
  });

  it("rejects oversized documents and records quota audit", async () => {
    const fixture = createContextFixture({
      includeRetention: true,
      policy: { maxDocumentCharacters: 10 }
    });
    const source = await fixture.service.createSource(goal.id, {
      name: "Quota source",
      type: "manual_text",
      metadata: {}
    });

    await expect(
      fixture.service.addDocument(source.id, {
        title: "Too large",
        content: "this document is too large",
        metadata: {}
      })
    ).rejects.toThrow("maxDocumentCharacters");
    expect(fixture.auditEventRepository.events[0]).toMatchObject({
      eventType: "context_quota_rejected",
      reason: "max_document_characters_exceeded"
    });
  });

  it("rejects max documents per goal and excludes deleted documents from quota", async () => {
    const fixture = createContextFixture({
      includeRetention: true,
      policy: { maxDocumentsPerGoal: 1 }
    });
    const source = await fixture.service.createSource(goal.id, {
      name: "Document quota source",
      type: "manual_text",
      metadata: {}
    });
    const first = await fixture.service.addDocument(source.id, {
      title: "First",
      content: "first active quota document",
      metadata: {}
    });

    await expect(
      fixture.service.addDocument(source.id, {
        title: "Second",
        content: "second active quota document",
        metadata: {}
      })
    ).rejects.toThrow("maxDocumentsPerGoal");
    await fixture.service.deleteDocument(first.document.id, {
      actor: "human_operator",
      reason: "free quota",
      hardDelete: false
    });
    const second = await fixture.service.addDocument(source.id, {
      title: "Second",
      content: "second active quota document",
      metadata: {}
    });

    expect(second.document.title).toBe("Second");
  });

  it("rejects max chunks per document and records quota audit", async () => {
    const fixture = createContextFixture({
      includeRetention: true,
      policy: { maxChunksPerDocument: 1 }
    });
    const source = await fixture.service.createSource(goal.id, {
      name: "Chunk quota source",
      type: "manual_text",
      metadata: {}
    });

    await expect(
      fixture.service.addDocument(source.id, {
        title: "Chunky",
        content: "approval ".repeat(300),
        metadata: {}
      })
    ).rejects.toThrow("maxChunksPerDocument");
    expect(fixture.auditEventRepository.events[0]).toMatchObject({
      eventType: "context_quota_rejected",
      reason: "max_chunks_per_document_exceeded"
    });
  });

  it("soft deletes, restores, excludes deleted documents from search and records audit", async () => {
    const fixture = createContextFixture({ includeRetention: true, includeEmbeddings: true });
    const source = await fixture.service.createSource(goal.id, {
      name: "Delete source",
      type: "manual_text",
      metadata: {}
    });
    const result = await fixture.service.addDocument(source.id, {
      title: "Deleted context",
      content: "deletion searchable phrase",
      metadata: {}
    });
    await fixture.seedEmbeddings(result.chunks.map((chunk) => ({
      chunkId: chunk.id,
      content: chunk.content
    })));

    const deleted = await fixture.service.deleteDocument(result.document.id, {
      actor: "human_operator",
      reason: "cleanup",
      hardDelete: false
    });
    const deletedSearch = await fixture.service.search(goal.id, {
      query: "searchable phrase",
      limit: 5,
      mode: "lexical"
    });
    const deletedVectorSearch = await fixture.service.search(goal.id, {
      query: "searchable phrase",
      limit: 5,
      mode: "mock_vector"
    });

    expect(deleted?.deletedAt).not.toBeNull();
    expect(fixture.chunkRepository.chunks.every((chunk) => chunk.deletedAt)).toBe(true);
    expect(deletedSearch.results).toEqual([]);
    expect(deletedVectorSearch.results).toEqual([]);
    await expect(
      fixture.service.deleteDocument(result.document.id, {
        actor: "human_operator",
        reason: "cleanup again",
        hardDelete: false
      })
    ).rejects.toThrow("already deleted");

    const restored = await fixture.service.restoreDocument(result.document.id, {
      actor: "human_operator",
      reason: "restore for test"
    });
    const restoredSearch = await fixture.service.search(goal.id, {
      query: "searchable phrase",
      limit: 5,
      mode: "lexical"
    });

    expect(restored.deletedAt).toBeNull();
    expect(restoredSearch.results).toHaveLength(1);
    await expect(
      fixture.service.restoreDocument(result.document.id, {
        actor: "human_operator",
        reason: "restore again"
      })
    ).rejects.toThrow("is not deleted");
    expect(fixture.auditEventRepository.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["context_document_deleted", "context_document_restored"])
    );
  });

  it("returns not found for unknown goals", async () => {
    const fixture = createContextFixture({ includeGoal: false });

    await expect(fixture.service.listSources(goal.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

function createContextFixture(options: {
  includeGoal?: boolean;
  includeEmbeddings?: boolean;
  includeRetention?: boolean;
  policy?: Partial<ContextRetentionPolicy>;
  configuredStorage?: "jsonb" | "pgvector";
  pgvectorStorage?: EmbeddingStorage;
} = {}) {
  const goalsRepository = new InMemoryGoalsRepository(options.includeGoal ?? true);
  const sourceRepository = new InMemoryContextSourceRepository();
  const documentRepository = new InMemoryContextDocumentRepository();
  const chunkRepository = new InMemoryContextChunkRepository(documentRepository, sourceRepository);
  const retrievalRepository = new InMemoryContextRetrievalRepository();
  const embeddingModelRepository = new InMemoryEmbeddingModelRepository();
  const chunkEmbeddingRepository = new InMemoryChunkEmbeddingRepository();
  const embeddingAdapter = new MockEmbeddingAdapter();
  const auditEventRepository = new InMemoryContextAuditEventRepository();
  const defaultPolicy = new ContextRetentionPolicyService(
    goalsRepository,
    sourceRepository,
    documentRepository,
    retrievalRepository,
    auditEventRepository
  ).getDefaultPolicy();
  const retentionPolicyService = options.includeRetention
    ? new ContextRetentionPolicyService(
        goalsRepository,
        sourceRepository,
        documentRepository,
        retrievalRepository,
        auditEventRepository,
        { ...defaultPolicy, ...options.policy }
      )
    : undefined;
  return {
    auditEventRepository,
    chunkRepository,
    seedEmbeddings: async (chunks: { chunkId: string; content: string }[]) => {
      const model = await embeddingModelRepository.getOrCreateMockModel();
      for (const chunk of chunks) {
        const embedding = await embeddingAdapter.embedText(chunk.content);
        await chunkEmbeddingRepository.upsertChunkEmbedding({
          chunkId: chunk.chunkId,
          modelId: model.id,
          embedding,
          embeddingHash: embeddingHash({
            modelName: embeddingAdapter.name,
            provider: embeddingAdapter.provider,
            dimension: embeddingAdapter.dimension,
            text: chunk.content,
            embedding
          })
        });
      }
    },
    service: new ContextEngineService(
      goalsRepository,
      sourceRepository,
      documentRepository,
      chunkRepository,
      retrievalRepository,
      undefined,
      options.includeEmbeddings ? embeddingModelRepository : undefined,
      options.includeEmbeddings ? chunkEmbeddingRepository : undefined,
      embeddingAdapter,
      undefined,
      retentionPolicyService,
      auditEventRepository,
      {
        configuredStorage: options.configuredStorage ?? "jsonb"
      },
      undefined,
      options.pgvectorStorage
    )
  };
}

function contextCandidate(input: {
  sourceName: string;
  title: string;
  content: string;
}): ContextSearchResult {
  return {
    source: {
      id: "00000000-0000-4000-8000-000000000010",
      goalId: goal.id,
      name: input.sourceName,
      type: "manual_text",
      metadata: {},
      deletedAt: null,
      deletedReason: null,
      createdAt: now,
      updatedAt: now
    },
    document: {
      id: "00000000-0000-4000-8000-000000000020",
      sourceId: "00000000-0000-4000-8000-000000000010",
      title: input.title,
      contentHash: "hash",
      classification: "internal",
      redactionStatus: "clean",
      sensitiveFindings: [],
      redactedContentHash: null,
      contentSize: input.content.length,
      deletedAt: null,
      deletedReason: null,
      metadata: {},
      createdAt: now,
      updatedAt: now
    },
    chunk: {
      id: "00000000-0000-4000-8000-000000000030",
      documentId: "00000000-0000-4000-8000-000000000020",
      chunkIndex: 0,
      content: input.content,
      tokenEstimate: 4,
      redactionStatus: "clean",
      contentSize: input.content.length,
      deletedAt: null,
      deletedReason: null,
      metadata: {},
      createdAt: now
    },
    score: 0,
    finalScore: 0,
    lexicalScore: 0,
    vectorScore: null,
    mode: "lexical",
    searchMode: "lexical",
    vectorStorageUsed: "none",
    fallbackUsed: false,
    fallbackReason: null
  };
}

class InMemoryGoalsRepository implements GoalsRepository {
  constructor(private readonly includeGoal: boolean) {}
  async create() {
    return goal;
  }
  async list() {
    return this.includeGoal ? [goal] : [];
  }
  async findById() {
    return this.includeGoal ? goal : null;
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
    return this.documents.find((document) => document.sourceId === sourceId && document.contentHash === contentHash) ?? null;
  }
  async listBySource(sourceId: string) {
    return this.documents.filter((document) => document.sourceId === sourceId);
  }
  async countActiveByGoal() {
    return this.documents.filter((document) => !document.deletedAt).length;
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
    const chunks = inputs.map((input) => {
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
    return chunks;
  }
  async listByDocument(documentId: string) {
    return this.chunks.filter((chunk) => chunk.documentId === documentId);
  }
  async listCandidatesByGoal(goalId: string) {
    return this.chunks.flatMap((chunk) => {
      const document = this.documents.documents.find((candidate) => candidate.id === chunk.documentId);
      const source = document ? this.sources.sources.find((candidate) => candidate.id === document.sourceId) : null;
      if (!document || !source || source.goalId !== goalId || document.deletedAt || source.deletedAt || chunk.deletedAt) {
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
  }): Promise<ContextRetrieval> {
    const retrieval: ContextRetrieval = {
      id: `00000000-0000-4000-8000-${String(this.retrievals.length + 400).padStart(12, "0")}`,
      goalId: input.goalId,
      query: input.query,
      results: input.results,
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
  async getOrCreateMockModel() {
    return embeddingModel;
  }
  async getOrCreateModel() {
    return embeddingModel;
  }
  async listEmbeddingModels() {
    return [embeddingModel];
  }
}

class InMemoryChunkEmbeddingRepository implements ChunkEmbeddingRepository {
  embeddings: ChunkEmbedding[] = [];
  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding> {
    const existing = this.embeddings.find(
      (embedding) => embedding.chunkId === input.chunkId && embedding.modelId === input.modelId
    );
    const next: ChunkEmbedding = {
      id: existing?.id ?? `00000000-0000-4000-8000-${String(this.embeddings.length + 900).padStart(12, "0")}`,
      chunkId: input.chunkId,
      modelId: input.modelId,
      embedding: input.embedding,
      embeddingHash: input.embeddingHash,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (existing) {
      this.embeddings = this.embeddings.map((embedding) => embedding.id === existing.id ? next : embedding);
    } else {
      this.embeddings.push(next);
    }
    return next;
  }
  async getEmbeddingsByChunkIds(chunkIds: string[], modelId: string) {
    return this.embeddings.filter((embedding) => chunkIds.includes(embedding.chunkId) && embedding.modelId === modelId);
  }
  async listChunkEmbeddings() {
    return this.embeddings;
  }
  async softDeleteByDocument() {}
  async restoreByDocument() {}
}

class InMemoryEmbeddingStorage implements EmbeddingStorage {
  scores: EmbeddingStorageSearchResult[] = [];

  constructor(
    readonly storageKind: "jsonb" | "pgvector",
    private readonly available: boolean
  ) {}

  seed(scores: EmbeddingStorageSearchResult[]): void {
    this.scores = scores;
  }

  async isAvailable() {
    return this.available;
  }

  async upsertChunkEmbedding() {}

  async searchSimilarChunks(input: {
    chunkIds: string[];
  }) {
    if (!this.available) {
      return [];
    }
    return this.scores.filter((score) => input.chunkIds.includes(score.chunkId));
  }
}
