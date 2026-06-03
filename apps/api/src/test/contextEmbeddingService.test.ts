import { describe, expect, it } from "vitest";
import type { ChunkEmbedding, ContextChunk, ContextDocument, ContextSource, EmbeddingModel } from "@triforge/shared";
import type {
  ChunkEmbeddingRepository,
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextSourceRepository,
  CreateContextChunkInput,
  CreateContextDocumentInput,
  CreateContextSourceInput,
  EmbeddingModelRepository,
  UpsertChunkEmbeddingInput
} from "../domain/ports.js";
import { NotFoundError } from "../domain/errors.js";
import { ContextEmbeddingService } from "../services/contextEmbeddingService.js";
import { MockEmbeddingAdapter } from "../services/embeddings/mockEmbeddingAdapter.js";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
const model: EmbeddingModel = {
  id: "00000000-0000-4000-8000-000000000900",
  name: "mock_embedding_v1",
  provider: "mock",
  dimension: 32,
  isActive: true,
  metadata: {},
  createdAt: now,
  updatedAt: now
};

describe("ContextEmbeddingService", () => {
  it("generates document embeddings idempotently", async () => {
    const fixture = createEmbeddingFixture();

    const first = await fixture.service.generateEmbeddingsForDocument(fixture.document.id);
    const second = await fixture.service.generateEmbeddingsForDocument(fixture.document.id);
    const coverage = await fixture.service.getEmbeddingCoverageForDocument(fixture.document.id);

    expect(first.generatedCount).toBe(2);
    expect(second.generatedCount).toBe(0);
    expect(second.skippedCount).toBe(2);
    expect(coverage.embeddedChunkCount).toBe(2);
    expect(coverage.coverage).toBe(1);
    expect(new Set(coverage.embeddings.map((embedding) => embedding.chunkId)).size).toBe(2);
  });

  it("returns not found for a missing document", async () => {
    const fixture = createEmbeddingFixture();

    await expect(
      fixture.service.generateEmbeddingsForDocument("00000000-0000-4000-8000-000000000999")
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

function createEmbeddingFixture() {
  const sourceRepository = new InMemorySourceRepository();
  const documentRepository = new InMemoryDocumentRepository();
  const chunkRepository = new InMemoryChunkRepository();
  const embeddingModelRepository = new InMemoryEmbeddingModelRepository();
  const chunkEmbeddingRepository = new InMemoryChunkEmbeddingRepository();
  const source = sourceRepository.seed();
  const document = documentRepository.seed(source.id);
  chunkRepository.seed(document.id);

  return {
    document,
    service: new ContextEmbeddingService(
      sourceRepository,
      documentRepository,
      chunkRepository,
      embeddingModelRepository,
      chunkEmbeddingRepository,
      new MockEmbeddingAdapter()
    )
  };
}

class InMemorySourceRepository implements ContextSourceRepository {
  sources: ContextSource[] = [];
  seed(): ContextSource {
    const source: ContextSource = {
      id: "00000000-0000-4000-8000-000000000700",
      goalId: "00000000-0000-4000-8000-000000000001",
      name: "Embedding source",
      type: "manual_text",
      metadata: {},
      createdAt: now,
      updatedAt: now
    };
    this.sources.push(source);
    return source;
  }
  async create(input: CreateContextSourceInput): Promise<ContextSource> {
    const source = { ...this.seed(), ...input };
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

class InMemoryDocumentRepository implements ContextDocumentRepository {
  documents: ContextDocument[] = [];
  seed(sourceId: string): ContextDocument {
    const document: ContextDocument = {
      id: "00000000-0000-4000-8000-000000000710",
      sourceId,
      title: "Embedding document",
      contentHash: "hash",
      metadata: {},
      createdAt: now,
      updatedAt: now
    };
    this.documents.push(document);
    return document;
  }
  async create(input: CreateContextDocumentInput): Promise<ContextDocument> {
    const document = { ...this.seed(input.sourceId), ...input };
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

class InMemoryChunkRepository implements ContextChunkRepository {
  chunks: ContextChunk[] = [];
  seed(documentId: string): void {
    this.chunks.push(
      {
        id: "00000000-0000-4000-8000-000000000720",
        documentId,
        chunkIndex: 0,
        content: "first chunk",
        tokenEstimate: 3,
        metadata: {},
        createdAt: now
      },
      {
        id: "00000000-0000-4000-8000-000000000721",
        documentId,
        chunkIndex: 1,
        content: "second chunk",
        tokenEstimate: 3,
        metadata: {},
        createdAt: now
      }
    );
  }
  async createMany(inputs: CreateContextChunkInput[]): Promise<ContextChunk[]> {
    const chunks = inputs.map((input, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 720).padStart(12, "0")}`,
      documentId: input.documentId,
      chunkIndex: input.chunkIndex,
      content: input.content,
      tokenEstimate: input.tokenEstimate,
      metadata: input.metadata ?? {},
      createdAt: now
    }));
    this.chunks.push(...chunks);
    return chunks;
  }
  async listByDocument(documentId: string) {
    return this.chunks.filter((chunk) => chunk.documentId === documentId);
  }
  async listCandidatesByGoal() {
    return [];
  }
}

class InMemoryEmbeddingModelRepository implements EmbeddingModelRepository {
  async getOrCreateMockModel() {
    return model;
  }
  async listEmbeddingModels() {
    return [model];
  }
}

class InMemoryChunkEmbeddingRepository implements ChunkEmbeddingRepository {
  embeddings: ChunkEmbedding[] = [];
  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding> {
    const existing = this.embeddings.find(
      (embedding) => embedding.chunkId === input.chunkId && embedding.modelId === input.modelId
    );
    const next: ChunkEmbedding = {
      id: existing?.id ?? `00000000-0000-4000-8000-${String(this.embeddings.length + 800).padStart(12, "0")}`,
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
  async listChunkEmbeddings(documentId: string) {
    return this.embeddings.filter((embedding) => embedding.chunkId.startsWith(documentId));
  }
}
