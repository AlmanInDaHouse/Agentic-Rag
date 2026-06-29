/**
 * Injectable, deterministic clock — a NEUTRAL provider primitive (extracted from
 * `mock/clock.ts` as tech-debt TD-1 so product/domain code no longer depends on
 * the `mock/` test-double tree).
 *
 * This is the single time source for the provider stack. It is consumed by the
 * mock framework (A2.1), the real normalizer/adapter (A3), the quota manager
 * (A2.3) and the writable-execution runtime (A5+). Production paths must never
 * read `Date.now()` directly (mandate determinism requirement;
 * PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §"Determinism model"): a `Clock` is injected
 * so identical inputs produce identical, byte-for-byte reproducible output
 * regardless of wall-clock time or machine speed.
 *
 * `ManualClock` starts at a fixed epoch and only ever moves forward when the
 * caller explicitly calls `advance(ms)`. There are no real timers and no real
 * sleeps anywhere in this module.
 */

export interface Clock {
  /** Current time as epoch milliseconds. */
  now(): number;
  /** Current time as an ISO-8601 datetime string (matches `z.string().datetime()`). */
  iso(): string;
  /** Move the clock forward by `ms` milliseconds (deterministic, no real sleep). */
  advance(ms: number): void;
}

/**
 * Default deterministic epoch. A literal parse (not `Date.now()`), so the value
 * is frozen across runs and machines.
 */
export const DEFAULT_CLOCK_EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

export class ManualClock implements Clock {
  private current: number;

  constructor(startMs: number = DEFAULT_CLOCK_EPOCH_MS) {
    if (!Number.isFinite(startMs)) {
      throw new Error("ManualClock requires a finite start time");
    }
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  iso(): string {
    return new Date(this.current).toISOString();
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error("ManualClock.advance requires a finite, non-negative duration");
    }
    this.current += ms;
  }
}
