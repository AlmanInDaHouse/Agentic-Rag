import type { EmbeddingModel } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type {
  EmbeddingModelRepository,
  GetOrCreateEmbeddingModelInput
} from "../domain/ports.js";
import { mapEmbeddingModel } from "./mappers.js";

export class PgEmbeddingModelRepository implements EmbeddingModelRepository {
  constructor(private readonly db: DbQueryable) {}

  async getOrCreateMockModel(): Promise<EmbeddingModel> {
    return this.getOrCreateModel({
      name: "mock_embedding_v1",
      provider: "mock",
      dimension: 32,
      storageKind: "jsonb",
      metadata: { deterministic: true, semantic: false }
    });
  }

  async getOrCreateModel(input: GetOrCreateEmbeddingModelInput): Promise<EmbeddingModel> {
    const result = await this.db.query(
      `
        INSERT INTO embedding_models (name, provider, dimension, storage_kind, metadata)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name, provider)
        DO UPDATE SET
          dimension = EXCLUDED.dimension,
          storage_kind = EXCLUDED.storage_kind,
          metadata = embedding_models.metadata || EXCLUDED.metadata,
          updated_at = now()
        RETURNING *
      `,
      [
        input.name,
        input.provider,
        input.dimension,
        input.storageKind ?? "jsonb",
        JSON.stringify(input.metadata ?? {})
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
