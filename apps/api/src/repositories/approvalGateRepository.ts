import type { ApprovalGate } from "@triforge/shared";
import type { DbPool } from "../db/pool.js";
import type { ApprovalGateRepository } from "../domain/ports.js";
import { mapApprovalGate } from "./mappers.js";

export class PgApprovalGateRepository implements ApprovalGateRepository {
  constructor(private readonly db: DbPool) {}

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
}
