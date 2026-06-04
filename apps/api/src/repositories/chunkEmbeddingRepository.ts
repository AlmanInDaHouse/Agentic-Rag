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
        WHERE c.document_id = $1
        ORDER BY c.chunk_index ASC
      `,
      [documentId]
    );
    return result.rows.map(mapChunkEmbedding);
  }
}
