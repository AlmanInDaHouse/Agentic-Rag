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

export type EmbeddingStorageUpsertInput = UpsertChunkEmbeddingInput & {
  chunkEmbeddingId?: string;
};

export type PgvectorAvailability = {
  extensionAvailable: boolean;
  tableAvailable: boolean;
  available: boolean;
  fallbackReason: string | null;
};

export interface EmbeddingStorage {
  readonly storageKind: EmbeddingStorageKind;
  isAvailable(): Promise<boolean>;
  upsertChunkEmbedding(input: EmbeddingStorageUpsertInput): Promise<void>;
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
    const availability = await this.getAvailability();
    return availability.available;
  }

  async getAvailability(): Promise<PgvectorAvailability> {
    const extensionResult = await this.db.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'vector'
        ) AS extension_available
      `
    );
    const extensionAvailable = Boolean(extensionResult.rows[0]?.extension_available);
    if (!extensionAvailable) {
      return {
        extensionAvailable,
        tableAvailable: false,
        available: false,
        fallbackReason: "pgvector_extension_unavailable"
      };
    }

    const tableResult = await this.db.query(
      `
        SELECT to_regclass('context_chunk_vector_embeddings') IS NOT NULL AS table_available
      `
    );
    const tableAvailable = Boolean(tableResult.rows[0]?.table_available);
    return {
      extensionAvailable,
      tableAvailable,
      available: tableAvailable,
      fallbackReason: tableAvailable ? null : "pgvector_table_unavailable"
    };
  }

  async upsertChunkEmbedding(input: EmbeddingStorageUpsertInput): Promise<void> {
    if (!input.chunkEmbeddingId || !(await this.isAvailable())) {
      return;
    }

    await this.db.query(
      `
        INSERT INTO context_chunk_vector_embeddings (
          chunk_embedding_id,
          model_id,
          chunk_id,
          embedding
        )
        VALUES ($1, $2, $3, $4::vector)
        ON CONFLICT (chunk_id, model_id)
        DO UPDATE SET
          chunk_embedding_id = EXCLUDED.chunk_embedding_id,
          embedding = EXCLUDED.embedding
      `,
      [
        input.chunkEmbeddingId,
        input.modelId,
        input.chunkId,
        toPgvectorLiteral(input.embedding)
      ]
    );
  }

  async searchSimilarChunks(input: {
    queryEmbedding: number[];
    chunkIds: string[];
    modelId: string;
  }): Promise<EmbeddingStorageSearchResult[]> {
    if (input.chunkIds.length === 0 || !(await this.isAvailable())) {
      return [];
    }

    const result = await this.db.query(
      `
        SELECT
          ve.chunk_id,
          greatest(0, 1 - (ve.embedding <=> $1::vector))::float8 AS vector_score
        FROM context_chunk_vector_embeddings ve
        INNER JOIN context_chunk_embeddings ce ON ce.id = ve.chunk_embedding_id
        INNER JOIN context_chunks c ON c.id = ve.chunk_id
        INNER JOIN context_documents d ON d.id = c.document_id
        INNER JOIN context_sources s ON s.id = d.source_id
        WHERE ve.model_id = $2
          AND ve.chunk_id = ANY($3::uuid[])
          AND ce.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND d.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY ve.embedding <=> $1::vector ASC, c.chunk_index ASC, ve.chunk_id ASC
      `,
      [toPgvectorLiteral(input.queryEmbedding), input.modelId, input.chunkIds]
    );

    return result.rows.map((row) => ({
      chunkId: String(row.chunk_id),
      vectorScore: Number(row.vector_score)
    }));
  }
}

export function toPgvectorLiteral(embedding: number[]): string {
  if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("pgvector embedding must contain finite values");
  }
  return `[${embedding.join(",")}]`;
}
