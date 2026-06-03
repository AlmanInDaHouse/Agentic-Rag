import type { ApprovalGate, CreateApprovalGate, ResolveApprovalGate } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import { ConflictError } from "../domain/errors.js";
import type { ApprovalGateRepository } from "../domain/ports.js";
import { mapApprovalGate } from "./mappers.js";

export class PgApprovalGateRepository implements ApprovalGateRepository {
  constructor(private readonly db: DbQueryable) {}

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

  async findByIdForUpdate(id: string): Promise<ApprovalGate | null> {
    try {
      const result = await this.db.query(
        "SELECT * FROM approval_gates WHERE id = $1 FOR UPDATE NOWAIT",
        [id]
      );
      return result.rows[0] ? mapApprovalGate(result.rows[0]) : null;
    } catch (error) {
      if (isLockUnavailable(error)) {
        throw new ConflictError(`Approval gate ${id} is already being resolved`);
      }
      throw error;
    }
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

  async listPendingByRunForUpdate(runId: string): Promise<ApprovalGate[]> {
    try {
      const result = await this.db.query(
        `
          SELECT *
          FROM approval_gates
          WHERE run_id = $1
            AND status = 'pending'
          ORDER BY requested_at ASC
          FOR UPDATE NOWAIT
        `,
        [runId]
      );
      return result.rows.map(mapApprovalGate);
    } catch (error) {
      if (isLockUnavailable(error)) {
        throw new ConflictError(`Pending approval gates for run ${runId} are being resolved`);
      }
      throw error;
    }
  }

  async resolve(
    id: string,
    input: ResolveApprovalGate & { decision: "approved" | "rejected" | "expired" }
  ): Promise<ApprovalGate> {
    const result = await this.db.query(
      `
        UPDATE approval_gates
        SET status = $2,
            decision = $2,
            reason = $3,
            resolved_by = $4,
            actor_role = $5,
            resolved_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, input.decision, input.reason, input.resolvedBy, input.actorRole]
    );
    return mapApprovalGate(result.rows[0]);
  }
}

function isLockUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "55P03"
  );
}
