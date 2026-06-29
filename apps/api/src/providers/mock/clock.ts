/**
 * Injectable, deterministic clock for the mock provider framework (A2.1).
 *
 * Production paths must never read `Date.now()` directly (mandate determinism
 * requirement; PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §"Determinism model"). The
 * scenario engine stamps every event timestamp from an injected `Clock`, so an
 * identical scenario produces an identical, byte-for-byte reproducible event
 * stream regardless of wall-clock time or machine speed.
 *
 * `ManualClock` starts at a fixed epoch and only ever moves forward when the
 * engine explicitly calls `advance(ms)`. There are no real timers and no real
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
