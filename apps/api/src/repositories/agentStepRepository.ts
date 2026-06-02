import type { AgentStep, AgentStepStatus } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import { ConflictError } from "../domain/errors.js";
import type {
  AgentStepRepository,
  CompleteStepInput,
  CreateStepInput,
  FailStepInput
} from "../domain/ports.js";
import { mapAgentStep } from "./mappers.js";

export class PgAgentStepRepository implements AgentStepRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateStepInput): Promise<AgentStep> {
    try {
      const result = await this.db.query(
        `
          INSERT INTO agent_steps (run_id, step_index, type, input)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [
          input.runId,
          input.stepIndex,
          input.type,
          JSON.stringify(input.input ?? {})
        ]
      );
      return mapAgentStep(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Run ${input.runId} already has a step at index ${input.stepIndex}`
        );
      }
      throw error;
    }
  }

  async updateStatus(id: string, status: AgentStepStatus): Promise<AgentStep> {
    const result = await this.db.query(
      `
        UPDATE agent_steps
        SET status = $2,
            started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, status]
    );
    return mapAgentStep(result.rows[0]);
  }

  async complete(input: CompleteStepInput): Promise<AgentStep> {
    const result = await this.db.query(
      `
        UPDATE agent_steps
        SET status = 'succeeded',
            output = $2,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.stepId, JSON.stringify(input.output)]
    );
    return mapAgentStep(result.rows[0]);
  }

  async fail(input: FailStepInput): Promise<AgentStep> {
    const result = await this.db.query(
      `
        UPDATE agent_steps
        SET status = 'failed',
            error = $2,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.stepId, JSON.stringify(input.error)]
    );
    return mapAgentStep(result.rows[0]);
  }

  async listByRun(runId: string): Promise<AgentStep[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM agent_steps
        WHERE run_id = $1
        ORDER BY step_index ASC
      `,
      [runId]
    );
    return result.rows.map(mapAgentStep);
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
