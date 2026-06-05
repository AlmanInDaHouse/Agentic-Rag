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
          INSERT INTO context_documents (
            source_id,
            title,
            content_hash,
            classification,
            redaction_status,
            sensitive_findings,
            redacted_content_hash,
            content_size,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          input.sourceId,
          input.title,
          input.contentHash,
          input.classification,
          input.redactionStatus,
          JSON.stringify(input.sensitiveFindings),
          input.redactedContentHash,
          input.contentSize,
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

  async countActiveByGoal(goalId: string): Promise<number> {
    const result = await this.db.query(
      `
        SELECT count(*)::int AS count
        FROM context_documents d
        INNER JOIN context_sources s ON s.id = d.source_id
        WHERE s.goal_id = $1
          AND s.deleted_at IS NULL
          AND d.deleted_at IS NULL
      `,
      [goalId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async softDelete(id: string, reason: string | null): Promise<ContextDocument> {
    const result = await this.db.query(
      `
        UPDATE context_documents
        SET deleted_at = now(),
            deleted_reason = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, reason]
    );
    return mapContextDocument(result.rows[0]);
  }

  async restore(id: string, reason: string | null): Promise<ContextDocument> {
    const result = await this.db.query(
      `
        UPDATE context_documents
        SET deleted_at = NULL,
            deleted_reason = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, reason]
    );
    return mapContextDocument(result.rows[0]);
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.query("DELETE FROM context_documents WHERE id = $1", [id]);
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
