import type { ContextRetrieval, ContextSearchResult } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type { ContextRetrievalRepository } from "../domain/ports.js";
import { mapContextRetrieval } from "./mappers.js";

export class PgContextRetrievalRepository implements ContextRetrievalRepository {
  constructor(private readonly db: DbQueryable) {}

  async create(input: {
    goalId: string;
    query: string;
    results: ContextSearchResult[];
  }): Promise<ContextRetrieval> {
    const result = await this.db.query(
      `
        INSERT INTO context_retrievals (goal_id, query, results)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [input.goalId, input.query, JSON.stringify(input.results)]
    );
    return mapContextRetrieval(result.rows[0]);
  }

  async listByGoal(goalId: string): Promise<ContextRetrieval[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM context_retrievals
        WHERE goal_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `,
      [goalId]
    );
    return result.rows.map(mapContextRetrieval);
  }

  async countByGoal(goalId: string): Promise<number> {
    const result = await this.db.query(
      `
        SELECT count(*)::int AS count
        FROM context_retrievals
        WHERE goal_id = $1
      `,
      [goalId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
