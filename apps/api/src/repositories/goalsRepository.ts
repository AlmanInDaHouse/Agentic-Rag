import type { CreateGoalRequest, Goal } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import type { GoalsRepository } from "../domain/ports.js";
import { mapGoal } from "./mappers.js";

export class PgGoalsRepository implements GoalsRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateGoalRequest): Promise<Goal> {
    const result = await this.db.query(
      `
        INSERT INTO goals (title, description)
        VALUES ($1, $2)
        RETURNING *
      `,
      [input.title, input.description]
    );
    return mapGoal(result.rows[0]);
  }

  async list(): Promise<Goal[]> {
    const result = await this.db.query("SELECT * FROM goals ORDER BY created_at DESC LIMIT 100");
    return result.rows.map(mapGoal);
  }

  async findById(id: string): Promise<Goal | null> {
    const result = await this.db.query("SELECT * FROM goals WHERE id = $1", [id]);
    return result.rows[0] ? mapGoal(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: Goal["status"]): Promise<void> {
    await this.db.query(
      "UPDATE goals SET status = $2, updated_at = now() WHERE id = $1",
      [id, status]
    );
  }
}
