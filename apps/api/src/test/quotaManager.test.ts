import { describe, expect, it } from "vitest";
import type { ProviderId, ProviderQuota, ProviderUsage } from "@triforge/shared";
import { ManualClock } from "../providers/mock/index.js";
import {
  QuotaErrorCode,
  QuotaManager,
  isErr,
  isOk,
  type QuotaResult
} from "../providers/quota/index.js";

// --- helpers -------------------------------------------------------------

const CODEX: ProviderId = "codex";
const CLAUDE: ProviderId = "claude";

/** Configure a default known-capacity codex budget on a fresh manager. */
function freshCodex(
  capacity: number | "unknown" = 10,
  extra: Partial<Parameters<QuotaManager["configureBudget"]>[0]> = {},
  clock?: ManualClock
): QuotaManager {
  const manager = clock ? new QuotaManager({ clock }) : new QuotaManager();
  const result = manager.configureBudget({
    provider: CODEX,
    capacity,
    unit: "codex_invocations",
    ...extra
  });
  expect(result.ok).toBe(true);
  return manager;
}

function makeQuota(
  provider: ProviderId,
  status: ProviderQuota["status"],
  window: ProviderQuota["window"],
  extra: Partial<ProviderQuota> = {}
): ProviderQuota {
  return { provider, status, window, source: "provider_event", isBillingAuthoritative: false, ...extra };
}

function makeUsage(
  provider: ProviderId,
  source: ProviderUsage["source"],
  extra: Partial<ProviderUsage> = {}
): ProviderUsage {
  return { provider, source, isBillingAuthoritative: false, ...extra };
}

/** Assert a result is an error with a specific code; return the error. */
function expectErr<T>(result: QuotaResult<T>, code: string) {
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) {
    throw new Error("expected an error result");
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

function expectOk<T>(result: QuotaResult<T>): T {
  expect(isOk(result)).toBe(true);
  if (!isOk(result)) {
    throw new Error(`expected ok, got ${JSON.stringify((result as { error: unknown }).error)}`);
  }
  return result.value;
}

// --- configuration -------------------------------------------------------

describe("QuotaManager — configuration", () => {
  it("configures a budget and reports a fully-known snapshot", () => {
    const manager = freshCodex(10);
    const snap = manager.getSnapshot(CODEX);
    expect(snap).toBeDefined();
    expect(snap?.status).toBe("ok");
    expect(snap?.capacity).toBe(10);
    expect(snap?.remaining).toBe(10);
    expect(snap?.remainingKnown).toBe(true);
    expect(snap?.committed).toBe(0);
    expect(snap?.reserved).toBe(0);
    expect(snap?.isBillingAuthoritative).toBe(false);
  });

  it("rejects configuring the same provider twice", () => {
    const manager = freshCodex(10);
    const again = manager.configureBudget({ provider: CODEX, capacity: 5, unit: "codex_invocations" });
    expectErr(again, QuotaErrorCode.BUDGET_ALREADY_EXISTS);
  });

  it("returns BUDGET_NOT_FOUND for operations on an unconfigured provider", () => {
    const manager = new QuotaManager();
    expectErr(manager.reserve(CODEX, 1), QuotaErrorCode.BUDGET_NOT_FOUND);
    expectErr(manager.recordTurn(CODEX), QuotaErrorCode.BUDGET_NOT_FOUND);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.BUDGET_NOT_FOUND);
    expect(manager.getSnapshot(CODEX)).toBeUndefined();
    expect(manager.canReserve(CODEX, 1)).toBe(false);
  });
});

// --- happy path: reserve -> commit -> release ----------------------------

describe("QuotaManager — reserve/commit/release happy path", () => {
  it("reserve decreases remaining, commit consumes, release restores", () => {
    const manager = freshCodex(10);

    const r1 = expectOk(manager.reserve(CODEX, 4, "implementation"));
    expect(r1.status).toBe("active");
    expect(manager.getSnapshot(CODEX)?.reserved).toBe(4);
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(6);

    const commit = expectOk(manager.commit(r1.id));
    expect(commit.committedAmount).toBe(4);
    expect(manager.getSnapshot(CODEX)?.committed).toBe(4);
    expect(manager.getSnapshot(CODEX)?.reserved).toBe(0);
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(6);

    const r2 = expectOk(manager.reserve(CODEX, 2, "review"));
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(4);
    expectOk(manager.release(r2.id));
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(6);
    expect(manager.getSnapshot(CODEX)?.reserved).toBe(0);
  });

  it("commits for LESS than reserved, freeing the difference", () => {
    const manager = freshCodex(10);
    const r = expectOk(manager.reserve(CODEX, 5));
    const commit = expectOk(manager.commit(r.id, 3));
    expect(commit.committedAmount).toBe(3);
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(3);
    expect(snap?.reserved).toBe(0);
    expect(snap?.remaining).toBe(7);
  });

  it("canReserve mirrors reserve admissibility without mutating", () => {
    const manager = freshCodex(5);
    expect(manager.canReserve(CODEX, 5)).toBe(true);
    expect(manager.canReserve(CODEX, 6)).toBe(false);
    // no reservation was created by canReserve
    expect(manager.getSnapshot(CODEX)?.reserved).toBe(0);
  });
});

// --- negative-amount invariant ------------------------------------------

describe("QuotaManager — negative/zero amounts are typed errors", () => {
  it("rejects non-positive reservation amounts", () => {
    const manager = freshCodex(10);
    expectErr(manager.reserve(CODEX, -1), QuotaErrorCode.NEGATIVE_AMOUNT);
    expectErr(manager.reserve(CODEX, 0), QuotaErrorCode.NEGATIVE_AMOUNT);
    expectErr(manager.reserve(CODEX, Number.NaN), QuotaErrorCode.NEGATIVE_AMOUNT);
  });

  it("rejects a negative commit amount", () => {
    const manager = freshCodex(10);
    const r = expectOk(manager.reserve(CODEX, 2));
    expectErr(manager.commit(r.id, -2), QuotaErrorCode.NEGATIVE_AMOUNT);
    // the reservation is untouched and still committable
    expect(manager.getReservation(r.id)?.status).toBe("active");
  });
});

// --- double-commit / commit-released / unknown reservation ---------------

describe("QuotaManager — reservation lifecycle invariants", () => {
  it("a reservation cannot be committed twice", () => {
    const manager = freshCodex(10);
    const r = expectOk(manager.reserve(CODEX, 2));
    expectOk(manager.commit(r.id));
    expectErr(manager.commit(r.id), QuotaErrorCode.RESERVATION_ALREADY_COMMITTED);
  });

  it("a released reservation cannot be committed", () => {
    const manager = freshCodex(10);
    const r = expectOk(manager.reserve(CODEX, 2));
    expectOk(manager.release(r.id));
    expectErr(manager.commit(r.id), QuotaErrorCode.RESERVATION_ALREADY_RELEASED);
  });

  it("a committed reservation cannot be released, and release is not idempotent", () => {
    const manager = freshCodex(10);
    const committed = expectOk(manager.reserve(CODEX, 2));
    expectOk(manager.commit(committed.id));
    expectErr(manager.release(committed.id), QuotaErrorCode.RESERVATION_ALREADY_COMMITTED);

    const released = expectOk(manager.reserve(CODEX, 2));
    expectOk(manager.release(released.id));
    expectErr(manager.release(released.id), QuotaErrorCode.RESERVATION_ALREADY_RELEASED);
  });

  it("commit/release of an unknown reservation returns RESERVATION_NOT_FOUND", () => {
    const manager = freshCodex(10);
    expectErr(manager.commit("res-codex-999"), QuotaErrorCode.RESERVATION_NOT_FOUND);
    expectErr(manager.release("nope"), QuotaErrorCode.RESERVATION_NOT_FOUND);
  });
});

// --- over-commit / capacity / reserve-violation --------------------------

describe("QuotaManager — capacity & over-commit invariants", () => {
  it("reserving beyond remaining capacity returns RUN_BUDGET_EXHAUSTED", () => {
    const manager = freshCodex(5);
    expectErr(manager.reserve(CODEX, 6), QuotaErrorCode.RUN_BUDGET_EXHAUSTED);
  });

  it("committing more than capacity allows returns OVER_COMMIT (consumption never goes negative)", () => {
    const manager = freshCodex(10);
    const r = expectOk(manager.reserve(CODEX, 2));
    expectErr(manager.commit(r.id, 100), QuotaErrorCode.OVER_COMMIT);
    // the failed over-commit left the reservation usable
    const ok = expectOk(manager.commit(r.id, 2));
    expect(ok.committedAmount).toBe(2);
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(8);
  });

  it("a reservation that would eat into protected reserves returns RUN_BUDGET_RESERVE_VIOLATION", () => {
    const manager = freshCodex(5, { reserves: { implementation: 2, review: 2 } });
    // planning has no reserve bucket: it must leave impl(2)+review(2)=4 protected,
    // so only 1 of the 5 units is spendable by planning.
    expectErr(manager.reserve(CODEX, 2, "planning"), QuotaErrorCode.RUN_BUDGET_RESERVE_VIOLATION);
    expectOk(manager.reserve(CODEX, 1, "planning"));
    // implementation may draw from its own reserve
    expectOk(manager.reserve(CODEX, 2, "implementation"));
    // review may draw from its own reserve
    expectOk(manager.reserve(CODEX, 2, "review"));
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(0);
  });
});

// --- warnings ------------------------------------------------------------

describe("QuotaManager — warning threshold", () => {
  it("enters the warning status when utilization crosses the threshold and logs it", () => {
    const manager = freshCodex(10); // default threshold 0.8
    expectOk(manager.reserve(CODEX, 7));
    expect(manager.getSnapshot(CODEX)?.status).toBe("ok");
    expectOk(manager.reserve(CODEX, 1)); // util 0.8 -> warning
    expect(manager.getSnapshot(CODEX)?.status).toBe("warning");
    expect(manager.ledgerFor(CODEX).some((e) => e.kind === "warn")).toBe(true);
  });

  it("stopOnWarning escalates a warning to a hard stop", () => {
    const manager = freshCodex(10, { stopOnWarning: true });
    expectOk(manager.reserve(CODEX, 8)); // crosses 0.8 -> warn -> hard stop
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.hardStopped).toBe(true);
    expect(snap?.hardStopCause).toBe("quota_warning");
    expectErr(manager.reserve(CODEX, 1), QuotaErrorCode.BUDGET_HARD_STOPPED);
  });
});

// --- exhaustion -> hard stop -> manual resume ----------------------------

describe("QuotaManager — exhaustion, hard stop and manual resume", () => {
  it("observed exhaustion hard-stops, refuses new reservations, and resumes only manually", () => {
    const manager = freshCodex(5);
    // do some partial work first; it must be preserved across the hard stop
    const r = expectOk(manager.reserve(CODEX, 2, "implementation"));
    expectOk(manager.commit(r.id));
    expect(manager.getSnapshot(CODEX)?.committed).toBe(2);

    expectOk(
      manager.recordObservedQuota(
        makeQuota(CODEX, "exhausted", "five_hour", { exhaustionFlavor: "codex_five_hour" })
      )
    );
    const exhausted = manager.getSnapshot(CODEX);
    expect(exhausted?.status).toBe("exhausted");
    expect(exhausted?.hardStopped).toBe(true);
    expect(exhausted?.hardStopCause).toBe("quota_exhausted");
    expect(exhausted?.committed).toBe(2); // partial preserved, never lost or idled
    expect(exhausted?.degradedRoutingSuggested).toBe(true);

    // no new reservations under a hard stop
    expect(manager.canReserve(CODEX, 1)).toBe(false);
    expectErr(manager.reserve(CODEX, 1), QuotaErrorCode.PROVIDER_QUOTA_EXHAUSTED);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.PROVIDER_QUOTA_EXHAUSTED);

    // manual resume restores reservability
    expectOk(manager.resume(CODEX));
    expect(manager.getSnapshot(CODEX)?.hardStopped).toBe(false);
    expect(manager.canReserve(CODEX, 1)).toBe(true);
    expectOk(manager.reserve(CODEX, 1));
  });

  it("an explicit hard stop blocks reservations with BUDGET_HARD_STOPPED", () => {
    const manager = freshCodex(10);
    expectOk(manager.hardStop(CODEX, "operator stop"));
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.status).toBe("hard_stopped");
    expect(snap?.hardStopCause).toBe("manual");
    expectErr(manager.reserve(CODEX, 1), QuotaErrorCode.BUDGET_HARD_STOPPED);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.BUDGET_HARD_STOPPED);
  });

  it("resume on a budget that is not stopped is a typed error", () => {
    const manager = freshCodex(10);
    expectErr(manager.resume(CODEX), QuotaErrorCode.NOTHING_TO_RESUME);
  });

  it("resume with reset clears consumption (quota-window reset)", () => {
    const manager = freshCodex(5);
    const r = expectOk(manager.reserve(CODEX, 5, "implementation"));
    expectOk(manager.commit(r.id));
    expectOk(manager.hardStop(CODEX, "exhausted locally"));
    const restored = expectOk(manager.resume(CODEX, { reset: true }));
    expect(restored.committed).toBe(0);
    expect(restored.remaining).toBe(5);
  });
});

// --- unknown state is never a fabricated number --------------------------

describe("QuotaManager — unknown state is never numeric", () => {
  it("an unknown-capacity budget reports a null remaining, never a fabricated number", () => {
    const manager = new QuotaManager();
    expectOk(manager.configureBudget({ provider: CODEX, capacity: "unknown", unit: "codex_window" }));
    let snap = manager.getSnapshot(CODEX);
    expect(snap?.status).toBe("unknown");
    expect(snap?.capacity).toBeNull();
    expect(snap?.remaining).toBeNull();
    expect(snap?.remainingKnown).toBe(false);
    expect(snap?.utilization).toBeNull();

    // counts we take are knowable, but remaining stays unknown (not invented)
    expectOk(manager.reserve(CODEX, 3));
    snap = manager.getSnapshot(CODEX);
    expect(snap?.reserved).toBe(3);
    expect(snap?.remaining).toBeNull();
    expect(snap?.status).toBe("unknown");
  });

  it("an observed unknown quota never fabricates a utilization", () => {
    const manager = freshCodex(5);
    expectOk(manager.recordObservedQuota(makeQuota(CODEX, "unknown", "unknown")));
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.observedQuotaStatus).toBe("unknown");
    expect(snap?.observedUtilization).toBeNull();
    // observed-unknown does not by itself stop the run nor coerce to available
    expect(snap?.hardStopped).toBe(false);
  });
});

// --- estimates are never authoritative billing ---------------------------

describe("QuotaManager — cost views are never authoritative billing", () => {
  it("records an estimated cost with isBillingAuthoritative=false regardless of source", () => {
    const manager = freshCodex(5);
    expectOk(manager.recordObservedUsage(makeUsage(CODEX, "provider_event", { estimatedCostUsd: 1.23 })));
    let snap = manager.getSnapshot(CODEX);
    expect(snap?.estimatedCostUsd).toBe(1.23);
    expect(snap?.costSource).toBe("provider_event");
    expect(snap?.isBillingAuthoritative).toBe(false);

    expectOk(manager.recordObservedUsage(makeUsage(CODEX, "unknown", { estimatedCostUsd: 9.99 })));
    snap = manager.getSnapshot(CODEX);
    expect(snap?.costSource).toBe("unknown");
    expect(snap?.isBillingAuthoritative).toBe(false);
  });
});

// --- orchestration limits: turns / loops / wall time ---------------------

describe("QuotaManager — turn / repair-loop / wall-time limits", () => {
  it("enforces maxTurns", () => {
    const manager = freshCodex(100, { limits: { maxTurns: 2 } });
    expectOk(manager.recordTurn(CODEX));
    expectOk(manager.recordTurn(CODEX));
    expectErr(manager.recordTurn(CODEX), QuotaErrorCode.MAX_TURNS_EXCEEDED);
    expect(manager.getSnapshot(CODEX)?.turnsUsed).toBe(2);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.MAX_TURNS_EXCEEDED);
  });

  it("enforces maxRepairLoops", () => {
    const manager = freshCodex(100, { limits: { maxRepairLoops: 1 } });
    expectOk(manager.recordRepairLoop(CODEX));
    expectErr(manager.recordRepairLoop(CODEX), QuotaErrorCode.MAX_REPAIR_LOOPS_EXCEEDED);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.MAX_REPAIR_LOOPS_EXCEEDED);
  });

  it("enforces maxWallTimeMs against the INJECTED clock (no Date.now)", () => {
    const clock = new ManualClock();
    const manager = freshCodex(100, { limits: { maxWallTimeMs: 1000 } }, clock);
    expect(isOk(manager.assertCanProceed(CODEX))).toBe(true);
    expect(manager.getSnapshot(CODEX)?.wallTimeUsedMs).toBe(0);

    clock.advance(1500);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.MAX_WALL_TIME_EXCEEDED);
    expect(manager.getSnapshot(CODEX)?.wallTimeUsedMs).toBe(1500);
  });
});

// --- per-provider independence ------------------------------------------

describe("QuotaManager — per-provider independence", () => {
  it("codex and claude budgets do not interfere", () => {
    const manager = new QuotaManager();
    expectOk(manager.configureBudget({ provider: CODEX, capacity: 5, unit: "codex_invocations" }));
    expectOk(manager.configureBudget({ provider: CLAUDE, capacity: 3, unit: "claude_invocations" }));

    const r = expectOk(manager.reserve(CODEX, 5, "implementation"));
    expectOk(manager.commit(r.id));
    expectOk(manager.hardStop(CODEX, "stop codex only"));

    // claude is entirely unaffected
    const claude = manager.getSnapshot(CLAUDE);
    expect(claude?.status).toBe("ok");
    expect(claude?.remaining).toBe(3);
    expect(claude?.hardStopped).toBe(false);
    expect(manager.canReserve(CLAUDE, 3)).toBe(true);

    // the ledger partitions cleanly by provider
    expect(manager.ledgerFor(CLAUDE).every((e) => e.provider === CLAUDE)).toBe(true);
    expect(manager.ledgerFor(CODEX).every((e) => e.provider === CODEX)).toBe(true);
  });
});

// --- degraded routing signal --------------------------------------------

describe("QuotaManager — degraded routing signal (no auto-switch)", () => {
  it("suggests degradation when exhausted, rate-limited or unavailable", () => {
    const manager = freshCodex(5);
    expect(manager.getSnapshot(CODEX)?.degradedRoutingSuggested).toBe(false);

    expectOk(manager.recordObservedQuota(makeQuota(CODEX, "rate_limited", "five_hour")));
    expect(manager.getSnapshot(CODEX)?.degradedRoutingSuggested).toBe(true);
    expect(manager.getSnapshot(CODEX)?.status).toBe("rate_limited");
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.PROVIDER_RATE_LIMITED);

    // rate limit clears on resume (manual), not silently in the background
    expectOk(manager.resume(CODEX));
    expect(manager.getSnapshot(CODEX)?.degradedRoutingSuggested).toBe(false);
  });

  it("provider-unavailable is surfaced explicitly and clears", () => {
    const manager = freshCodex(5);
    expectOk(manager.recordProviderUnavailable(CODEX, "cli not reachable"));
    expect(manager.getSnapshot(CODEX)?.providerUnavailable).toBe(true);
    expect(manager.getSnapshot(CODEX)?.degradedRoutingSuggested).toBe(true);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.PROVIDER_UNAVAILABLE);
    expectOk(manager.recordProviderAvailable(CODEX));
    expect(manager.getSnapshot(CODEX)?.providerUnavailable).toBe(false);
  });

  it("authentication-required is surfaced explicitly and clears", () => {
    const manager = freshCodex(5);
    expectOk(manager.recordAuthenticationRequired(CODEX));
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.PROVIDER_AUTHENTICATION_REQUIRED);
    expectOk(manager.recordAuthenticated(CODEX));
    expect(isOk(manager.assertCanProceed(CODEX))).toBe(true);
  });
});

// --- no paid fallback ----------------------------------------------------

describe("QuotaManager — no paid/usage-credit fallback", () => {
  it("attempting to spend usage or purchased credits is a typed error, not approvable", () => {
    const manager = freshCodex(5);
    expectErr(manager.requestUsageCreditSpend(CODEX), QuotaErrorCode.PROVIDER_USAGE_CREDITS_REQUIRED);
    expectErr(
      manager.requestPurchasedCreditSpend(CODEX),
      QuotaErrorCode.PROVIDER_PURCHASED_CREDITS_REQUIRED
    );
    const denials = manager.ledgerFor(CODEX).filter((e) => e.kind === "credit_denied");
    expect(denials).toHaveLength(2);
  });
});

// --- assertCanProceed gate ----------------------------------------------

describe("QuotaManager — assertCanProceed pre-step gate", () => {
  it("passes a healthy budget and rejects an unaffordable required reservation", () => {
    const manager = freshCodex(5);
    expect(isOk(manager.assertCanProceed(CODEX))).toBe(true);
    expect(isOk(manager.assertCanProceed(CODEX, { requireUnits: 5 }))).toBe(true);
    expectErr(
      manager.assertCanProceed(CODEX, { requireUnits: 6 }),
      QuotaErrorCode.RUN_BUDGET_EXHAUSTED
    );
  });
});

// --- ledger auditability -------------------------------------------------

describe("QuotaManager — append-only auditable ledger", () => {
  it("records every transition in monotonic order with injected timestamps", () => {
    const clock = new ManualClock();
    const manager = freshCodex(100, {}, clock);

    clock.advance(1000);
    const r1 = expectOk(manager.reserve(CODEX, 2));
    clock.advance(1000);
    expectOk(manager.commit(r1.id));
    clock.advance(1000);
    const r2 = expectOk(manager.reserve(CODEX, 2));
    clock.advance(1000);
    expectOk(manager.release(r2.id));
    clock.advance(1000);
    expectOk(manager.hardStop(CODEX, "stop"));
    clock.advance(1000);
    expectOk(manager.resume(CODEX));

    const ledger = manager.ledger();
    expect(ledger.map((e) => e.kind)).toEqual([
      "configure",
      "reserve",
      "commit",
      "reserve",
      "release",
      "hardstop",
      "resume"
    ]);
    // monotonic ids 1..n with no gaps
    expect(ledger.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // timestamps come from the injected clock (non-decreasing, deterministic)
    const times = ledger.map((e) => e.atMs);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
    // the ledger is a copy: mutating it does not affect the manager
    (ledger as unknown as { length: number }).length = 0;
    expect(manager.ledger()).toHaveLength(7);
  });

  // F3: the ledger must deep-copy nested detail, not just the top level.
  it("deep-copies nested detail so a caller cannot mutate the internal ledger", () => {
    const manager = freshCodex(10, {
      reserves: { implementation: 2, review: 1 },
      limits: { maxTurns: 5 }
    });

    const first = manager.ledger();
    const cfg = first.find((e) => e.kind === "configure");
    expect(cfg).toBeDefined();
    // mutate the returned copy's NESTED objects
    (cfg!.detail.reserves as { implementation: number }).implementation = 999;
    (cfg!.detail.limits as { maxTurns: number | null }).maxTurns = 999;

    // a subsequently re-fetched ledger is untouched (nested objects were cloned)
    const second = manager.ledger();
    const cfg2 = second.find((e) => e.kind === "configure");
    expect((cfg2!.detail.reserves as { implementation: number }).implementation).toBe(2);
    expect((cfg2!.detail.limits as { maxTurns: number | null }).maxTurns).toBe(5);

    // ledgerFor() has the same deep-copy guarantee
    const perProvider = manager.ledgerFor(CODEX);
    const cfg3 = perProvider.find((e) => e.kind === "configure");
    (cfg3!.detail.reserves as { review: number }).review = 777;
    const cfg4 = manager.ledgerFor(CODEX).find((e) => e.kind === "configure");
    expect((cfg4!.detail.reserves as { review: number }).review).toBe(1);
  });
});

// --- F1: reserve protection survives a window reset ----------------------

describe("QuotaManager — reserve protection after a window reset (F1)", () => {
  it("resume({reset}) neutralizes committed reservations so reserve protection is restored", () => {
    const config = { reserves: { implementation: 4 } };
    const manager = freshCodex(10, config);

    // consume the implementation reserve, then hard stop and window-reset
    const r = expectOk(manager.reserve(CODEX, 4, "implementation"));
    expectOk(manager.commit(r.id));
    expectOk(manager.hardStop(CODEX, "window exhausted"));
    expectOk(manager.resume(CODEX, { reset: true }));

    // a FRESH budget of the same config is the source of truth for headroom
    const fresh = freshCodex(10, config);
    for (const amount of [1, 5, 6, 7, 10]) {
      expect(manager.canReserve(CODEX, amount, "planning")).toBe(
        fresh.canReserve(CODEX, amount, "planning")
      );
    }

    // snapshot is internally consistent: no lingering committed/protected consumption
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(0);
    expect(snap?.reserved).toBe(0);
    expect(snap?.remaining).toBe(10);

    // protection restored: planning may take at most capacity - reserveImpl (= 6)
    expect(manager.canReserve(CODEX, 6, "planning")).toBe(true);
    expect(manager.canReserve(CODEX, 7, "planning")).toBe(false);

    // the pre-reset reservation is retained for audit, marked released
    expect(manager.getReservation(r.id)?.status).toBe("released");
  });
});

// --- F2: commit-for-more cannot bypass protected headroom ----------------

describe("QuotaManager — commit-for-more respects protected reserves (F2)", () => {
  it("rejects a commit-for-more that would eat into another phase's reserve", () => {
    const manager = freshCodex(10, { reserves: { implementation: 4 } });
    // planning may reserve up to 6 (leaving 4 protected for implementation)
    const r = expectOk(manager.reserve(CODEX, 6, "planning"));
    // committing 7 would consume 1 unit of implementation's protected reserve
    expectErr(manager.commit(r.id, 7), QuotaErrorCode.RUN_BUDGET_RESERVE_VIOLATION);
    // the reservation survived the rejected commit and still commits within bounds
    const okCommit = expectOk(manager.commit(r.id, 6));
    expect(okCommit.committedAmount).toBe(6);
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(6);
    expect(snap?.remaining).toBe(4); // exactly the implementation reserve remains
  });

  it("allows a legitimate commit-for-more when no reserve is breached", () => {
    const manager = freshCodex(10); // no reserves configured
    const r = expectOk(manager.reserve(CODEX, 4, "planning"));
    const okCommit = expectOk(manager.commit(r.id, 7)); // within capacity, nothing protected
    expect(okCommit.committedAmount).toBe(7);
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(7);
    expect(snap?.remaining).toBe(3);
  });

  it("commit-for-LESS and commit-equal are unaffected by the headroom check", () => {
    const manager = freshCodex(10, { reserves: { implementation: 4 } });
    // commit-equal for a non-critical purpose at its max reservation
    const a = expectOk(manager.reserve(CODEX, 6, "planning"));
    expectOk(manager.commit(a.id, 6));
    // commit-for-less from an implementation reservation
    const b = expectOk(manager.reserve(CODEX, 4, "implementation"));
    const okCommit = expectOk(manager.commit(b.id, 2));
    expect(okCommit.committedAmount).toBe(2);
    expect(manager.getSnapshot(CODEX)?.committed).toBe(8);
  });
});

// --- F4: reserves must fit capacity --------------------------------------

describe("QuotaManager — reserves-vs-capacity validation (F4)", () => {
  it("rejects a budget whose reserves sum to more than capacity", () => {
    const manager = new QuotaManager();
    const result = manager.configureBudget({
      provider: CODEX,
      capacity: 5,
      unit: "codex_invocations",
      reserves: { implementation: 3, review: 3 } // sum 6 > 5
    });
    expectErr(result, QuotaErrorCode.RESERVES_EXCEED_CAPACITY);
    // no dead budget was created
    expect(manager.hasBudget(CODEX)).toBe(false);
  });

  it("allows reserves summing exactly to capacity (0 spendable for non-critical phases)", () => {
    const manager = new QuotaManager();
    expectOk(
      manager.configureBudget({
        provider: CODEX,
        capacity: 6,
        unit: "codex_invocations",
        reserves: { implementation: 3, review: 2, repair: 1 } // sum 6 == 6
      })
    );
    // non-critical phases have no spendable headroom
    expect(manager.canReserve(CODEX, 1, "planning")).toBe(false);
    // each critical phase may still draw its own reserve
    expectOk(manager.reserve(CODEX, 3, "implementation"));
    expectOk(manager.reserve(CODEX, 2, "review"));
    expectOk(manager.reserve(CODEX, 1, "repair"));
    expect(manager.getSnapshot(CODEX)?.remaining).toBe(0);
  });

  it("does not constrain reserves for an unknown-capacity budget", () => {
    const manager = new QuotaManager();
    expectOk(
      manager.configureBudget({
        provider: CODEX,
        capacity: "unknown",
        unit: "codex_window",
        reserves: { implementation: 100, review: 100 }
      })
    );
    expect(manager.hasBudget(CODEX)).toBe(true);
  });
});

// --- review-flagged invariants -------------------------------------------

describe("QuotaManager — additional review-flagged invariants", () => {
  it("recordObservedQuota('available') clears rate-limit but never an existing hard stop", () => {
    const manager = freshCodex(5);
    expectOk(manager.recordObservedQuota(makeQuota(CODEX, "rate_limited", "five_hour")));
    expectOk(
      manager.recordObservedQuota(
        makeQuota(CODEX, "exhausted", "five_hour", { exhaustionFlavor: "codex_five_hour" })
      )
    );
    let snap = manager.getSnapshot(CODEX);
    expect(snap?.rateLimited).toBe(true);
    expect(snap?.hardStopped).toBe(true);

    // 'available' is a transient signal: it clears the rate-limit only
    expectOk(manager.recordObservedQuota(makeQuota(CODEX, "available", "five_hour")));
    snap = manager.getSnapshot(CODEX);
    expect(snap?.rateLimited).toBe(false);
    expect(snap?.hardStopped).toBe(true); // hard stop persists (manual resume only)
    expect(snap?.status).toBe("exhausted");

    // only a manual resume clears the hard stop
    expectOk(manager.resume(CODEX));
    expect(manager.getSnapshot(CODEX)?.hardStopped).toBe(false);
  });

  it("commit accounts for MULTIPLE other active reservations and stays within capacity", () => {
    const manager = freshCodex(10);
    const a = expectOk(manager.reserve(CODEX, 2));
    const b = expectOk(manager.reserve(CODEX, 3));
    const c = expectOk(manager.reserve(CODEX, 1));

    // committing b while a AND c remain active: otherActiveReserved = 2 + 1 = 3
    const commitB = expectOk(manager.commit(b.id, 3));
    expect(commitB.committedAmount).toBe(3);
    let snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(3);
    expect(snap?.reserved).toBe(3); // a(2) + c(1)
    expect(snap?.remaining).toBe(4);

    // commit-for-more on a, with c still reserved, is bounded by capacity:
    // committed(3) + 7 + otherReserved(c=1) = 11 > 10 → OVER_COMMIT
    expectErr(manager.commit(a.id, 7), QuotaErrorCode.OVER_COMMIT);
    // 3 + 6 + 1 = 10 == capacity → allowed
    const commitA = expectOk(manager.commit(a.id, 6));
    expect(commitA.committedAmount).toBe(6);
    snap = manager.getSnapshot(CODEX);
    expect(snap?.committed).toBe(9);
    expect(snap?.reserved).toBe(1); // c
    expect(snap?.remaining).toBe(0);
  });

  it("an unknown-capacity budget still enforces maxTurns / maxWallTimeMs / hard stop", () => {
    const clock = new ManualClock();
    const manager = new QuotaManager({ clock });
    expectOk(
      manager.configureBudget({
        provider: CODEX,
        capacity: "unknown",
        unit: "codex_window",
        limits: { maxTurns: 2, maxWallTimeMs: 1000 }
      })
    );
    expect(manager.getSnapshot(CODEX)?.status).toBe("unknown");
    expect(manager.getSnapshot(CODEX)?.remaining).toBeNull();

    // maxTurns enforced despite unknown capacity
    expectOk(manager.recordTurn(CODEX));
    expectOk(manager.recordTurn(CODEX));
    expectErr(manager.recordTurn(CODEX), QuotaErrorCode.MAX_TURNS_EXCEEDED);

    // maxWallTimeMs enforced on the injected clock
    clock.advance(1500);
    expectErr(manager.assertCanProceed(CODEX), QuotaErrorCode.MAX_WALL_TIME_EXCEEDED);

    // hard stop enforced
    expectOk(manager.hardStop(CODEX, "operator stop"));
    expect(manager.getSnapshot(CODEX)?.hardStopped).toBe(true);
    expectErr(manager.reserve(CODEX, 1), QuotaErrorCode.BUDGET_HARD_STOPPED);
  });

  it("recordObservedUsage with an ABSENT estimatedCostUsd keeps the cost null", () => {
    const manager = freshCodex(5);
    expectOk(
      manager.recordObservedUsage(makeUsage(CODEX, "provider_event", { estimatedCostUsd: 2.5 }))
    );
    expect(manager.getSnapshot(CODEX)?.estimatedCostUsd).toBe(2.5);

    // a later usage with no cost must NOT keep the stale value or fabricate one
    expectOk(manager.recordObservedUsage(makeUsage(CODEX, "provider_event")));
    const snap = manager.getSnapshot(CODEX);
    expect(snap?.estimatedCostUsd).toBeNull();
    expect(snap?.costSource).toBe("provider_event");
  });
});
