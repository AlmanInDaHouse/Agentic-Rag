import type { ContextAuditEvent } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type {
  ContextAuditEventRepository,
  CreateContextAuditEventInput
} from "../domain/ports.js";
import { mapContextAuditEvent } from "./mappers.js";

export class PgContextAuditEventRepository implements ContextAuditEventRepository {
  constructor(private readonly db: DbQueryable) {}

  async create(input: CreateContextAuditEventInput): Promise<ContextAuditEvent> {
    const result = await this.db.query(
      `
        INSERT INTO context_audit_events (
          goal_id,
          source_id,
          document_id,
          chunk_id,
          event_type,
          actor,
          reason,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        input.goalId ?? null,
        input.sourceId ?? null,
        input.documentId ?? null,
        input.chunkId ?? null,
        input.eventType,
        input.actor ?? "system",
        input.reason ?? null,
        JSON.stringify(input.payload ?? {})
      ]
    );
    return mapContextAuditEvent(result.rows[0]);
  }

  async listByGoal(goalId: string): Promise<ContextAuditEvent[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM context_audit_events
        WHERE goal_id = $1
        ORDER BY created_at DESC
        LIMIT 200
      `,
      [goalId]
    );
    return result.rows.map(mapContextAuditEvent);
  }
}
