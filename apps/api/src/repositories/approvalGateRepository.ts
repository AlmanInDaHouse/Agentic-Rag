import type { ApprovalGate, CreateApprovalGate, ResolveApprovalGate } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import type { ApprovalGateRepository } from "../domain/ports.js";
import { mapApprovalGate } from "./mappers.js";

export class PgApprovalGateRepository implements ApprovalGateRepository {
  constructor(private readonly db: DbPool) {}

  async create(input: CreateApprovalGate): Promise<ApprovalGate> {
    const result = await this.db.query(
      `
        INSERT INTO approval_gates (
          run_id,
          step_id,
          risk_level,
          action_type,
          action_payload,
          reason,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        input.runId,
        input.stepId,
        input.riskLevel,
        input.actionType,
        JSON.stringify(input.actionPayload),
        input.reason,
        input.expiresAt
      ]
    );
    return mapApprovalGate(result.rows[0]);
  }

  async findById(id: string): Promise<ApprovalGate | null> {
    const result = await this.db.query("SELECT * FROM approval_gates WHERE id = $1", [id]);
    return result.rows[0] ? mapApprovalGate(result.rows[0]) : null;
  }

  async listByRun(runId: string): Promise<ApprovalGate[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM approval_gates
        WHERE run_id = $1
        ORDER BY requested_at ASC
      `,
      [runId]
    );
    return result.rows.map(mapApprovalGate);
  }

  async resolve(
    id: string,
    input: ResolveApprovalGate & { decision: "approved" | "rejected" }
  ): Promise<ApprovalGate> {
    const result = await this.db.query(
      `
        UPDATE approval_gates
        SET status = $2,
            decision = $2,
            reason = $3,
            resolved_by = $4,
            resolved_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, input.decision, input.reason, input.resolvedBy]
    );
    return mapApprovalGate(result.rows[0]);
  }
}
