/**
 * Quota manager error taxonomy (A2.3).
 *
 * Every invalid quota operation returns a TYPED error (never a throw and never a
 * silent success), so the orchestration runtime can react to an exact, stable
 * code rather than parse a message. The codes are `UPPER_SNAKE_CASE`, in the same
 * family as the quota/budget condition codes from
 * QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md (ADR 0027) and the mandate §11
 * accounting invariants; several map 1:1 onto a spec condition code, the rest are
 * accounting-specific (double-commit, over-commit, reserve violation…).
 *
 * This vocabulary is part of the manager's public contract — A4/A5/A6 reference
 * these ids — so the values MUST stay stable across milestones (treat like an API).
 */

import type { ProviderId } from "@triforge/shared";

/** Stable error code vocabulary. Values are part of the public contract. */
export const QuotaErrorCode = {
  /** No budget is configured for the provider. */
  BUDGET_NOT_FOUND: "BUDGET_NOT_FOUND",
  /** A budget already exists for the provider (configure once). */
  BUDGET_ALREADY_EXISTS: "BUDGET_ALREADY_EXISTS",
  /** A non-finite or negative amount was supplied (consumption cannot go negative). */
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  /** The reservation id is unknown. */
  RESERVATION_NOT_FOUND: "RESERVATION_NOT_FOUND",
  /** The reservation was already committed (no double-commit/double-consume). */
  RESERVATION_ALREADY_COMMITTED: "RESERVATION_ALREADY_COMMITTED",
  /** The reservation was already released (a released reservation cannot be committed). */
  RESERVATION_ALREADY_RELEASED: "RESERVATION_ALREADY_RELEASED",
  /** Committing would consume more capacity than is available (beyond policy). */
  OVER_COMMIT: "OVER_COMMIT",
  /** Local run budget has no remaining capacity for the request. */
  RUN_BUDGET_EXHAUSTED: "RUN_BUDGET_EXHAUSTED",
  /** The request would consume capacity reserved for implementation/review/repair. */
  RUN_BUDGET_RESERVE_VIOLATION: "RUN_BUDGET_RESERVE_VIOLATION",
  /** Configured reserves sum to more than the known capacity (budget would be unusable). */
  RESERVES_EXCEED_CAPACITY: "RESERVES_EXCEED_CAPACITY",
  /** Blocked by an observed provider-quota exhaustion hard stop (manual resume only). */
  PROVIDER_QUOTA_EXHAUSTED: "PROVIDER_QUOTA_EXHAUSTED",
  /** Blocked by an explicit, manual hard stop (manual resume only). */
  BUDGET_HARD_STOPPED: "BUDGET_HARD_STOPPED",
  /** Provider is rate limited; the run does not silently wait. */
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  /** Provider is unavailable (reachability/installation), surfaced explicitly. */
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  /** Provider needs re-authentication; manual resume after re-auth. */
  PROVIDER_AUTHENTICATION_REQUIRED: "PROVIDER_AUTHENTICATION_REQUIRED",
  /** Spending usage credits is forbidden (no paid fallback) — not approvable. */
  PROVIDER_USAGE_CREDITS_REQUIRED: "PROVIDER_USAGE_CREDITS_REQUIRED",
  /** Spending purchased credits is forbidden (no paid fallback) — not approvable. */
  PROVIDER_PURCHASED_CREDITS_REQUIRED: "PROVIDER_PURCHASED_CREDITS_REQUIRED",
  /** The per-run max turns limit was reached. */
  MAX_TURNS_EXCEEDED: "MAX_TURNS_EXCEEDED",
  /** The per-run max repair loops limit was reached. */
  MAX_REPAIR_LOOPS_EXCEEDED: "MAX_REPAIR_LOOPS_EXCEEDED",
  /** The per-run max wall-time limit was exceeded (measured on the injected clock). */
  MAX_WALL_TIME_EXCEEDED: "MAX_WALL_TIME_EXCEEDED",
  /** resume() was called on a budget that is neither hard-stopped nor rate-limited. */
  NOTHING_TO_RESUME: "NOTHING_TO_RESUME"
} as const;

export type QuotaErrorCode = (typeof QuotaErrorCode)[keyof typeof QuotaErrorCode];

/** A typed, structured quota error (returned, never thrown). */
export interface QuotaError {
  code: QuotaErrorCode;
  message: string;
  /** The provider the operation targeted, or null when it could not be resolved. */
  provider: ProviderId | null;
  /** Optional, structured, secret-free context for audit/debug. */
  detail?: Record<string, unknown>;
}

/** Discriminated result of every fallible quota operation. */
export type QuotaResult<T> = { ok: true; value: T } | { ok: false; error: QuotaError };

/** Wrap a success value. */
export function ok<T>(value: T): QuotaResult<T> {
  return { ok: true, value };
}

/** Wrap a typed error. */
export function err<T = never>(
  code: QuotaErrorCode,
  message: string,
  provider: ProviderId | null,
  detail?: Record<string, unknown>
): QuotaResult<T> {
  return { ok: false, error: { code, message, provider, ...(detail ? { detail } : {}) } };
}

/** Type guard: the result is a success. */
export function isOk<T>(result: QuotaResult<T>): result is { ok: true; value: T } {
  return result.ok;
}

/** Type guard: the result is a typed error. */
export function isErr<T>(result: QuotaResult<T>): result is { ok: false; error: QuotaError } {
  return !result.ok;
}
