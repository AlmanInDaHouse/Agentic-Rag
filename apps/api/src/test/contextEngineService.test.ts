import { describe, expect, it } from "vitest";
import type {
  ContextChunk,
  ChunkEmbedding,
  ContextDocument,
  ContextRetrieval,
  ContextSearchResult,
  ContextSource,
  EmbeddingModel,
  Goal
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  ChunkEmbeddingRepository,
  CreateContextChunkInput,
  CreateContextDocumentInput,
  CreateContextSourceInput,
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
    expect(first.results[0].vectorScore).not.toBeNull();
    expect(first.results.map((item) => item.chunk.id)).toEqual(
      second.results.map((item) => item.chunk.id)
    );
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

  it("returns not found for unknown goals", async () => {
    const fixture = createContextFixture({ includeGoal: false });

    await expect(fixture.service.listSources(goal.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

function createContextFixture(options: { includeGoal?: boolean; includeEmbeddings?: boolean } = {}) {
  const goalsRepository = new InMemoryGoalsRepository(options.includeGoal ?? true);
  const sourceRepository = new InMemoryContextSourceRepository();
  const documentRepository = new InMemoryContextDocumentRepository();
  const chunkRepository = new InMemoryContextChunkRepository(documentRepository, sourceRepository);
  const retrievalRepository = new InMemoryContextRetrievalRepository();
  const embeddingModelRepository = new InMemoryEmbeddingModelRepository();
  const chunkEmbeddingRepository = new InMemoryChunkEmbeddingRepository();
  const embeddingAdapter = new MockEmbeddingAdapter();
  return {
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
      embeddingAdapter
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
      createdAt: now,
      updatedAt: now
    },
    document: {
      id: "00000000-0000-4000-8000-000000000020",
      sourceId: "00000000-0000-4000-8000-000000000010",
      title: input.title,
      contentHash: "hash",
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
      metadata: {},
      createdAt: now
    },
    score: 0,
    lexicalScore: 0,
    vectorScore: null,
    mode: "lexical",
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
      if (!document || !source || source.goalId !== goalId) {
        return [];
      }
      return [{
        source,
        document,
        chunk,
        score: 0,
        lexicalScore: 0,
        vectorScore: null,
        mode: "lexical" as const,
        fallbackReason: null
      }];
    });
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
}

class InMemoryEmbeddingModelRepository implements EmbeddingModelRepository {
  async getOrCreateMockModel() {
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
}
