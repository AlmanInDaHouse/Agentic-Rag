import type { ContextChunk, ContextSearchResult } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type {
  ContextChunkRepository,
  CreateContextChunkInput
} from "../domain/ports.js";
import {
  mapContextChunk,
  mapContextDocument,
  mapContextSource
} from "./mappers.js";

export class PgContextChunkRepository implements ContextChunkRepository {
  constructor(private readonly db: DbQueryable) {}

  async createMany(chunks: CreateContextChunkInput[]): Promise<ContextChunk[]> {
    const created: ContextChunk[] = [];
    for (const chunk of chunks) {
      const result = await this.db.query(
        `
          INSERT INTO context_chunks (
            document_id,
            chunk_index,
            content,
            content_size,
            token_estimate,
            redaction_status,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [
          chunk.documentId,
          chunk.chunkIndex,
          chunk.content,
          chunk.contentSize,
          chunk.tokenEstimate,
          chunk.redactionStatus ?? "not_scanned",
          JSON.stringify(chunk.metadata ?? {})
        ]
      );
      created.push(mapContextChunk(result.rows[0]));
    }
    return created;
  }

  async listByDocument(documentId: string): Promise<ContextChunk[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM context_chunks
        WHERE document_id = $1
        ORDER BY chunk_index ASC
      `,
      [documentId]
    );
    return result.rows.map(mapContextChunk);
  }

  async listCandidatesByGoal(goalId: string, limit: number): Promise<ContextSearchResult[]> {
    const result = await this.db.query(
      `
        SELECT
          c.id AS chunk_id,
          c.document_id,
          c.chunk_index,
          c.content,
          c.content_size AS chunk_content_size,
          c.token_estimate,
          c.redaction_status AS chunk_redaction_status,
          c.deleted_at AS chunk_deleted_at,
          c.deleted_reason AS chunk_deleted_reason,
          c.metadata AS chunk_metadata,
          c.created_at AS chunk_created_at,
          d.id AS document_id_value,
          d.source_id,
          d.title,
          d.content_hash,
          d.classification,
          d.redaction_status AS document_redaction_status,
          d.sensitive_findings,
          d.redacted_content_hash,
          d.content_size AS document_content_size,
          d.deleted_at AS document_deleted_at,
          d.deleted_reason AS document_deleted_reason,
          d.metadata AS document_metadata,
          d.created_at AS document_created_at,
          d.updated_at AS document_updated_at,
          s.id AS source_id_value,
          s.goal_id,
          s.name,
          s.type,
          s.deleted_at AS source_deleted_at,
          s.deleted_reason AS source_deleted_reason,
          s.metadata AS source_metadata,
          s.created_at AS source_created_at,
          s.updated_at AS source_updated_at
        FROM context_chunks c
        INNER JOIN context_documents d ON d.id = c.document_id
        INNER JOIN context_sources s ON s.id = d.source_id
        WHERE s.goal_id = $1
          AND s.deleted_at IS NULL
          AND d.deleted_at IS NULL
          AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT $2
      `,
      [goalId, limit]
    );

    return result.rows.map((row) => ({
      source: mapContextSource({
        id: row.source_id_value,
        goal_id: row.goal_id,
        name: row.name,
        type: row.type,
        metadata: row.source_metadata,
        deleted_at: row.source_deleted_at,
        deleted_reason: row.source_deleted_reason,
        created_at: row.source_created_at,
        updated_at: row.source_updated_at
      }),
      document: mapContextDocument({
        id: row.document_id_value,
        source_id: row.source_id,
        title: row.title,
        content_hash: row.content_hash,
        classification: row.classification,
        redaction_status: row.document_redaction_status,
        sensitive_findings: row.sensitive_findings,
        redacted_content_hash: row.redacted_content_hash,
        content_size: row.document_content_size,
        deleted_at: row.document_deleted_at,
        deleted_reason: row.document_deleted_reason,
        metadata: row.document_metadata,
        created_at: row.document_created_at,
        updated_at: row.document_updated_at
      }),
      chunk: mapContextChunk({
        id: row.chunk_id,
        document_id: row.document_id,
        chunk_index: row.chunk_index,
        content: row.content,
        content_size: row.chunk_content_size,
        token_estimate: row.token_estimate,
        redaction_status: row.chunk_redaction_status,
        deleted_at: row.chunk_deleted_at,
        deleted_reason: row.chunk_deleted_reason,
        metadata: row.chunk_metadata,
        created_at: row.chunk_created_at
      }),
      score: 0,
      finalScore: 0,
      lexicalScore: 0,
      vectorScore: null,
      mode: "lexical",
      searchMode: "lexical",
      vectorStorageUsed: "none",
      fallbackUsed: false,
      fallbackReason: null
    }));
  }

  async softDeleteByDocument(documentId: string, reason: string | null): Promise<void> {
    await this.db.query(
      `
        UPDATE context_chunks
        SET deleted_at = now(),
            deleted_reason = $2
        WHERE document_id = $1
      `,
      [documentId, reason]
    );
  }

  async restoreByDocument(documentId: string): Promise<void> {
    await this.db.query(
      `
        UPDATE context_chunks
        SET deleted_at = NULL,
            deleted_reason = NULL
        WHERE document_id = $1
      `,
      [documentId]
    );
  }
}
