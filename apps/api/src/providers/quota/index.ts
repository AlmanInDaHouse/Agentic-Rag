/**
 * Quota manager (A2.3) — public surface.
 *
 * A pure, deterministic, in-memory manager for heterogeneous per-provider
 * subscription budgets: reservations checked before each capacity-consuming step,
 * commit/release accounting, warnings, hard stops on exhaustion, rate-limit and
 * unknown states (never fabricated), turn/loop/wall-time limits on an injectable
 * clock, manual resume, provider-unavailable handling, a degraded-routing signal,
 * and NO paid/usage-credit fallback (spending credits is a typed error). Every
 * transition is recorded on an append-only, queryable ledger.
 *
 * See docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md §11,
 * docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md + docs/adr/0027,
 * docs/instrucciones.md §11 / §A2.3.
 *
 * Pure domain component — NOT wired into the runtime by A2.3.
 */

export {
  QuotaManager,
  type ReservationPurpose,
  type ReservationStatus,
  type ReservationView,
  type ProviderBudgetReserves,
  type ProviderBudgetLimits,
  type ProviderBudgetConfig,
  type BudgetStatus,
  type HardStopCause,
  type LedgerEntryKind,
  type LedgerEntry,
  type QuotaSnapshot,
  type CommitOutcome,
  type ProceedOptions,
  type ResumeOptions
} from "./quotaManager.js";
export {
  QuotaErrorCode,
  ok,
  err,
  isOk,
  isErr,
  type QuotaError,
  type QuotaResult
} from "./errors.js";
