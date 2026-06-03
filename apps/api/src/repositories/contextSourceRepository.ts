import type { ContextSource } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type { ContextSourceRepository, CreateContextSourceInput } from "../domain/ports.js";
import { mapContextSource } from "./mappers.js";

export class PgContextSourceRepository implements ContextSourceRepository {
  constructor(private readonly db: DbQueryable) {}

  async create(input: CreateContextSourceInput): Promise<ContextSource> {
    const result = await this.db.query(
      `
        INSERT INTO context_sources (goal_id, name, type, metadata)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [input.goalId, input.name, input.type, JSON.stringify(input.metadata)]
    );
    return mapContextSource(result.rows[0]);
  }

  async findById(id: string): Promise<ContextSource | null> {
    const result = await this.db.query("SELECT * FROM context_sources WHERE id = $1", [id]);
    return result.rows[0] ? mapContextSource(result.rows[0]) : null;
  }

  async listByGoal(goalId: string): Promise<ContextSource[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM context_sources
        WHERE goal_id = $1
        ORDER BY created_at DESC
      `,
      [goalId]
    );
    return result.rows.map(mapContextSource);
  }
}
