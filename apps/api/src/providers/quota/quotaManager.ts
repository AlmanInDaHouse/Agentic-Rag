/**
 * Quota manager (A2.3) — pure, deterministic, in-memory.
 *
 * Governs heterogeneous, per-provider subscription budgets (Codex vs Claude have
 * INDEPENDENT capacity in EXPLICIT, per-provider consumption units) so the
 * orchestration runtime can reserve capacity BEFORE each capacity-consuming step,
 * stop hard on exhaustion (preserving partials, never silently idle), surface an
 * unknown quota without fabricating a number, and NEVER fall back to paid/usage
 * credits or an API key. See:
 *   - docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md + docs/adr/0027
 *   - docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md §11 (the A2.3 contract)
 *   - docs/instrucciones.md §11 / §A2.3
 *
 * Design properties (mandate §11):
 *  - PURE & deterministic: no Date.now()/Math.random()/network/credentials/DB. All
 *    time comes from an INJECTABLE `Clock` (default `ManualClock`, a frozen epoch);
 *    the production path never reads wall time directly.
 *  - TYPED errors, never throws-or-silent-success: every fallible operation returns
 *    a `QuotaResult<T>` carrying a `QuotaError` from the taxonomy in `errors.ts`.
 *  - AUDITABLE: every state transition appends to a monotonic, append-only ledger
 *    stamped with the injected timestamp; queryable via `ledger()` / `ledgerFor()`.
 *  - NO paid fallback: spending usage/purchased credits is a typed error, NOT an
 *    approvable gate (`allowUsageCredits`/`allowPurchasedCredits` are effectively
 *    false and not configurable to true).
 *
 * This is a pure domain component. It is NOT wired into the runtime by A2.3; the
 * runtime will consume it in a later milestone.
 */

import type {
  ProviderId,
  ProviderQuota,
  ProviderUsage,
  QuotaExhaustionFlavor,
  QuotaStatus,
  QuotaWindow,
  UsageSource
} from "@triforge/shared";
// The deterministic clock primitive is shared with the mock framework (A2.1); it
// is a generic injectable clock that lives in the mock leaf module. Reusing it
// (rather than redefining a second, incompatible `Clock`) keeps determinism
// consistent across the provider boundary; this is NOT a dependency on mock logic.
import { ManualClock, type Clock } from "../mock/clock.js";
import { QuotaErrorCode, err, ok, type QuotaError, type QuotaResult } from "./errors.js";

/** Why a step needs capacity. Implementation/review/repair have protected reserves. */
export type ReservationPurpose = "planning" | "implementation" | "review" | "repair" | "other";

/** Lifecycle of a single reservation. */
export type ReservationStatus = "active" | "committed" | "released";

/** Read-only view of a reservation (returned to callers; internal state is private). */
export interface ReservationView {
  id: string;
  provider: ProviderId;
  amount: number;
  purpose: ReservationPurpose;
  status: ReservationStatus;
  /** Units actually committed (set on commit; may differ from `amount`). */
  committedAmount: number | null;
  /** Ledger id of the `reserve` entry that created it. */
  createdLedgerId: number;
}

/** Capacity protected for later, more-critical phases (checked before earlier ones spend). */
export interface ProviderBudgetReserves {
  implementation?: number;
  review?: number;
  repair?: number;
}

/** Orchestration limits tracked alongside capacity. */
export interface ProviderBudgetLimits {
  maxTurns?: number | null;
  maxRepairLoops?: number | null;
  /** Wall-time ceiling, measured against the injected clock (never Date.now()). */
  maxWallTimeMs?: number | null;
}

/**
 * Per-provider budget configuration. Budgets are INDEPENDENT and use EXPLICIT,
 * provider-specific units (no symmetric-unit assumption across providers).
 */
export interface ProviderBudgetConfig {
  provider: ProviderId;
  /**
   * Local governance ceiling in this provider's own unit, OR `"unknown"` when the
   * provider exposes no reliable structured quota and we refuse to invent one. An
   * unknown-capacity budget reports `remaining: null` / `status: "unknown"` and is
   * never given a fabricated numeric balance.
   */
  capacity: number | "unknown";
  /** Explicit consumption-unit label, e.g. "codex_invocations", "claude_invocations". */
  unit: string;
  /** Utilization (0..1) at which the budget enters the `warning` status. Default 0.8. */
  warningThreshold?: number;
  /** Hard-stop when the warning threshold is crossed (claude stopOnQuotaWarning / codex stopWhenWindowLow). */
  stopOnWarning?: boolean;
  reserves?: ProviderBudgetReserves;
  limits?: ProviderBudgetLimits;
}

/** Combined governance status surfaced in a snapshot. */
export type BudgetStatus =
  | "ok"
  | "warning"
  | "exhausted"
  | "rate_limited"
  | "unknown"
  | "hard_stopped";

/** Why a budget is hard-stopped (selects which error a blocked op returns). */
export type HardStopCause = "manual" | "quota_exhausted" | "budget_exhausted" | "quota_warning";

/** Append-only ledger entry kinds (one per auditable transition). */
export type LedgerEntryKind =
  | "configure"
  | "reserve"
  | "commit"
  | "release"
  | "warn"
  | "hardstop"
  | "resume"
  | "observe_usage"
  | "observe_quota"
  | "rate_limited"
  | "unavailable"
  | "available"
  | "auth_required"
  | "authenticated"
  | "turn"
  | "repair_loop"
  | "credit_denied";

/** A single, immutable ledger entry with a monotonic id and the injected timestamp. */
export interface LedgerEntry {
  id: number;
  /** ISO-8601 timestamp from the injected clock. */
  at: string;
  /** Epoch milliseconds from the injected clock. */
  atMs: number;
  provider: ProviderId;
  kind: LedgerEntryKind;
  detail: Record<string, unknown>;
}

/** A point-in-time, fully-derived view of a provider budget. */
export interface QuotaSnapshot {
  provider: ProviderId;
  unit: string;
  status: BudgetStatus;
  capacityKnown: boolean;
  /** Local capacity ceiling, or null when capacity is unknown. */
  capacity: number | null;
  committed: number;
  reserved: number;
  /** Remaining reservable capacity, or null when capacity is unknown (NEVER fabricated). */
  remaining: number | null;
  remainingKnown: boolean;
  /** Local utilization (committed+reserved)/capacity in 0..1, or null when unknown. */
  utilization: number | null;
  warningThreshold: number;
  /** Configured protected reserves (governance policy). */
  reserves: { implementation: number; review: number; repair: number };
  turnsUsed: number;
  maxTurns: number | null;
  repairLoopsUsed: number;
  maxRepairLoops: number | null;
  /** Wall time elapsed since configuration, on the injected clock. */
  wallTimeUsedMs: number;
  maxWallTimeMs: number | null;
  hardStopped: boolean;
  hardStopCause: HardStopCause | null;
  hardStopReason: string | null;
  rateLimited: boolean;
  providerUnavailable: boolean;
  authenticationRequired: boolean;
  /** Last observed provider-quota status (from events), or null if never observed. */
  observedQuotaStatus: QuotaStatus | null;
  observedQuotaWindow: QuotaWindow | null;
  /** Provider-reported utilization, only when the provider exposed it (else null — never fabricated). */
  observedUtilization: number | null;
  observedExhaustionFlavor: QuotaExhaustionFlavor | null;
  /**
   * Routing should CONSIDER degradation away from this provider (exhausted /
   * hard-stopped / rate-limited / unavailable). The manager NEVER auto-switches.
   */
  degradedRoutingSuggested: boolean;
  /** Last observed estimated cost (client-side estimate), or null. */
  estimatedCostUsd: number | null;
  costSource: UsageSource | null;
  /** Cost views are ALWAYS client-side estimates, never authoritative billing. */
  isBillingAuthoritative: false;
}

/** Result of a successful commit. */
export interface CommitOutcome {
  reservationId: string;
  committedAmount: number;
  snapshot: QuotaSnapshot;
}

/** Options for `assertCanProceed`. */
export interface ProceedOptions {
  /** If set, also verify this many units could be reserved for `purpose`. */
  requireUnits?: number;
  purpose?: ReservationPurpose;
}

/** Options for `resume`. */
export interface ResumeOptions {
  /**
   * Model a provider quota-window reset: clear active reservations and committed
   * consumption, reset turn/loop counters and restart the wall-time clock.
   */
  reset?: boolean;
}

const DEFAULT_WARNING_THRESHOLD = 0.8;
const CRITICAL_PURPOSES: ReservationPurpose[] = ["implementation", "review", "repair"];

interface Reservation {
  id: string;
  provider: ProviderId;
  amount: number;
  purpose: ReservationPurpose;
  status: ReservationStatus;
  committedAmount: number | null;
  createdLedgerId: number;
}

interface BudgetState {
  provider: ProviderId;
  unit: string;
  capacityKnown: boolean;
  capacity: number;
  warningThreshold: number;
  stopOnWarning: boolean;
  reserveImpl: number;
  reserveReview: number;
  reserveRepair: number;
  maxTurns: number | null;
  maxRepairLoops: number | null;
  maxWallTimeMs: number | null;
  committed: number;
  turnsUsed: number;
  repairLoopsUsed: number;
  startedAtMs: number;
  hardStopped: boolean;
  hardStopCause: HardStopCause | null;
  hardStopReason: string | null;
  rateLimited: boolean;
  warned: boolean;
  providerUnavailable: boolean;
  authenticationRequired: boolean;
  observedQuotaStatus: QuotaStatus | null;
  observedQuotaWindow: QuotaWindow | null;
  observedUtilization: number | null;
  observedExhaustionFlavor: QuotaExhaustionFlavor | null;
  lastUsageCostUsd: number | null;
  lastUsageSource: UsageSource | null;
}

/**
 * The pure, in-memory quota manager. Construct one per run (or per orchestration
 * context); configure a budget per provider, then reserve/commit/release around
 * each capacity-consuming step.
 */
export class QuotaManager {
  private readonly clock: Clock;
  private readonly budgets = new Map<ProviderId, BudgetState>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly entries: LedgerEntry[] = [];
  private nextLedgerId = 1;
  private nextReservationSeq = 0;

  constructor(opts: { clock?: Clock } = {}) {
    // Default to a deterministic ManualClock (frozen epoch). A real runtime injects
    // its own monotonic clock; the manager itself never reads wall time directly.
    this.clock = opts.clock ?? new ManualClock();
  }

  // --- configuration -----------------------------------------------------

  /** Create the per-provider budget. One budget per provider (configure once). */
  configureBudget(config: ProviderBudgetConfig): QuotaResult<QuotaSnapshot> {
    if (this.budgets.has(config.provider)) {
      return err(
        QuotaErrorCode.BUDGET_ALREADY_EXISTS,
        `a budget is already configured for provider "${config.provider}"`,
        config.provider
      );
    }
    const capacityKnown = config.capacity !== "unknown";
    if (capacityKnown) {
      const capacity = config.capacity as number;
      if (!Number.isFinite(capacity) || capacity < 0) {
        return err(
          QuotaErrorCode.NEGATIVE_AMOUNT,
          `capacity must be a finite, non-negative number or "unknown" (got ${String(config.capacity)})`,
          config.provider
        );
      }
    }
    const threshold = config.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      return err(
        QuotaErrorCode.NEGATIVE_AMOUNT,
        `warningThreshold must be in [0,1] (got ${String(config.warningThreshold)})`,
        config.provider
      );
    }
    const reserves = config.reserves ?? {};
    const limits = config.limits ?? {};
    const reserveImpl = Math.max(0, reserves.implementation ?? 0);
    const reserveReview = Math.max(0, reserves.review ?? 0);
    const reserveRepair = Math.max(0, reserves.repair ?? 0);
    if (capacityKnown) {
      // Reserves that sum beyond capacity would make the budget unusable (every
      // reservation would trip RUN_BUDGET_RESERVE_VIOLATION). Reject at config time
      // with a precise code rather than silently producing a dead budget. Sum ==
      // capacity is allowed (all capacity is protected; 0 spendable for non-critical
      // phases), only sum > capacity is invalid.
      const reservesSum = reserveImpl + reserveReview + reserveRepair;
      if (reservesSum > (config.capacity as number)) {
        return err(
          QuotaErrorCode.RESERVES_EXCEED_CAPACITY,
          `configured reserves (implementation ${reserveImpl} + review ${reserveReview} + ` +
            `repair ${reserveRepair} = ${reservesSum}) exceed capacity ${config.capacity as number}`,
          config.provider,
          { reservesSum, capacity: config.capacity as number }
        );
      }
    }
    const budget: BudgetState = {
      provider: config.provider,
      unit: config.unit,
      capacityKnown,
      capacity: capacityKnown ? (config.capacity as number) : 0,
      warningThreshold: threshold,
      stopOnWarning: config.stopOnWarning ?? false,
      reserveImpl,
      reserveReview,
      reserveRepair,
      maxTurns: limits.maxTurns ?? null,
      maxRepairLoops: limits.maxRepairLoops ?? null,
      maxWallTimeMs: limits.maxWallTimeMs ?? null,
      committed: 0,
      turnsUsed: 0,
      repairLoopsUsed: 0,
      startedAtMs: this.clock.now(),
      hardStopped: false,
      hardStopCause: null,
      hardStopReason: null,
      rateLimited: false,
      warned: false,
      providerUnavailable: false,
      authenticationRequired: false,
      observedQuotaStatus: null,
      observedQuotaWindow: null,
      observedUtilization: null,
      observedExhaustionFlavor: null,
      lastUsageCostUsd: null,
      lastUsageSource: null
    };
    this.budgets.set(config.provider, budget);
    this.append(config.provider, "configure", {
      unit: config.unit,
      capacity: capacityKnown ? budget.capacity : "unknown",
      warningThreshold: threshold,
      reserves: {
        implementation: budget.reserveImpl,
        review: budget.reserveReview,
        repair: budget.reserveRepair
      },
      limits: {
        maxTurns: budget.maxTurns,
        maxRepairLoops: budget.maxRepairLoops,
        maxWallTimeMs: budget.maxWallTimeMs
      }
    });
    return ok(this.buildSnapshot(budget));
  }

  /** Whether a budget exists for the provider. */
  hasBudget(provider: ProviderId): boolean {
    return this.budgets.has(provider);
  }

  // --- reservations ------------------------------------------------------

  /**
   * Reserve `amount` units for a later step. Checked BEFORE the step runs so an
   * earlier phase cannot starve implementation/review/repair reserves. Returns a
   * typed error on a hard stop, an exceeded capacity, a reserve violation or a
   * non-positive amount.
   */
  reserve(
    provider: ProviderId,
    amount: number,
    purpose: ReservationPurpose = "other"
  ): QuotaResult<ReservationView> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    const violation = this.evaluateReserve(budget, amount, purpose);
    if (violation) {
      return { ok: false, error: violation };
    }
    const id = `res-${provider}-${this.nextReservationSeq}`;
    this.nextReservationSeq += 1;
    const createdLedgerId = this.append(provider, "reserve", { reservationId: id, amount, purpose });
    const reservation: Reservation = {
      id,
      provider,
      amount,
      purpose,
      status: "active",
      committedAmount: null,
      createdLedgerId
    };
    this.reservations.set(id, reservation);
    this.recomputeWarning(budget);
    return ok(this.viewOf(reservation));
  }

  /** Non-mutating check: would `reserve(provider, amount, purpose)` succeed right now? */
  canReserve(
    provider: ProviderId,
    amount: number,
    purpose: ReservationPurpose = "other"
  ): boolean {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return false;
    }
    return this.evaluateReserve(budget, amount, purpose) === null;
  }

  /**
   * Commit (consume) a reservation, optionally for a different amount. Committing
   * for LESS frees the difference; committing for MORE is allowed only within the
   * remaining capacity, otherwise `OVER_COMMIT`. A reservation cannot be committed
   * twice or after release (typed errors).
   *
   * Reserve protection on commit-for-MORE: only the EXCESS (`actual - amount`) is
   * new, previously-unreserved consumption, so it must also respect the headroom
   * protected for OTHER critical phases (implementation/review/repair) — otherwise
   * a "planning"/"other" step could commit past its reservation into capacity set
   * aside for later phases. The excess is rejected with `RUN_BUDGET_RESERVE_VIOLATION`
   * when it would breach that headroom (the commit has not happened yet, so refusing
   * is safe — there is nothing to un-spend). Commit-for-LESS and commit-equal free
   * or keep capacity and can never breach a reserve, so they skip this check.
   */
  commit(reservationId: string, actualAmount?: number): QuotaResult<CommitOutcome> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      return err(
        QuotaErrorCode.RESERVATION_NOT_FOUND,
        `unknown reservation "${reservationId}"`,
        null
      );
    }
    if (reservation.status === "committed") {
      return err(
        QuotaErrorCode.RESERVATION_ALREADY_COMMITTED,
        `reservation "${reservationId}" was already committed`,
        reservation.provider
      );
    }
    if (reservation.status === "released") {
      return err(
        QuotaErrorCode.RESERVATION_ALREADY_RELEASED,
        `reservation "${reservationId}" was released and cannot be committed`,
        reservation.provider
      );
    }
    const budget = this.budgets.get(reservation.provider);
    if (!budget) {
      // Unreachable in practice (a reservation cannot outlive its budget), but
      // typed rather than thrown for safety.
      return err(
        QuotaErrorCode.BUDGET_NOT_FOUND,
        `no budget for provider "${reservation.provider}"`,
        reservation.provider
      );
    }
    const actual = actualAmount ?? reservation.amount;
    if (!Number.isFinite(actual) || actual < 0) {
      return err(
        QuotaErrorCode.NEGATIVE_AMOUNT,
        `commit amount must be finite and non-negative (got ${String(actualAmount)})`,
        reservation.provider
      );
    }
    if (budget.capacityKnown) {
      // Other still-active reservations remain claimed; this one converts to committed.
      const otherActiveReserved = this.reservedUnits(budget.provider) - reservation.amount;
      if (budget.committed + actual + otherActiveReserved > budget.capacity) {
        return err(
          QuotaErrorCode.OVER_COMMIT,
          `committing ${actual} would exceed capacity ${budget.capacity} ` +
            `(committed ${budget.committed}, other reserved ${otherActiveReserved})`,
          reservation.provider,
          { reserved: reservation.amount, requested: actual }
        );
      }
      // Commit-for-more: the excess beyond the reservation is fresh consumption and
      // must not eat into capacity protected for OTHER critical phases. protectedHeadroom
      // excludes this reservation's own purpose, so its already-counted amount is not
      // double-charged. Commit-for-less/equal frees capacity → never a violation.
      if (actual > reservation.amount) {
        const requiredHeadroom = this.protectedHeadroom(budget, reservation.purpose);
        const freeAfterCommit =
          budget.capacity - budget.committed - actual - otherActiveReserved;
        if (freeAfterCommit < requiredHeadroom) {
          return err(
            QuotaErrorCode.RUN_BUDGET_RESERVE_VIOLATION,
            `committing ${actual} for "${reservation.purpose}" (reserved ${reservation.amount}) ` +
              `would consume capacity protected for other phases ` +
              `(free after commit ${freeAfterCommit}, protected ${requiredHeadroom})`,
            reservation.provider,
            {
              reserved: reservation.amount,
              requested: actual,
              excess: actual - reservation.amount,
              free: freeAfterCommit,
              protected: requiredHeadroom
            }
          );
        }
      }
    }
    reservation.status = "committed";
    reservation.committedAmount = actual;
    budget.committed += actual;
    this.append(reservation.provider, "commit", {
      reservationId,
      reservedAmount: reservation.amount,
      committedAmount: actual,
      delta: actual - reservation.amount
    });
    this.recomputeWarning(budget);
    return ok({
      reservationId,
      committedAmount: actual,
      snapshot: this.buildSnapshot(budget)
    });
  }

  /** Release an unused (active) reservation, returning its capacity to the budget. */
  release(reservationId: string): QuotaResult<ReservationView> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      return err(
        QuotaErrorCode.RESERVATION_NOT_FOUND,
        `unknown reservation "${reservationId}"`,
        null
      );
    }
    if (reservation.status === "committed") {
      return err(
        QuotaErrorCode.RESERVATION_ALREADY_COMMITTED,
        `reservation "${reservationId}" was committed and cannot be released`,
        reservation.provider
      );
    }
    if (reservation.status === "released") {
      return err(
        QuotaErrorCode.RESERVATION_ALREADY_RELEASED,
        `reservation "${reservationId}" was already released`,
        reservation.provider
      );
    }
    reservation.status = "released";
    this.append(reservation.provider, "release", {
      reservationId,
      amount: reservation.amount,
      purpose: reservation.purpose
    });
    const budget = this.budgets.get(reservation.provider);
    if (budget) {
      this.recomputeWarning(budget);
    }
    return ok(this.viewOf(reservation));
  }

  // --- orchestration counters -------------------------------------------

  /** Record one turn against `maxTurns`. Rejects once the limit is reached. */
  recordTurn(provider: ProviderId, count = 1): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    if (!Number.isInteger(count) || count <= 0) {
      return err(
        QuotaErrorCode.NEGATIVE_AMOUNT,
        `turn count must be a positive integer (got ${String(count)})`,
        provider
      );
    }
    if (budget.maxTurns !== null && budget.turnsUsed + count > budget.maxTurns) {
      return err(
        QuotaErrorCode.MAX_TURNS_EXCEEDED,
        `recording ${count} turn(s) would exceed maxTurns ${budget.maxTurns} (used ${budget.turnsUsed})`,
        provider,
        { turnsUsed: budget.turnsUsed, maxTurns: budget.maxTurns }
      );
    }
    budget.turnsUsed += count;
    this.append(provider, "turn", { turnsUsed: budget.turnsUsed, count });
    return ok(this.buildSnapshot(budget));
  }

  /** Record one repair loop against `maxRepairLoops`. Rejects once the limit is reached. */
  recordRepairLoop(provider: ProviderId): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    if (budget.maxRepairLoops !== null && budget.repairLoopsUsed + 1 > budget.maxRepairLoops) {
      return err(
        QuotaErrorCode.MAX_REPAIR_LOOPS_EXCEEDED,
        `another repair loop would exceed maxRepairLoops ${budget.maxRepairLoops} ` +
          `(used ${budget.repairLoopsUsed})`,
        provider,
        { repairLoopsUsed: budget.repairLoopsUsed, maxRepairLoops: budget.maxRepairLoops }
      );
    }
    budget.repairLoopsUsed += 1;
    this.append(provider, "repair_loop", { repairLoopsUsed: budget.repairLoopsUsed });
    return ok(this.buildSnapshot(budget));
  }

  // --- observed provider signals (NOT trusted as billing) ----------------

  /**
   * Record an observed `ProviderUsage` estimate. Stored for governance/cost views
   * only; ALWAYS a client-side estimate (`isBillingAuthoritative` stays false),
   * never trusted as authoritative billing.
   */
  recordObservedUsage(usage: ProviderUsage): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(usage.provider);
    if (!budget) {
      return err(
        QuotaErrorCode.BUDGET_NOT_FOUND,
        `no budget for provider "${usage.provider}"`,
        usage.provider
      );
    }
    budget.lastUsageCostUsd = usage.estimatedCostUsd ?? null;
    budget.lastUsageSource = usage.source;
    this.append(usage.provider, "observe_usage", {
      estimatedCostUsd: usage.estimatedCostUsd ?? null,
      source: usage.source,
      turns: usage.turns ?? null,
      invocations: usage.invocations ?? null,
      // Mirror the contract invariant in the audit trail: never authoritative.
      isBillingAuthoritative: false
    });
    return ok(this.buildSnapshot(budget));
  }

  /**
   * Record an observed `ProviderQuota` signal. An observed `exhausted` triggers a
   * hard stop (manual resume only); `rate_limited` sets the transient rate-limit
   * state; `warning` raises the warning; `unknown` is recorded WITHOUT fabricating
   * a numeric balance; `available` clears transient flags but NEVER the hard stop.
   */
  recordObservedQuota(quota: ProviderQuota): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(quota.provider);
    if (!budget) {
      return err(
        QuotaErrorCode.BUDGET_NOT_FOUND,
        `no budget for provider "${quota.provider}"`,
        quota.provider
      );
    }
    budget.observedQuotaStatus = quota.status;
    budget.observedQuotaWindow = quota.window;
    // Never fabricate a utilization: absent stays absent (null).
    budget.observedUtilization = quota.utilization ?? null;
    budget.observedExhaustionFlavor = quota.exhaustionFlavor ?? null;
    this.append(quota.provider, "observe_quota", {
      status: quota.status,
      window: quota.window,
      utilization: quota.utilization ?? null,
      exhaustionFlavor: quota.exhaustionFlavor ?? null,
      source: quota.source
    });
    switch (quota.status) {
      case "exhausted":
        this.setHardStop(
          budget,
          "quota_exhausted",
          `observed provider quota exhausted (${quota.exhaustionFlavor ?? "unknown"})`
        );
        break;
      case "rate_limited":
        if (!budget.rateLimited) {
          budget.rateLimited = true;
          this.append(quota.provider, "rate_limited", { window: quota.window });
        }
        break;
      case "warning":
        if (!budget.warned) {
          budget.warned = true;
          this.append(quota.provider, "warn", { source: "observed", window: quota.window });
        }
        if (budget.stopOnWarning) {
          this.setHardStop(budget, "quota_warning", "observed quota warning with stopOnWarning");
        }
        break;
      case "available":
        // Clears the transient rate-limit, but a hard stop is cleared only by an
        // explicit manual resume (mandate §11: manual resume after reset).
        budget.rateLimited = false;
        break;
      case "unknown":
        // Recorded only; never coerced into "available" and never given a number.
        break;
    }
    return ok(this.buildSnapshot(budget));
  }

  /** Mark the provider unavailable (reachability/installation). Surfaced explicitly. */
  recordProviderUnavailable(provider: ProviderId, detail?: string): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    budget.providerUnavailable = true;
    this.append(provider, "unavailable", { detail: detail ?? null });
    return ok(this.buildSnapshot(budget));
  }

  /** Mark the provider available again. */
  recordProviderAvailable(provider: ProviderId): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    budget.providerUnavailable = false;
    this.append(provider, "available", {});
    return ok(this.buildSnapshot(budget));
  }

  /** Mark the provider as needing re-authentication. */
  recordAuthenticationRequired(provider: ProviderId, detail?: string): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    budget.authenticationRequired = true;
    this.append(provider, "auth_required", { detail: detail ?? null });
    return ok(this.buildSnapshot(budget));
  }

  /** Mark the provider re-authenticated. */
  recordAuthenticated(provider: ProviderId): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    budget.authenticationRequired = false;
    this.append(provider, "authenticated", {});
    return ok(this.buildSnapshot(budget));
  }

  // --- credits: forbidden, not approvable --------------------------------

  /** Attempt to spend usage credits — ALWAYS a typed error (no paid fallback). */
  requestUsageCreditSpend(provider: ProviderId): QuotaResult<never> {
    if (this.budgets.has(provider)) {
      this.append(provider, "credit_denied", { kind: "usage" });
    }
    return err(
      QuotaErrorCode.PROVIDER_USAGE_CREDITS_REQUIRED,
      "spending usage credits is forbidden (allowUsageCredits=false); not approvable",
      this.budgets.has(provider) ? provider : null
    );
  }

  /** Attempt to spend purchased credits — ALWAYS a typed error (no paid fallback). */
  requestPurchasedCreditSpend(provider: ProviderId): QuotaResult<never> {
    if (this.budgets.has(provider)) {
      this.append(provider, "credit_denied", { kind: "purchased" });
    }
    return err(
      QuotaErrorCode.PROVIDER_PURCHASED_CREDITS_REQUIRED,
      "spending purchased credits is forbidden (allowPurchasedCredits=false); not approvable",
      this.budgets.has(provider) ? provider : null
    );
  }

  // --- hard stop / resume ------------------------------------------------

  /** Explicitly hard-stop a budget; new reservations are refused until resume. */
  hardStop(provider: ProviderId, reason: string): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    this.setHardStop(budget, "manual", reason);
    return ok(this.buildSnapshot(budget));
  }

  /**
   * Manually resume a hard-stopped or rate-limited budget (the ONLY way out of a
   * hard stop — mandate §11). With `reset: true` it also models a quota-window
   * reset (clears active reservations, committed consumption, counters and
   * restarts the wall-time clock).
   */
  resume(provider: ProviderId, opts: ResumeOptions = {}): QuotaResult<QuotaSnapshot> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    if (!budget.hardStopped && !budget.rateLimited) {
      return err(
        QuotaErrorCode.NOTHING_TO_RESUME,
        `budget for "${provider}" is neither hard-stopped nor rate-limited`,
        provider
      );
    }
    budget.hardStopped = false;
    budget.hardStopCause = null;
    budget.hardStopReason = null;
    budget.rateLimited = false;
    budget.warned = false;
    if (opts.reset) {
      // A window reset wipes ALL prior consumption for this provider. Neutralize
      // both ACTIVE and COMMITTED reservations (mark released, keep them queryable
      // for audit) so reservedUnits()/usedByPurpose() see nothing stale. Leaving
      // committed reservations behind would let protectedHeadroom() subtract their
      // pre-reset amounts and collapse reserve protection after the reset.
      for (const reservation of this.reservations.values()) {
        if (
          reservation.provider === provider &&
          (reservation.status === "active" || reservation.status === "committed")
        ) {
          reservation.status = "released";
        }
      }
      budget.committed = 0;
      budget.turnsUsed = 0;
      budget.repairLoopsUsed = 0;
      budget.startedAtMs = this.clock.now();
      budget.observedQuotaStatus = "available";
      budget.observedUtilization = null;
      budget.observedExhaustionFlavor = null;
    }
    this.append(provider, "resume", { reset: opts.reset === true });
    return ok(this.buildSnapshot(budget));
  }

  // --- gating before a capacity-consuming step ---------------------------

  /**
   * Verify a budget may proceed with a capacity-consuming step. Returns the first
   * blocking condition as a typed error (auth, unavailable, hard stop, rate limit,
   * wall-time, turns, repair loops, and — when `requireUnits` is given — capacity /
   * reserve checks).
   */
  assertCanProceed(provider: ProviderId, opts: ProceedOptions = {}): QuotaResult<void> {
    const budget = this.budgets.get(provider);
    if (!budget) {
      return err(QuotaErrorCode.BUDGET_NOT_FOUND, `no budget for provider "${provider}"`, provider);
    }
    if (budget.authenticationRequired) {
      return err(
        QuotaErrorCode.PROVIDER_AUTHENTICATION_REQUIRED,
        `provider "${provider}" requires re-authentication`,
        provider
      );
    }
    if (budget.providerUnavailable) {
      return err(
        QuotaErrorCode.PROVIDER_UNAVAILABLE,
        `provider "${provider}" is unavailable`,
        provider
      );
    }
    if (budget.hardStopped) {
      return { ok: false, error: this.hardStopError(budget) };
    }
    if (budget.rateLimited) {
      return err(
        QuotaErrorCode.PROVIDER_RATE_LIMITED,
        `provider "${provider}" is rate limited`,
        provider
      );
    }
    if (budget.maxWallTimeMs !== null) {
      const elapsed = this.clock.now() - budget.startedAtMs;
      if (elapsed > budget.maxWallTimeMs) {
        return err(
          QuotaErrorCode.MAX_WALL_TIME_EXCEEDED,
          `wall time ${elapsed}ms exceeded maxWallTimeMs ${budget.maxWallTimeMs}`,
          provider,
          { elapsedMs: elapsed, maxWallTimeMs: budget.maxWallTimeMs }
        );
      }
    }
    if (budget.maxTurns !== null && budget.turnsUsed >= budget.maxTurns) {
      return err(
        QuotaErrorCode.MAX_TURNS_EXCEEDED,
        `turns used ${budget.turnsUsed} reached maxTurns ${budget.maxTurns}`,
        provider
      );
    }
    if (budget.maxRepairLoops !== null && budget.repairLoopsUsed >= budget.maxRepairLoops) {
      return err(
        QuotaErrorCode.MAX_REPAIR_LOOPS_EXCEEDED,
        `repair loops used ${budget.repairLoopsUsed} reached maxRepairLoops ${budget.maxRepairLoops}`,
        provider
      );
    }
    if (opts.requireUnits !== undefined) {
      const violation = this.evaluateReserve(budget, opts.requireUnits, opts.purpose ?? "other");
      if (violation) {
        return { ok: false, error: violation };
      }
    }
    return ok(undefined);
  }

  // --- queries -----------------------------------------------------------

  /** Snapshot of one budget, or undefined if it is not configured. */
  getSnapshot(provider: ProviderId): QuotaSnapshot | undefined {
    const budget = this.budgets.get(provider);
    return budget ? this.buildSnapshot(budget) : undefined;
  }

  /** Snapshots of every configured budget, in configuration order. */
  listSnapshots(): QuotaSnapshot[] {
    return [...this.budgets.values()].map((budget) => this.buildSnapshot(budget));
  }

  /** A read-only view of one reservation, or undefined if unknown. */
  getReservation(reservationId: string): ReservationView | undefined {
    const reservation = this.reservations.get(reservationId);
    return reservation ? this.viewOf(reservation) : undefined;
  }

  /** The full append-only ledger (a deep copy), in monotonic id order. */
  ledger(): readonly LedgerEntry[] {
    // Deep-copy `detail` so callers cannot mutate nested objects (e.g. configure's
    // reserves/limits) and reach back into the internal, append-only ledger.
    return this.entries.map((entry) => ({ ...entry, detail: structuredClone(entry.detail) }));
  }

  /** Ledger entries for one provider (a deep copy), in monotonic id order. */
  ledgerFor(provider: ProviderId): LedgerEntry[] {
    return this.entries
      .filter((entry) => entry.provider === provider)
      .map((entry) => ({ ...entry, detail: structuredClone(entry.detail) }));
  }

  // --- internals ---------------------------------------------------------

  private append(
    provider: ProviderId,
    kind: LedgerEntryKind,
    detail: Record<string, unknown>
  ): number {
    const id = this.nextLedgerId;
    this.nextLedgerId += 1;
    this.entries.push({
      id,
      at: this.clock.iso(),
      atMs: this.clock.now(),
      provider,
      kind,
      detail
    });
    return id;
  }

  private setHardStop(budget: BudgetState, cause: HardStopCause, reason: string): void {
    if (budget.hardStopped) {
      return;
    }
    budget.hardStopped = true;
    budget.hardStopCause = cause;
    budget.hardStopReason = reason;
    this.append(budget.provider, "hardstop", { cause, reason });
  }

  private hardStopError(budget: BudgetState): QuotaError {
    if (budget.hardStopCause === "quota_exhausted") {
      return {
        code: QuotaErrorCode.PROVIDER_QUOTA_EXHAUSTED,
        message: `provider "${budget.provider}" quota is exhausted (manual resume after reset)`,
        provider: budget.provider,
        detail: { cause: budget.hardStopCause, reason: budget.hardStopReason }
      };
    }
    return {
      code: QuotaErrorCode.BUDGET_HARD_STOPPED,
      message: `budget for "${budget.provider}" is hard-stopped (manual resume only)`,
      provider: budget.provider,
      detail: { cause: budget.hardStopCause, reason: budget.hardStopReason }
    };
  }

  /** Returns a blocking error, or null when a reservation of `amount`/`purpose` is admissible. */
  private evaluateReserve(
    budget: BudgetState,
    amount: number,
    purpose: ReservationPurpose
  ): QuotaError | null {
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        code: QuotaErrorCode.NEGATIVE_AMOUNT,
        message: `reservation amount must be a finite positive number (got ${String(amount)})`,
        provider: budget.provider
      };
    }
    if (budget.hardStopped) {
      return this.hardStopError(budget);
    }
    if (!budget.capacityKnown) {
      // No ceiling to enforce against; an unknown-capacity budget tracks counts
      // only. Negative/hard-stop checks above still apply.
      return null;
    }
    const reserved = this.reservedUnits(budget.provider);
    const freeNow = budget.capacity - budget.committed - reserved;
    if (amount > freeNow) {
      return {
        code: QuotaErrorCode.RUN_BUDGET_EXHAUSTED,
        message:
          `reserving ${amount} exceeds remaining ${freeNow} ` +
          `(capacity ${budget.capacity}, committed ${budget.committed}, reserved ${reserved})`,
        provider: budget.provider,
        detail: { requested: amount, remaining: freeNow }
      };
    }
    const requiredHeadroom = this.protectedHeadroom(budget, purpose);
    if (amount > freeNow - requiredHeadroom) {
      return {
        code: QuotaErrorCode.RUN_BUDGET_RESERVE_VIOLATION,
        message:
          `reserving ${amount} for "${purpose}" would consume capacity reserved for other ` +
          `phases (free ${freeNow}, protected ${requiredHeadroom})`,
        provider: budget.provider,
        detail: { requested: amount, free: freeNow, protected: requiredHeadroom }
      };
    }
    return null;
  }

  /** Capacity that must stay protected for critical reserves OTHER than `purpose`. */
  private protectedHeadroom(budget: BudgetState, purpose: ReservationPurpose): number {
    const configured: Record<"implementation" | "review" | "repair", number> = {
      implementation: budget.reserveImpl,
      review: budget.reserveReview,
      repair: budget.reserveRepair
    };
    let headroom = 0;
    for (const critical of CRITICAL_PURPOSES) {
      if (critical === purpose) {
        continue;
      }
      const key = critical as "implementation" | "review" | "repair";
      const alreadySetAside = this.usedByPurpose(budget.provider, critical);
      headroom += Math.max(0, configured[key] - alreadySetAside);
    }
    return headroom;
  }

  private reservedUnits(provider: ProviderId): number {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.provider === provider && reservation.status === "active") {
        total += reservation.amount;
      }
    }
    return total;
  }

  /** Units already claimed (active reservation OR committed) toward a purpose. */
  private usedByPurpose(provider: ProviderId, purpose: ReservationPurpose): number {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.provider !== provider || reservation.purpose !== purpose) {
        continue;
      }
      if (reservation.status === "active") {
        total += reservation.amount;
      } else if (reservation.status === "committed") {
        total += reservation.committedAmount ?? 0;
      }
    }
    return total;
  }

  private recomputeWarning(budget: BudgetState): void {
    if (!budget.capacityKnown || budget.capacity <= 0 || budget.warned) {
      return;
    }
    const reserved = this.reservedUnits(budget.provider);
    const utilization = (budget.committed + reserved) / budget.capacity;
    if (utilization >= budget.warningThreshold) {
      budget.warned = true;
      this.append(budget.provider, "warn", {
        source: "local",
        utilization,
        threshold: budget.warningThreshold
      });
      if (budget.stopOnWarning) {
        this.setHardStop(budget, "quota_warning", "local utilization crossed warning threshold");
      }
    }
  }

  private deriveStatus(
    budget: BudgetState,
    remaining: number | null,
    utilization: number | null
  ): BudgetStatus {
    if (budget.hardStopped) {
      return budget.hardStopCause === "quota_exhausted" ? "exhausted" : "hard_stopped";
    }
    if (budget.rateLimited) {
      return "rate_limited";
    }
    if (!budget.capacityKnown) {
      return "unknown";
    }
    if (remaining !== null && remaining <= 0) {
      return "exhausted";
    }
    if (utilization !== null && utilization >= budget.warningThreshold) {
      return "warning";
    }
    if (budget.observedQuotaStatus === "warning") {
      return "warning";
    }
    return "ok";
  }

  private buildSnapshot(budget: BudgetState): QuotaSnapshot {
    const reserved = this.reservedUnits(budget.provider);
    const remaining = budget.capacityKnown ? budget.capacity - budget.committed - reserved : null;
    const utilization =
      budget.capacityKnown && budget.capacity > 0
        ? (budget.committed + reserved) / budget.capacity
        : budget.capacityKnown
          ? 0
          : null;
    const status = this.deriveStatus(budget, remaining, utilization);
    const degradedRoutingSuggested =
      budget.hardStopped ||
      budget.rateLimited ||
      budget.providerUnavailable ||
      status === "exhausted";
    return {
      provider: budget.provider,
      unit: budget.unit,
      status,
      capacityKnown: budget.capacityKnown,
      capacity: budget.capacityKnown ? budget.capacity : null,
      committed: budget.committed,
      reserved,
      remaining,
      remainingKnown: budget.capacityKnown,
      utilization,
      warningThreshold: budget.warningThreshold,
      reserves: {
        implementation: budget.reserveImpl,
        review: budget.reserveReview,
        repair: budget.reserveRepair
      },
      turnsUsed: budget.turnsUsed,
      maxTurns: budget.maxTurns,
      repairLoopsUsed: budget.repairLoopsUsed,
      maxRepairLoops: budget.maxRepairLoops,
      wallTimeUsedMs: this.clock.now() - budget.startedAtMs,
      maxWallTimeMs: budget.maxWallTimeMs,
      hardStopped: budget.hardStopped,
      hardStopCause: budget.hardStopCause,
      hardStopReason: budget.hardStopReason,
      rateLimited: budget.rateLimited,
      providerUnavailable: budget.providerUnavailable,
      authenticationRequired: budget.authenticationRequired,
      observedQuotaStatus: budget.observedQuotaStatus,
      observedQuotaWindow: budget.observedQuotaWindow,
      observedUtilization: budget.observedUtilization,
      observedExhaustionFlavor: budget.observedExhaustionFlavor,
      degradedRoutingSuggested,
      estimatedCostUsd: budget.lastUsageCostUsd,
      costSource: budget.lastUsageSource,
      isBillingAuthoritative: false
    };
  }

  private viewOf(reservation: Reservation): ReservationView {
    return {
      id: reservation.id,
      provider: reservation.provider,
      amount: reservation.amount,
      purpose: reservation.purpose,
      status: reservation.status,
      committedAmount: reservation.committedAmount,
      createdLedgerId: reservation.createdLedgerId
    };
  }
}
