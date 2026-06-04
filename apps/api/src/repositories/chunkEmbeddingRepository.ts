import type { ChunkEmbedding } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type {
  ChunkEmbeddingRepository,
  UpsertChunkEmbeddingInput
} from "../domain/ports.js";
import { mapChunkEmbedding } from "./mappers.js";

export class PgChunkEmbeddingRepository implements ChunkEmbeddingRepository {
  constructor(private readonly db: DbQueryable) {}

  async upsertChunkEmbedding(input: UpsertChunkEmbeddingInput): Promise<ChunkEmbedding> {
    const result = await this.db.query(
      `
        INSERT INTO context_chunk_embeddings (
          chunk_id,
          model_id,
          embedding,
          embedding_hash
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (chunk_id, model_id)
        DO UPDATE SET
          embedding = EXCLUDED.embedding,
          embedding_hash = EXCLUDED.embedding_hash,
          deleted_at = NULL,
          updated_at = now()
        RETURNING *
      `,
      [
        input.chunkId,
        input.modelId,
        JSON.stringify(input.embedding),
        input.embeddingHash
      ]
    );
    return mapChunkEmbedding(result.rows[0]);
  }

  async getEmbeddingsByChunkIds(
    chunkIds: string[],
    modelId: string
  ): Promise<ChunkEmbedding[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const result = await this.db.query(
      `
        SELECT *
        FROM context_chunk_embeddings
        WHERE model_id = $1
          AND chunk_id = ANY($2::uuid[])
          AND deleted_at IS NULL
      `,
      [modelId, chunkIds]
    );
    return result.rows.map(mapChunkEmbedding);
  }

  async listChunkEmbeddings(documentId: string): Promise<ChunkEmbedding[]> {
    const result = await this.db.query(
      `
        SELECT e.*
        FROM context_chunk_embeddings e
        INNER JOIN context_chunks c ON c.id = e.chunk_id
        INNER JOIN context_documents d ON d.id = c.document_id
        WHERE c.document_id = $1
          AND d.deleted_at IS NULL
          AND c.deleted_at IS NULL
          AND e.deleted_at IS NULL
        ORDER BY c.chunk_index ASC
      `,
      [documentId]
    );
    return result.rows.map(mapChunkEmbedding);
  }

  async softDeleteByDocument(documentId: string): Promise<void> {
    await this.db.query(
      `
        UPDATE context_chunk_embeddings e
        SET deleted_at = now()
        FROM context_chunks c
        WHERE e.chunk_id = c.id
          AND c.document_id = $1
      `,
      [documentId]
    );
  }

  async restoreByDocument(documentId: string): Promise<void> {
    await this.db.query(
      `
        UPDATE context_chunk_embeddings e
        SET deleted_at = NULL
        FROM context_chunks c
        WHERE e.chunk_id = c.id
          AND c.document_id = $1
      `,
      [documentId]
    );
  }
}
