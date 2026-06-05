import type { ContextSearchResult } from "@triforge/shared";
import type {
  ChunkEmbeddingRepository,
  UpsertChunkEmbeddingInput
} from "../../domain/ports.js";
import type { DbQueryable } from "../../db/pool.js";
import {
  cosineSimilarity,
  normalizeCosineScore
} from "./mockEmbeddingAdapter.js";

export type EmbeddingStorageKind = "jsonb" | "pgvector";

export type EmbeddingStorageSearchResult = {
  chunkId: string;
  vectorScore: number;
};

export interface EmbeddingStorage {
  readonly storageKind: EmbeddingStorageKind;
  isAvailable(): Promise<boolean>;
  upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<void>;
  searchSimilarChunks(input: {
    queryEmbedding: number[];
    chunkIds: string[];
    modelId: string;
    candidates?: ContextSearchResult[];
  }): Promise<EmbeddingStorageSearchResult[]>;
}

export class JsonbEmbeddingStorage implements EmbeddingStorage {
  readonly storageKind = "jsonb";

  constructor(private readonly chunkEmbeddingRepository: ChunkEmbeddingRepository) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<void> {
    await this.chunkEmbeddingRepository.upsertChunkEmbedding(input);
  }

  async searchSimilarChunks(input: {
    queryEmbedding: number[];
    chunkIds: string[];
    modelId: string;
  }): Promise<EmbeddingStorageSearchResult[]> {
    const embeddings = await this.chunkEmbeddingRepository.getEmbeddingsByChunkIds(
      input.chunkIds,
      input.modelId
    );
    return embeddings.map((embedding) => ({
      chunkId: embedding.chunkId,
      vectorScore: normalizeCosineScore(
        cosineSimilarity(input.queryEmbedding, embedding.embedding)
      )
    }));
  }
}

export class PgvectorEmbeddingStorage implements EmbeddingStorage {
  readonly storageKind = "pgvector";

  constructor(private readonly db: DbQueryable) {}

  async isAvailable(): Promise<boolean> {
    const result = await this.db.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_available_extensions
          WHERE name = 'vector'
        ) AS available
      `
    );
    return Boolean(result.rows[0]?.available);
  }

  async upsertChunkEmbedding(): Promise<void> {
    throw new Error("pgvector embedding storage is not active in this milestone");
  }

  async searchSimilarChunks(): Promise<EmbeddingStorageSearchResult[]> {
    return [];
  }
}
