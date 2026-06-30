/**
 * Durable IntegratedRunStore backed by PostgreSQL (A10-W.8b). Survives a process
 * restart: a run + its events are reconstructed entirely from `integrated_runs` and
 * `integrated_run_events` (mandate §8, §12). All writes are parameterized; jsonb is
 * explicitly serialized (node-pg does not auto-encode objects).
 */

import type { Pool } from "pg";
import type {
  IntegratedRunEvent,
  IntegratedRunPatch,
  IntegratedRunRecord,
  IntegratedRunStore
} from "./types.js";

interface RunRow {
  id: string;
  status: IntegratedRunRecord["status"];
  spec: IntegratedRunRecord["spec"];
  owner_provenance: IntegratedRunRecord["ownerProvenance"];
  reviewer_provenance: IntegratedRunRecord["reviewerProvenance"];
  report: IntegratedRunRecord["report"];
  terminal_reason: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: RunRow): IntegratedRunRecord {
  return {
    id: row.id,
    status: row.status,
    spec: row.spec,
    ownerProvenance: row.owner_provenance ?? null,
    reviewerProvenance: row.reviewer_provenance ?? null,
    report: row.report ?? null,
    terminalReason: row.terminal_reason ?? null,
    createdAt: iso(row.created_at) ?? "",
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at)
  };
}

export class PgIntegratedRunStore implements IntegratedRunStore {
  constructor(private readonly pool: Pool) {}

  async create(record: IntegratedRunRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO integrated_runs
         (id, status, spec, owner_provenance, reviewer_provenance, report, terminal_reason, created_at, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        record.id,
        record.status,
        JSON.stringify(record.spec),
        record.ownerProvenance ? JSON.stringify(record.ownerProvenance) : null,
        record.reviewerProvenance ? JSON.stringify(record.reviewerProvenance) : null,
        record.report ? JSON.stringify(record.report) : null,
        record.terminalReason,
        record.createdAt,
        record.startedAt,
        record.completedAt
      ]
    );
  }

  async get(id: string): Promise<IntegratedRunRecord | null> {
    const res = await this.pool.query<RunRow>(`SELECT * FROM integrated_runs WHERE id = $1`, [id]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async patch(id: string, patch: IntegratedRunPatch): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const add = (col: string, value: unknown) => {
      sets.push(`${col} = $${i++}`);
      values.push(value);
    };
    if (patch.status !== undefined) add("status", patch.status);
    if (patch.ownerProvenance !== undefined) add("owner_provenance", patch.ownerProvenance ? JSON.stringify(patch.ownerProvenance) : null);
    if (patch.reviewerProvenance !== undefined) add("reviewer_provenance", patch.reviewerProvenance ? JSON.stringify(patch.reviewerProvenance) : null);
    if (patch.report !== undefined) add("report", patch.report ? JSON.stringify(patch.report) : null);
    if (patch.terminalReason !== undefined) add("terminal_reason", patch.terminalReason);
    if (patch.startedAt !== undefined) add("started_at", patch.startedAt);
    if (patch.completedAt !== undefined) add("completed_at", patch.completedAt);
    if (sets.length === 0) return;
    values.push(id);
    await this.pool.query(`UPDATE integrated_runs SET ${sets.join(", ")} WHERE id = $${i}`, values);
  }

  async appendEvent(runId: string, event: IntegratedRunEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO integrated_run_events (run_id, sequence_number, type, provider, provider_version, payload, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, event.sequenceNumber, event.type, event.provider, event.providerVersion, JSON.stringify(event.payload), event.at]
    );
  }

  async listEvents(runId: string): Promise<IntegratedRunEvent[]> {
    const res = await this.pool.query(
      `SELECT sequence_number, type, provider, provider_version, payload, at
         FROM integrated_run_events WHERE run_id = $1 ORDER BY sequence_number ASC`,
      [runId]
    );
    return res.rows.map((r) => ({
      sequenceNumber: Number(r.sequence_number),
      type: r.type as string,
      provider: (r.provider ?? null) as IntegratedRunEvent["provider"],
      providerVersion: (r.provider_version ?? null) as string | null,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      at: iso(r.at) ?? ""
    }));
  }

  async maxSequence(runId: string): Promise<number> {
    const res = await this.pool.query<{ max: number | null }>(
      `SELECT COALESCE(MAX(sequence_number), 0) AS max FROM integrated_run_events WHERE run_id = $1`,
      [runId]
    );
    return Number(res.rows[0]?.max ?? 0);
  }
}
