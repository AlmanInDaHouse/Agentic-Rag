import { describe, expect, it } from "vitest";
import type { ChunkEmbedding } from "@triforge/shared";
import type { ChunkEmbeddingRepository, UpsertChunkEmbeddingInput } from "../domain/ports.js";
import {
  JsonbEmbeddingStorage,
  PgvectorEmbeddingStorage
} from "../services/embeddings/embeddingStorage.js";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();

describe("EmbeddingStorage", () => {
  it("uses JSONB storage for existing chunk embedding similarity", async () => {
    const repository = new InMemoryChunkEmbeddingRepository();
    await repository.upsertChunkEmbedding({
      chunkId: "00000000-0000-4000-8000-000000000001",
      modelId: "00000000-0000-4000-8000-000000000002",
      embedding: [1, 0],
      embeddingHash: "hash"
    });
    const storage = new JsonbEmbeddingStorage(repository);

    await expect(storage.isAvailable()).resolves.toBe(true);
    const results = await storage.searchSimilarChunks({
      queryEmbedding: [1, 0],
      chunkIds: ["00000000-0000-4000-8000-000000000001"],
      modelId: "00000000-0000-4000-8000-000000000002"
    });

    expect(results).toEqual([
      {
        chunkId: "00000000-0000-4000-8000-000000000001",
        vectorScore: 1
      }
    ]);
  });

  it("detects pgvector availability without requiring the extension", async () => {
    const storage = new PgvectorEmbeddingStorage({
      query: async () => ({
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ available: false }]
      })
    });

    await expect(storage.isAvailable()).resolves.toBe(false);
    await expect(storage.searchSimilarChunks()).resolves.toEqual([]);
  });
});

class InMemoryChunkEmbeddingRepository implements ChunkEmbeddingRepository {
  embeddings: ChunkEmbedding[] = [];

  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding> {
    const embedding = {
      id: "00000000-0000-4000-8000-000000000010",
      chunkId: input.chunkId,
      modelId: input.modelId,
      embedding: input.embedding,
      embeddingHash: input.embeddingHash,
      createdAt: now,
      updatedAt: now
    };
    this.embeddings.push(embedding);
    return embedding;
  }

  async getEmbeddingsByChunkIds(chunkIds: string[], modelId: string) {
    return this.embeddings.filter(
      (embedding) => chunkIds.includes(embedding.chunkId) && embedding.modelId === modelId
    );
  }

  async listChunkEmbeddings() {
    return this.embeddings;
  }

  async softDeleteByDocument() {}
  async restoreByDocument() {}
}
