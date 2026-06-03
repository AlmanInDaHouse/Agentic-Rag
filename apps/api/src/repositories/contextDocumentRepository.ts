import type { ContextDocument } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import { ConflictError } from "../domain/errors.js";
import type {
  ContextDocumentRepository,
  CreateContextDocumentInput
} from "../domain/ports.js";
import { mapContextDocument } from "./mappers.js";

export class PgContextDocumentRepository implements ContextDocumentRepository {
  constructor(private readonly db: DbQueryable) {}

  async create(input: CreateContextDocumentInput): Promise<ContextDocument> {
    try {
      const result = await this.db.query(
        `
          INSERT INTO context_documents (source_id, title, content_hash, metadata)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [
          input.sourceId,
          input.title,
          input.contentHash,
          JSON.stringify(input.metadata)
        ]
      );
      return mapContextDocument(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Context document already exists for this source");
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ContextDocument | null> {
    const result = await this.db.query("SELECT * FROM context_documents WHERE id = $1", [id]);
    return result.rows[0] ? mapContextDocument(result.rows[0]) : null;
  }

  async findBySourceAndHash(
    sourceId: string,
    contentHash: string
  ): Promise<ContextDocument | null> {
    const result = await this.db.query(
      "SELECT * FROM context_documents WHERE source_id = $1 AND content_hash = $2",
      [sourceId, contentHash]
    );
    return result.rows[0] ? mapContextDocument(result.rows[0]) : null;
  }

  async listBySource(sourceId: string): Promise<ContextDocument[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM context_documents
        WHERE source_id = $1
        ORDER BY created_at DESC
      `,
      [sourceId]
    );
    return result.rows.map(mapContextDocument);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
