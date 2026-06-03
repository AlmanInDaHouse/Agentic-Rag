import type { EmbeddingModel } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type { EmbeddingModelRepository } from "../domain/ports.js";
import { mapEmbeddingModel } from "./mappers.js";

export class PgEmbeddingModelRepository implements EmbeddingModelRepository {
  constructor(private readonly db: DbQueryable) {}

  async getOrCreateMockModel(): Promise<EmbeddingModel> {
    const result = await this.db.query(
      `
        INSERT INTO embedding_models (name, provider, dimension, metadata)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name, provider)
        DO UPDATE SET updated_at = embedding_models.updated_at
        RETURNING *
      `,
      [
        "mock_embedding_v1",
        "mock",
        32,
        JSON.stringify({ deterministic: true, semantic: false })
      ]
    );
    return mapEmbeddingModel(result.rows[0]);
  }

  async listEmbeddingModels(): Promise<EmbeddingModel[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM embedding_models
        ORDER BY provider ASC, name ASC
      `
    );
    return result.rows.map(mapEmbeddingModel);
  }
}
