/**
 * Quota-gated provider step (A4) — the orchestration primitive every mode uses.
 *
 * A single collaboration step (plan / execute / review / critique) runs a provider
 * adapter through the quota manager with the mandated lifecycle:
 *
 *   reserve  →  run the adapter's event stream to its terminal  →  commit | release
 *
 * Gating order (mandate §11): `assertCanProceed` first (auth, availability, hard
 * stop, rate limit, wall-time, turns, repair loops AND the reserve check), then a
 * real `reserve`. If the gate or the reserve fails, the step is BLOCKED — the
 * adapter is NEVER executed, so a hard stop / reserve violation halts the mode
 * WITHOUT any execution (and, since A4 is read-only, without any real write).
 *
 * While the stream runs, observed `quota.updated` / `usage.updated` events are fed
 * back into the quota manager, so a mid-stream `exhausted` / `rate_limited` surfaces
 * as a hard stop and degraded-routing suggestion that blocks the NEXT step.
 *
 * The request is built + validated BEFORE the reserve, and the stream consumption is
 * wrapped in try/finally: if the adapter throws mid-stream (or anything after `reserve`
 * throws), the uncommitted reservation is RELEASED so the held capacity never leaks.
 *
 * The execution request is ALWAYS `readOnly: true`: A4 simulates "implementation"
 * by consuming the mock adapter's event stream, never by mutating anything.
 *
 * Pure orchestration: no clock, no randomness, no I/O of its own — all time comes
 * from the injected clocks inside the quota manager and the adapters.
 */

import {
  AgentExecutionRequestSchema,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderId,
  type ProviderQuota,
  type ProviderResult,
  type ProviderUsage
} from "@triforge/shared";
import { deriveProviderResult } from "../providers/mock/index.js";
import {
  isErr,
  isOk,
  type QuotaErrorCode,
  type QuotaManager,
  type QuotaSnapshot,
  type ReservationPurpose
} from "../providers/quota/index.js";

/** The collaboration phase a step belongs to (drives the reservation purpose). */
export type CollaborationPhase = "plan" | "execute" | "review" | "critique";

/** A compact, serializable record of a typed quota error attached to a step. */
export interface StepQuotaError {
  code: QuotaErrorCode;
  message: string;
}

export interface ProviderStepInput {
  adapter: ProviderAdapter;
  quota: QuotaManager;
  provider: ProviderId;
  purpose: ReservationPurpose;
  /** Capacity units this step consumes from the provider budget. */
  amount: number;
  phase: CollaborationPhase;
  objective: string;
  executionId: string;
  /** Per-execution timeout for the adapter request (deterministic; not wall time). */
  timeoutMs?: number;
}

export interface ProviderStepRecord {
  phase: CollaborationPhase;
  provider: ProviderId;
  purpose: ReservationPurpose;
  amount: number;
  executionId: string;
  /** True when the quota gate or reserve refused the step (adapter NOT run). */
  blocked: boolean;
  /** The typed quota error when blocked, else null. */
  quotaError: StepQuotaError | null;
  /** The normalized terminal result, or null (blocked, or no terminal emitted). */
  result: ProviderResult | null;
  /** The raw event stream consumed (empty when blocked). */
  events: ProviderEvent[];
  /** Budget snapshot after the step. */
  snapshot: QuotaSnapshot | null;
  /** Whether routing should consider degrading away from this provider afterwards. */
  degradedRoutingSuggested: boolean;
  /** Units actually committed (set on a completed run), else null. */
  committedAmount: number | null;
}

/** True when the step ran the adapter to a clean `run.completed` terminal. */
export function stepSucceeded(record: ProviderStepRecord): boolean {
  return !record.blocked && record.result !== null && record.result.status === "completed";
}

const DEFAULT_TIMEOUT_MS = 3_600_000;

/**
 * Execute one quota-gated provider step. Returns a record describing the outcome;
 * never throws on a quota condition (those are returned as a typed `quotaError`).
 */
export async function runProviderStep(input: ProviderStepInput): Promise<ProviderStepRecord> {
  const { adapter, quota, provider, purpose, amount, phase, executionId } = input;

  const base = {
    phase,
    provider,
    purpose,
    amount,
    executionId
  } as const;

  // 1. Full gate (includes the reserve admissibility check). Non-mutating.
  const gate = quota.assertCanProceed(provider, { requireUnits: amount, purpose });
  if (isErr(gate)) {
    return blocked(base, gate.error.code, gate.error.message, quota.getSnapshot(provider) ?? null);
  }

  // 2. Build + validate the request BEFORE reserving, so a malformed request can never
  //    leak a reservation. ALWAYS read-only: A4 never writes.
  const request = AgentExecutionRequestSchema.parse({
    executionId,
    provider,
    objective: input.objective,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    readOnly: true
  });

  // 3. Reserve capacity BEFORE running the step.
  const reservation = quota.reserve(provider, amount, purpose);
  if (isErr(reservation)) {
    return blocked(
      base,
      reservation.error.code,
      reservation.error.message,
      quota.getSnapshot(provider) ?? null
    );
  }
  const reservationId = reservation.value.id;

  // 4. Run the adapter stream to its terminal, then commit/release. Wrapped in
  //    try/finally so an uncommitted reservation is RELEASED if the adapter throws
  //    mid-stream (or anything after `reserve` throws) — the held capacity never leaks.
  const events: ProviderEvent[] = [];
  let committedAmount: number | null = null;
  let settled = false;
  try {
    for await (const event of adapter.execute(request)) {
      events.push(event);
      // Feed observed provider signals back so a mid-stream exhausted/rate-limited
      // surfaces as a hard stop / degraded routing that blocks the NEXT step.
      if (event.type === "quota.updated") {
        quota.recordObservedQuota((event.payload as { quota: ProviderQuota }).quota);
      } else if (event.type === "usage.updated") {
        quota.recordObservedUsage((event.payload as { usage: ProviderUsage }).usage);
      }
    }

    const result = deriveProviderResult(events, { provider, executionId });

    // Commit on a clean completion; release otherwise (the capacity was not used).
    if (result !== null && result.status === "completed") {
      const commit = quota.commit(reservationId, amount);
      if (isOk(commit)) {
        committedAmount = commit.value.committedAmount;
      } else {
        quota.release(reservationId);
      }
    } else {
      quota.release(reservationId);
    }
    settled = true;

    const snapshot = quota.getSnapshot(provider) ?? null;
    return {
      ...base,
      blocked: false,
      quotaError: null,
      result,
      events,
      snapshot,
      degradedRoutingSuggested: snapshot?.degradedRoutingSuggested ?? false,
      committedAmount
    };
  } finally {
    // If we threw before settling (commit/release), release the still-active
    // reservation so the held capacity is restored. The throw then propagates.
    if (!settled) {
      quota.release(reservationId);
    }
  }
}

function blocked(
  base: Pick<ProviderStepRecord, "phase" | "provider" | "purpose" | "amount" | "executionId">,
  code: QuotaErrorCode,
  message: string,
  snapshot: QuotaSnapshot | null
): ProviderStepRecord {
  return {
    ...base,
    blocked: true,
    quotaError: { code, message },
    result: null,
    events: [],
    snapshot,
    degradedRoutingSuggested: snapshot?.degradedRoutingSuggested ?? false,
    committedAmount: null
  };
}
