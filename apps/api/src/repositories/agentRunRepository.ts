import type { AgentRun, AgentRunStatus } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import type { AgentRunRepository, CreateRunInput } from "../domain/ports.js";
import { mapAgentRun } from "./mappers.js";

const terminalStatuses = new Set<AgentRunStatus>(["completed", "failed", "cancelled", "stopped"]);

export class PgAgentRunRepository implements AgentRunRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateRunInput): Promise<AgentRun> {
    const result = await this.db.query(
      `
        INSERT INTO agent_runs (
          goal_id,
          objective,
          definition_of_done,
          max_steps,
          max_failures
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [
        input.goalId,
        input.objective,
        JSON.stringify(input.definitionOfDone),
        input.maxSteps,
        input.maxFailures
      ]
    );
    return mapAgentRun(result.rows[0]);
  }

  async findById(id: string): Promise<AgentRun | null> {
    const result = await this.db.query("SELECT * FROM agent_runs WHERE id = $1", [id]);
    return result.rows[0] ? mapAgentRun(result.rows[0]) : null;
  }

  async listByGoal(goalId: string): Promise<AgentRun[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM agent_runs
        WHERE goal_id = $1
        ORDER BY created_at DESC
      `,
      [goalId]
    );
    return result.rows.map(mapAgentRun);
  }

  async updateStatus(id: string, status: AgentRunStatus): Promise<AgentRun> {
    const result = await this.db.query(
      `
        UPDATE agent_runs
        SET status = $2,
            completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE completed_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, status, terminalStatuses.has(status)]
    );
    return mapAgentRun(result.rows[0]);
  }

  async markStarted(id: string): Promise<AgentRun> {
    const result = await this.db.query(
      `
        UPDATE agent_runs
        SET status = 'running',
            started_at = COALESCE(started_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    return mapAgentRun(result.rows[0]);
  }

  async markCompleted(id: string): Promise<AgentRun> {
    const result = await this.db.query(
      `
        UPDATE agent_runs
        SET status = 'completed',
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    return mapAgentRun(result.rows[0]);
  }

  async advanceIndex(id: string, nextStepIndex: number): Promise<AgentRun> {
    const result = await this.db.query(
      `
        UPDATE agent_runs
        SET current_step_index = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, nextStepIndex]
    );
    return mapAgentRun(result.rows[0]);
  }

  async incrementFailure(id: string): Promise<AgentRun> {
    const result = await this.db.query(
      `
        UPDATE agent_runs
        SET failure_count = failure_count + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
    return mapAgentRun(result.rows[0]);
  }
}
