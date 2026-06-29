/**
 * Black-box adapter conformance harness (A2.2).
 *
 * `runConformanceCheck` drives ANY `ProviderAdapter` purely through its public
 * interface — `execute()` (the emitted `AsyncIterable<ProviderEvent>`) and
 * `cancel()` — and validates the A1 contract invariants (ordering, single
 * terminal, cancellation, timeout, output limits, secret leakage, malformed /
 * unknown events …). It treats the adapter as opaque: it NEVER reads adapter
 * internals and NEVER calls the mock-only `getResult()`. The structured terminal
 * result is always DERIVED from the observed stream via the provider-agnostic
 * `deriveProviderResult` (PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §2).
 *
 * Because it depends only on `ProviderAdapter` + the event stream, the A3 real
 * read-only Codex/Claude adapters are validated by this harness UNCHANGED
 * ("harness before trust", Vision §4.3/§14).
 *
 * Pure and deterministic given a deterministic adapter: no real CLI, no network,
 * no credentials, no filesystem writes, no DB. A bounded max-event guard ensures
 * a runaway / post-cancellation ("orphan") stream can never loop forever.
 */

import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  ProviderEventSchema,
  ProviderErrorCodeSchema,
  ProviderQuotaSchema,
  AuthenticationStateSchema,
  PROVIDER_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  type AgentExecutionRequest,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderId,
  type ProviderResult
} from "@triforge/shared";
// deriveProviderResult is the canonical, provider-agnostic stream -> result
// derivation the spec mandates A2.2/A3 use (it reads only the event stream, not
// any mock state). Importing it here avoids duplicating that logic; it is NOT a
// dependency on mock internals.
import { deriveProviderResult } from "../mock/index.js";
import {
  ALL_INVARIANT_IDS,
  ConformanceInvariant,
  INVARIANT_TITLES,
  type ConformanceInvariantId
} from "./invariants.js";
import { scanEventsForSecrets, type SecretFinding } from "./secretScan.js";

/** How the harness drives the adapter (selects which lifecycle invariants run). */
export type HarnessMode = "normal" | "cancellation" | "timeout";

export type InvariantStatus = "pass" | "fail" | "skip";

/** Result of evaluating one invariant against the observed stream. */
export interface InvariantResult {
  id: ConformanceInvariantId;
  title: string;
  status: InvariantStatus;
  detail: string;
}

export interface ConformanceOptions {
  /**
   * Drive mode. `"normal"` drains the stream; `"cancellation"` calls
   * `adapter.cancel()` after `cancelAfterEvents` events (exercising the
   * cancellation invariant); `"timeout"` enables the timeout-terminal invariant
   * (the caller supplies a `request.timeoutMs` the scenario will exceed).
   */
  mode?: HarnessMode;
  /** In cancellation mode, issue cancel after this many events (default 1). */
  cancelAfterEvents?: number;
  /**
   * Hard cap on collected events. A conformant run terminates well within this;
   * if the cap is hit the stream is abandoned and WITHIN_EVENT_BUDGET fails
   * (so a runaway / orphan stream cannot hang the harness). Default 1000.
   */
  maxEvents?: number;
  /**
   * In cancellation mode, how many in-flight events may still arrive AFTER
   * `cancel()` before a terminal must close the run. A real adapter cannot stop
   * instantly (buffered/in-flight events), so `eventsAfterCancel <= 1` is too
   * strict and false-fails A3 real adapters. CANCELLATION_STOPS_EMISSION passes
   * when the run ends in a cancelled (or already-completed, a race) terminal
   * within this allowance, and fails only if emission runs past it with no
   * terminal, or events continue after the terminal. Default 3.
   */
  cancelDrainAllowance?: number;
  /**
   * Optional wall-clock liveness budget (ms) per `iterator.next()`. When set, the
   * harness races each pull against a real timer — the ONLY real timer it ever
   * uses — and, on a timeout, abandons a wedged stream and FAILS ADAPTER_LIVENESS
   * instead of hanging. UNDEFINED by default so the deterministic mock tests never
   * touch real time; A3 REAL-adapter runs MUST set this (a hung CLI must be caught).
   */
  livenessTimeoutMs?: number;
}

/** Structured, per-invariant conformance report. */
export interface ConformanceReport {
  /** The adapter's declared provider id. */
  provider: ProviderId;
  /** The executionId the run was driven with. */
  executionId: string;
  /** The drive mode used. */
  mode: HarnessMode;
  /** True iff no invariant has status "fail". */
  ok: boolean;
  /** Per-invariant outcomes, in canonical order. */
  invariants: InvariantResult[];
  /** Every event observed on the stream (including any defects). */
  events: ProviderEvent[];
  /** Terminal result derived from the stream (null when no terminal was seen). */
  result: ProviderResult | null;
  /** True if the max-event guard tripped (runaway stream). */
  eventBudgetExceeded: boolean;
  /**
   * Specific-shape ("high" severity) secret matches in payloads / evidence refs.
   * These are the ONLY findings that hard-fail NO_SECRET_LEAKAGE.
   */
  secretFindings: SecretFinding[];
  /**
   * Generic high-entropy ("entropy" severity) hits. Non-failing warnings for the
   * operator to triage — a real reviewer legitimately cites base64/hashes, so
   * these must NOT fail conformance (a false-fail in A3).
   */
  entropyFindings: SecretFinding[];
}

const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_CANCEL_DRAIN_ALLOWANCE = 3;
const TERMINAL_TYPES = new Set<string>(TERMINAL_EVENT_TYPES);
const KNOWN_EVENT_TYPES = new Set<string>(PROVIDER_EVENT_TYPES);

/**
 * Real OUTPUT (work-product) event types, as opposed to status events
 * (quota.updated / warning.raised / authentication.updated / usage.updated).
 * Used by FIRST_EVENT_VALID (content before run.started) and
 * PARTIAL_EVIDENCE_PRESERVED (only real work counts as partial evidence).
 */
const OUTPUT_EVENT_TYPES = new Set<string>([
  "agent.message",
  "plan.updated",
  "tool.started",
  "tool.completed",
  "file.changed"
]);

/** Marker resolved by `raceWithTimeout` when the wall-clock budget elapses first. */
const LIVENESS_TIMED_OUT = Symbol("liveness-timed-out");

// --- raw-event accessors (events may be runtime-invalid by design) -------

const typeOf = (event: ProviderEvent): string => String((event as { type?: unknown }).type);
const seqOf = (event: ProviderEvent): number => {
  const value = (event as { sequenceNumber?: unknown }).sequenceNumber;
  return typeof value === "number" ? value : Number.NaN;
};
const providerOf = (event: ProviderEvent): unknown => (event as { provider?: unknown }).provider;
const executionIdOf = (event: ProviderEvent): unknown =>
  (event as { executionId?: unknown }).executionId;
const schemaVersionOf = (event: ProviderEvent): unknown =>
  (event as { schemaVersion?: unknown }).schemaVersion;
const timestampOf = (event: ProviderEvent): unknown => (event as { timestamp?: unknown }).timestamp;
const payloadOf = (event: ProviderEvent): Record<string, unknown> =>
  ((event as { payload?: unknown }).payload ?? {}) as Record<string, unknown>;

const isTerminalType = (type: string): boolean => TERMINAL_TYPES.has(type);
const payloadBytes = (payload: unknown): number =>
  Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");

// --- drive (drain) the adapter -------------------------------------------

interface DriveOutcome {
  events: ProviderEvent[];
  eventBudgetExceeded: boolean;
  cancelIssued: boolean;
  eventsAfterCancel: number;
  /** True iff a `livenessTimeoutMs` budget elapsed on some `iterator.next()`. */
  livenessTimedOut: boolean;
  /** True iff `execute()`/iteration THREW (caught here, never propagated). */
  threw: boolean;
  /** Detail of the thrown error (or "ok"). */
  throwDetail: string;
}

/**
 * Race a promise against a wall-clock timer. Resolves to the promise's value if
 * it settles first, or `LIVENESS_TIMED_OUT` if the timer wins. The timer is
 * `unref()`'d so it never keeps the process alive, and the promise's rejection is
 * always handled (so abandoning it cannot produce an unhandled rejection). This
 * is the ONLY real timer in the harness; it runs solely when a caller opts into
 * `livenessTimeoutMs` (never on the deterministic mock path).
 */
function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof LIVENESS_TIMED_OUT> {
  return new Promise<T | typeof LIVENESS_TIMED_OUT>((resolve, reject) => {
    const timer = setTimeout(() => resolve(LIVENESS_TIMED_OUT), ms);
    const handle = timer as unknown as { unref?: () => void };
    if (typeof handle.unref === "function") {
      handle.unref();
    }
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Best-effort close of a (possibly wedged) iterator without blocking forever. A
 * generator suspended on an `await` that never settles would make `return()`
 * hang too, so when a liveness budget is in play the close is itself raced.
 */
async function closeIterator(
  iterator: AsyncIterator<ProviderEvent>,
  livenessTimeoutMs: number | undefined
): Promise<void> {
  const ret = iterator.return;
  if (typeof ret !== "function") {
    return;
  }
  try {
    const returned = Promise.resolve(ret.call(iterator));
    if (livenessTimeoutMs !== undefined) {
      await raceWithTimeout(returned, livenessTimeoutMs);
    } else {
      await returned;
    }
  } catch {
    // ignore teardown errors from a misbehaving adapter
  }
}

/**
 * Drain `adapter.execute(request)` into an array, bounded by `maxEvents`. In
 * cancellation mode, `adapter.cancel()` is invoked after `cancelAfterEvents`
 * events and the count of events seen afterwards is recorded (so the harness can
 * prove a well-behaved adapter stops, and catch one that does not).
 *
 * Two safety nets make this a correct A3 gate, not just a mock gate:
 *  - any THROW out of `execute()` / iteration is caught and surfaced as a
 *    conformance failure (ADAPTER_NO_THROW), never propagated;
 *  - when `livenessTimeoutMs` is set, each `iterator.next()` is raced against a
 *    real timer so a wedged stream is abandoned (ADAPTER_LIVENESS) not awaited.
 */
async function driveAdapter(
  adapter: ProviderAdapter,
  request: AgentExecutionRequest,
  mode: HarnessMode,
  cancelAfterEvents: number,
  maxEvents: number,
  livenessTimeoutMs: number | undefined
): Promise<DriveOutcome> {
  const events: ProviderEvent[] = [];
  let eventBudgetExceeded = false;
  let cancelIssued = false;
  let eventsAfterCancel = 0;
  let livenessTimedOut = false;
  let threw = false;
  let throwDetail = "ok";

  let iterator: AsyncIterator<ProviderEvent> | undefined;
  try {
    iterator = adapter.execute(request)[Symbol.asyncIterator]();
    while (true) {
      let next: IteratorResult<ProviderEvent>;
      if (livenessTimeoutMs !== undefined) {
        const raced = await raceWithTimeout(iterator.next(), livenessTimeoutMs);
        if (raced === LIVENESS_TIMED_OUT) {
          livenessTimedOut = true;
          break;
        }
        next = raced;
      } else {
        next = await iterator.next();
      }
      if (next.done) {
        break;
      }
      events.push(next.value);
      if (cancelIssued) {
        eventsAfterCancel += 1;
      }
      if (mode === "cancellation" && !cancelIssued && events.length >= cancelAfterEvents) {
        await adapter.cancel(request.executionId);
        cancelIssued = true;
      }
      if (events.length >= maxEvents) {
        eventBudgetExceeded = true;
        break;
      }
    }
  } catch (error) {
    // M3: a throwing adapter is a conformance FAILURE, not a harness crash.
    threw = true;
    throwDetail = `adapter threw during execute()/iteration: ${String(error)}`;
  } finally {
    // Best-effort close so a half-drained / wedged generator can run cleanup;
    // never let the guard / liveness / throw paths leak the iterator.
    if (iterator && (eventBudgetExceeded || livenessTimedOut)) {
      await closeIterator(iterator, livenessTimeoutMs);
    }
  }

  return {
    events,
    eventBudgetExceeded,
    cancelIssued,
    eventsAfterCancel,
    livenessTimedOut,
    threw,
    throwDetail
  };
}

// --- invariant evaluation ------------------------------------------------

interface EvalContext {
  request: AgentExecutionRequest;
  adapterProvider: ProviderId;
  mode: HarnessMode;
  events: ProviderEvent[];
  outcome: DriveOutcome;
  /** Specific-shape ("high") findings only — the ones that hard-fail the secret invariant. */
  secretFindings: SecretFinding[];
  cancelIdempotent: boolean;
  cancelIdempotentDetail: string;
  /** In-flight events tolerated after cancel() before a terminal must close the run. */
  cancelDrainAllowance: number;
  /** The liveness budget the run was driven with (undefined = liveness not exercised). */
  livenessTimeoutMs: number | undefined;
}

class ReportBuilder {
  private readonly results = new Map<ConformanceInvariantId, InvariantResult>();

  pass(id: ConformanceInvariantId, detail = "ok"): void {
    this.set(id, "pass", detail);
  }
  fail(id: ConformanceInvariantId, detail: string): void {
    this.set(id, "fail", detail);
  }
  skip(id: ConformanceInvariantId, detail: string): void {
    this.set(id, "skip", detail);
  }
  private set(id: ConformanceInvariantId, status: InvariantStatus, detail: string): void {
    this.results.set(id, { id, title: INVARIANT_TITLES[id], status, detail });
  }
  /** Materialize results in canonical order; any id never set is a harness bug. */
  build(): InvariantResult[] {
    return ALL_INVARIANT_IDS.map(
      (id) =>
        this.results.get(id) ?? {
          id,
          title: INVARIANT_TITLES[id],
          status: "skip" as InvariantStatus,
          detail: "not evaluated"
        }
    );
  }
}

function evaluateInvariants(ctx: EvalContext): InvariantResult[] {
  const { events, request, adapterProvider, mode, outcome } = ctx;
  const report = new ReportBuilder();

  const types = events.map(typeOf);
  const seqs = events.map(seqOf);
  const terminalIndices = types.map((t, i) => (isTerminalType(t) ? i : -1)).filter((i) => i >= 0);
  const firstTerminalIndex = terminalIndices.length > 0 ? terminalIndices[0] : -1;
  const firstTerminal = firstTerminalIndex >= 0 ? events[firstTerminalIndex] : null;

  // 1. First lifecycle event.
  // A legitimate pre-start failure (auth required/expired, unavailable, cancel
  // before start) carries ONLY status + a normalized run.failed terminal and no
  // run.started. Any OUTPUT/content event — or a run.completed — without a
  // preceding run.started is illegitimate: a run cannot produce work or complete
  // before it started (L4).
  if (events.length === 0) {
    report.fail(ConformanceInvariant.FIRST_EVENT_VALID, "stream emitted no events");
  } else if (types.includes("run.started")) {
    if (types[0] === "run.started") {
      report.pass(ConformanceInvariant.FIRST_EVENT_VALID);
    } else {
      report.fail(
        ConformanceInvariant.FIRST_EVENT_VALID,
        `run.started present but first event is ${types[0]}`
      );
    }
  } else if (types.includes("run.completed")) {
    report.fail(
      ConformanceInvariant.FIRST_EVENT_VALID,
      "run.completed without a preceding run.started"
    );
  } else {
    const contentBeforeStart = types
      .map((type, index) => ({ index, type }))
      .filter((e) => OUTPUT_EVENT_TYPES.has(e.type));
    if (contentBeforeStart.length > 0) {
      report.fail(
        ConformanceInvariant.FIRST_EVENT_VALID,
        `content event(s) without a preceding run.started: ${contentBeforeStart
          .map((e) => `${e.type}@${e.index}`)
          .join(", ")}`
      );
    } else {
      report.pass(
        ConformanceInvariant.FIRST_EVENT_VALID,
        "pre-start failure: only status/terminal events, no content (legitimate per A1 §4)"
      );
    }
  }

  // 2. Provider identity stable + matches the adapter.
  {
    const mismatches = events
      .map((event, index) => ({ index, value: providerOf(event) }))
      .filter((entry) => entry.value !== adapterProvider);
    if (mismatches.length === 0) {
      report.pass(ConformanceInvariant.PROVIDER_IDENTITY_STABLE);
    } else {
      report.fail(
        ConformanceInvariant.PROVIDER_IDENTITY_STABLE,
        `events ${mismatches.map((m) => m.index).join(",")} have provider != "${adapterProvider}"`
      );
    }
  }

  // 3. executionId stable + equals the request.
  {
    const mismatches = events
      .map((event, index) => ({ index, value: executionIdOf(event) }))
      .filter((entry) => entry.value !== request.executionId);
    if (mismatches.length === 0) {
      report.pass(ConformanceInvariant.EXECUTION_ID_STABLE);
    } else {
      report.fail(
        ConformanceInvariant.EXECUTION_ID_STABLE,
        `events ${mismatches.map((m) => m.index).join(",")} have a divergent executionId`
      );
    }
  }

  // 4. schemaVersion present + consistent.
  {
    const bad = events
      .map((event, index) => ({ index, value: schemaVersionOf(event) }))
      .filter((entry) => typeof entry.value !== "string" || entry.value !== request.schemaVersion);
    if (bad.length === 0) {
      report.pass(ConformanceInvariant.SCHEMA_VERSION_CONSISTENT);
    } else {
      report.fail(
        ConformanceInvariant.SCHEMA_VERSION_CONSISTENT,
        `events ${bad.map((b) => b.index).join(",")} have a missing/divergent schemaVersion ` +
          `(expected ${request.schemaVersion})`
      );
    }
  }

  // 5. Valid, non-decreasing ISO timestamps.
  {
    const parsed = events.map((event) => {
      const ts = timestampOf(event);
      return typeof ts === "string" ? Date.parse(ts) : Number.NaN;
    });
    const invalid = parsed.map((value, index) => ({ index, value })).filter((e) => Number.isNaN(e.value));
    let regressionAt = -1;
    for (let i = 1; i < parsed.length; i += 1) {
      if (!Number.isNaN(parsed[i]) && !Number.isNaN(parsed[i - 1]) && parsed[i] < parsed[i - 1]) {
        regressionAt = i;
        break;
      }
    }
    if (invalid.length > 0) {
      report.fail(
        ConformanceInvariant.TIMESTAMPS_VALID_MONOTONIC,
        `events ${invalid.map((e) => e.index).join(",")} have invalid timestamps`
      );
    } else if (regressionAt >= 0) {
      report.fail(
        ConformanceInvariant.TIMESTAMPS_VALID_MONOTONIC,
        `timestamp decreases at event ${regressionAt}`
      );
    } else {
      report.pass(ConformanceInvariant.TIMESTAMPS_VALID_MONOTONIC);
    }
  }

  // 6. Strictly monotonic sequence (no out-of-order).
  {
    let badAt = -1;
    for (let i = 1; i < seqs.length; i += 1) {
      if (!(seqs[i] > seqs[i - 1])) {
        badAt = i;
        break;
      }
    }
    if (badAt < 0) {
      report.pass(ConformanceInvariant.SEQUENCE_MONOTONIC);
    } else {
      report.fail(
        ConformanceInvariant.SEQUENCE_MONOTONIC,
        `sequenceNumber not strictly increasing at event ${badAt} (${seqs[badAt - 1]} -> ${seqs[badAt]})`
      );
    }
  }

  // 7. Contiguous sequence from 0 (no gaps).
  {
    const numeric = seqs.filter((value) => Number.isInteger(value));
    if (numeric.length !== seqs.length) {
      report.fail(ConformanceInvariant.SEQUENCE_CONTIGUOUS, "non-integer sequenceNumber present");
    } else if (seqs.length === 0) {
      report.pass(ConformanceInvariant.SEQUENCE_CONTIGUOUS, "no events");
    } else {
      const unique = new Set(seqs);
      const max = Math.max(...seqs);
      const min = Math.min(...seqs);
      if (min === 0 && unique.size === max + 1) {
        report.pass(ConformanceInvariant.SEQUENCE_CONTIGUOUS);
      } else {
        report.fail(
          ConformanceInvariant.SEQUENCE_CONTIGUOUS,
          `sequence has a gap (min=${min}, max=${max}, distinct=${unique.size}, count=${seqs.length})`
        );
      }
    }
  }

  // 8. No duplicate sequence numbers.
  {
    if (new Set(seqs).size === seqs.length) {
      report.pass(ConformanceInvariant.SEQUENCE_NO_DUPLICATES);
    } else {
      const seen = new Set<number>();
      const dups = seqs.filter((value) => (seen.has(value) ? true : (seen.add(value), false)));
      report.fail(
        ConformanceInvariant.SEQUENCE_NO_DUPLICATES,
        `duplicate sequenceNumber(s): ${[...new Set(dups)].join(",")}`
      );
    }
  }

  // 9. No duplicate (byte-identical) events.
  {
    const seen = new Set<string>();
    let dupAt = -1;
    for (let i = 0; i < events.length; i += 1) {
      const key = JSON.stringify(events[i]);
      if (seen.has(key)) {
        dupAt = i;
        break;
      }
      seen.add(key);
    }
    if (dupAt < 0) {
      report.pass(ConformanceInvariant.NO_DUPLICATE_EVENTS);
    } else {
      report.fail(ConformanceInvariant.NO_DUPLICATE_EVENTS, `event ${dupAt} duplicates an earlier event`);
    }
  }

  // 10. Exactly one terminal event.
  if (terminalIndices.length === 1) {
    report.pass(ConformanceInvariant.EXACTLY_ONE_TERMINAL);
  } else {
    report.fail(
      ConformanceInvariant.EXACTLY_ONE_TERMINAL,
      `expected exactly one terminal event, found ${terminalIndices.length}`
    );
  }

  // 11. No events after the terminal.
  if (firstTerminalIndex < 0) {
    report.skip(ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL, "no terminal event");
  } else if (firstTerminalIndex === events.length - 1) {
    report.pass(ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL);
  } else {
    report.fail(
      ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL,
      `${events.length - 1 - firstTerminalIndex} event(s) emitted after the terminal`
    );
  }

  // 12. Partial evidence preserved on early termination.
  if (!firstTerminal || typeOf(firstTerminal) !== "run.failed") {
    report.skip(ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED, "no failed terminal");
  } else if (!types.includes("run.started")) {
    report.pass(
      ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED,
      "pre-start failure: no partial work expected"
    );
  } else {
    // Only real OUTPUT (work-product) events count as partial work; status
    // events (quota/warning/auth/usage) between start and the terminal are not
    // evidence of partial progress and must not force partial=true (L1).
    const startIndex = types.indexOf("run.started");
    const outputBetween = types
      .slice(startIndex + 1, firstTerminalIndex)
      .filter((type) => OUTPUT_EVENT_TYPES.has(type)).length;
    const partial = payloadOf(firstTerminal).partial === true;
    if (outputBetween > 0 && !partial) {
      report.fail(
        ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED,
        `failed after emitting ${outputBetween} output event(s) but terminal payload partial=false`
      );
    } else {
      report.pass(ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED);
    }
  }

  // 13. Errors normalized to the A1 taxonomy.
  {
    const bad = events
      .map((event, index) => ({ index, type: typeOf(event), code: payloadOf(event).errorCode }))
      .filter((e) => e.type === "run.failed" && !ProviderErrorCodeSchema.safeParse(e.code).success);
    if (bad.length === 0) {
      report.pass(ConformanceInvariant.ERRORS_NORMALIZED);
    } else {
      report.fail(
        ConformanceInvariant.ERRORS_NORMALIZED,
        `run.failed event(s) with non-taxonomy errorCode: ${bad.map((b) => b.index).join(",")}`
      );
    }
  }

  // 14. Auth states well-formed.
  {
    const authEvents = events
      .map((event, index) => ({ index, type: typeOf(event), state: payloadOf(event).state }))
      .filter((e) => e.type === "authentication.updated");
    const bad = authEvents.filter((e) => !AuthenticationStateSchema.safeParse(e.state).success);
    if (authEvents.length === 0) {
      report.skip(ConformanceInvariant.AUTH_STATES_WELL_FORMED, "no authentication.updated events");
    } else if (bad.length === 0) {
      report.pass(ConformanceInvariant.AUTH_STATES_WELL_FORMED);
    } else {
      report.fail(
        ConformanceInvariant.AUTH_STATES_WELL_FORMED,
        `malformed auth state at event(s) ${bad.map((b) => b.index).join(",")}`
      );
    }
  }

  // 15. Quota states well-formed (including unknown).
  {
    const quotaEvents = events
      .map((event, index) => ({ index, type: typeOf(event), quota: payloadOf(event).quota }))
      .filter((e) => e.type === "quota.updated");
    const bad = quotaEvents.filter((e) => !ProviderQuotaSchema.safeParse(e.quota).success);
    if (quotaEvents.length === 0) {
      report.skip(ConformanceInvariant.QUOTA_STATES_WELL_FORMED, "no quota.updated events");
    } else if (bad.length === 0) {
      report.pass(ConformanceInvariant.QUOTA_STATES_WELL_FORMED);
    } else {
      report.fail(
        ConformanceInvariant.QUOTA_STATES_WELL_FORMED,
        `malformed quota at event(s) ${bad.map((b) => b.index).join(",")}`
      );
    }
  }

  // 16. Output limits enforced when a budget is set.
  if (request.maxOutputBytes === null || request.maxOutputBytes === undefined) {
    report.skip(ConformanceInvariant.OUTPUT_LIMITS_ENFORCED, "no maxOutputBytes budget set");
  } else {
    const budget = request.maxOutputBytes;
    // Count payload bytes of EVERY event, including terminals that carry content
    // (e.g. a huge run.completed.summary), EXCEPT the synthetic
    // output_limit_exceeded terminal itself (the harness/engine's own normalized
    // terminal, not adapter output). Excluding all terminals false-passes an
    // adapter that hides its flood in run.completed (M4). The byte base is the
    // normalized-JSON payload — an approximation of a real adapter's raw stdout.
    const contentBytes = events
      .filter(
        (event) =>
          !(isTerminalType(typeOf(event)) && payloadOf(event).errorCode === "output_limit_exceeded")
      )
      .reduce((sum, event) => sum + payloadBytes(payloadOf(event)), 0);
    const exceeded = contentBytes > budget;
    const lastTerminalCode = firstTerminal ? payloadOf(firstTerminal).errorCode : undefined;
    if (!exceeded) {
      report.pass(ConformanceInvariant.OUTPUT_LIMITS_ENFORCED, "output stayed within budget");
    } else if (lastTerminalCode === "output_limit_exceeded") {
      report.pass(ConformanceInvariant.OUTPUT_LIMITS_ENFORCED, "terminated with output_limit_exceeded");
    } else {
      report.fail(
        ConformanceInvariant.OUTPUT_LIMITS_ENFORCED,
        `payload bytes (${contentBytes}) exceeded budget (${budget}) without an ` +
          "output_limit_exceeded terminal"
      );
    }
  }

  // 17. No secret leakage.
  if (ctx.secretFindings.length === 0) {
    report.pass(ConformanceInvariant.NO_SECRET_LEAKAGE);
  } else {
    report.fail(
      ConformanceInvariant.NO_SECRET_LEAKAGE,
      `secret-like content: ${ctx.secretFindings
        .map((f) => `${f.detector}@event${f.eventIndex}`)
        .join(", ")}`
    );
  }

  // 18. Every event validates against ProviderEventSchema.
  {
    const invalid = events
      .map((event, index) => ({ index, ok: ProviderEventSchema.safeParse(event).success }))
      .filter((e) => !e.ok);
    if (invalid.length === 0) {
      report.pass(ConformanceInvariant.EVENT_SCHEMA_VALID);
    } else {
      report.fail(
        ConformanceInvariant.EVENT_SCHEMA_VALID,
        `schema-invalid event(s): ${invalid.map((e) => e.index).join(",")}`
      );
    }
  }

  // 19. Every event type is a known A1 type.
  {
    const unknown = types
      .map((type, index) => ({ index, type }))
      .filter((e) => !KNOWN_EVENT_TYPES.has(e.type));
    if (unknown.length === 0) {
      report.pass(ConformanceInvariant.EVENT_TYPE_KNOWN);
    } else {
      report.fail(
        ConformanceInvariant.EVENT_TYPE_KNOWN,
        `unknown event type(s): ${unknown.map((e) => `${e.type}@${e.index}`).join(", ")}`
      );
    }
  }

  // 20. No file.changed under a read-only run (T-INT-14).
  // AUTHORITY is request.readOnly (the orchestrator's input), NOT the adapter-
  // emitted run.started.readOnly — the adapter controls its own payload and could
  // claim readOnly:false to launder a write. Under request.readOnly===true ANY
  // file.changed is a violation, regardless of payload; and a run.started that
  // carries a readOnly diverging from the authoritative input is itself a defect
  // (the adapter must reflect the input it was given) (H1).
  {
    const authoritativeReadOnly = request.readOnly === true;
    const writes = types
      .map((type, index) => ({ index, type }))
      .filter((e) => e.type === "file.changed");
    const startIndex = types.indexOf("run.started");
    const startedReadOnly =
      startIndex >= 0 ? payloadOf(events[startIndex]).readOnly : undefined;
    const reasons: string[] = [];
    if (authoritativeReadOnly && writes.length > 0) {
      reasons.push(
        `read-only run (request.readOnly=true) emitted file.changed at event(s) ` +
          `${writes.map((w) => w.index).join(",")}`
      );
    }
    if (
      startIndex >= 0 &&
      startedReadOnly !== undefined &&
      startedReadOnly !== request.readOnly
    ) {
      reasons.push(
        `run.started readOnly=${String(startedReadOnly)} diverges from authoritative ` +
          `request.readOnly=${String(request.readOnly)}`
      );
    }
    if (reasons.length === 0) {
      report.pass(
        ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY,
        authoritativeReadOnly ? "read-only run emitted no file.changed" : "writable run"
      );
    } else {
      report.fail(ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY, reasons.join("; "));
    }
  }

  // 21. Cancellation stops emission (cancellation mode only).
  if (mode !== "cancellation") {
    report.skip(ConformanceInvariant.CANCELLATION_STOPS_EMISSION, "not in cancellation mode");
  } else if (!outcome.cancelIssued) {
    report.skip(
      ConformanceInvariant.CANCELLATION_STOPS_EMISSION,
      "stream ended before the cancellation point"
    );
  } else {
    // A real adapter cannot stop instantly: in-flight events may still arrive
    // after cancel(). Tolerate up to `cancelDrainAllowance` of them, then require
    // the run to close cleanly. PASS when the run ends — within the allowance and
    // with no events after the terminal — in either a cancelled terminal (cancel
    // honoured) or a completed terminal (it finished before cancel took effect, a
    // legitimate race). FAIL only if emission runs past the allowance with no
    // terminal, or events continue after the terminal (M1).
    const allowance = ctx.cancelDrainAllowance;
    const cancelledTerminal =
      firstTerminal !== null &&
      typeOf(firstTerminal) === "run.failed" &&
      payloadOf(firstTerminal).errorCode === "cancelled";
    const completedTerminal = firstTerminal !== null && typeOf(firstTerminal) === "run.completed";
    const terminalIsLast = firstTerminalIndex >= 0 && firstTerminalIndex === events.length - 1;
    const withinAllowance = outcome.eventsAfterCancel <= allowance;
    if (terminalIsLast && withinAllowance && (cancelledTerminal || completedTerminal)) {
      report.pass(
        ConformanceInvariant.CANCELLATION_STOPS_EMISSION,
        completedTerminal
          ? `completed before cancel took effect (race); ${outcome.eventsAfterCancel} event(s) ` +
              `after cancel within allowance ${allowance}`
          : `cancelled terminal within allowance ${allowance} (${outcome.eventsAfterCancel} after cancel)`
      );
    } else {
      const terminalLabel = firstTerminal
        ? `${typeOf(firstTerminal)}{${String(payloadOf(firstTerminal).errorCode ?? "")}}`
        : "none";
      report.fail(
        ConformanceInvariant.CANCELLATION_STOPS_EMISSION,
        `after cancel(): ${outcome.eventsAfterCancel} event(s) followed (allowance ${allowance}); ` +
          `terminal=${terminalLabel}` +
          `${terminalIsLast ? "" : "; events continued after the terminal"}` +
          `${withinAllowance ? "" : "; emission ran past the allowance"}`
      );
    }
  }

  // 22. Timeout produces a timeout terminal (timeout mode only).
  if (mode !== "timeout") {
    report.skip(ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL, "not in timeout mode");
  } else {
    const timeoutTerminal =
      firstTerminal !== null &&
      typeOf(firstTerminal) === "run.failed" &&
      payloadOf(firstTerminal).errorCode === "timeout";
    if (timeoutTerminal && terminalIndices.length === 1) {
      report.pass(ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL);
    } else {
      report.fail(
        ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL,
        `expected a single run.failed{timeout}; terminal=` +
          `${firstTerminal ? `${typeOf(firstTerminal)}{${String(payloadOf(firstTerminal).errorCode)}}` : "none"}`
      );
    }
  }

  // 23. Within the max-event budget.
  if (outcome.eventBudgetExceeded) {
    report.fail(
      ConformanceInvariant.WITHIN_EVENT_BUDGET,
      "max-event guard tripped: stream did not terminate within the cap (runaway/orphan stream)"
    );
  } else {
    report.pass(ConformanceInvariant.WITHIN_EVENT_BUDGET);
  }

  // 24. cancel() idempotent + safe after completion (cleanup).
  if (ctx.cancelIdempotent) {
    report.pass(ConformanceInvariant.CANCEL_IDEMPOTENT);
  } else {
    report.fail(ConformanceInvariant.CANCEL_IDEMPOTENT, ctx.cancelIdempotentDetail);
  }

  // 25. The adapter did not throw out of execute()/iteration (M3).
  if (outcome.threw) {
    report.fail(ConformanceInvariant.ADAPTER_NO_THROW, outcome.throwDetail);
  } else {
    report.pass(ConformanceInvariant.ADAPTER_NO_THROW);
  }

  // 26. Liveness: the stream made progress within the budget (M2). Only exercised
  // when the caller opts into a real-clock budget (A3 real runs MUST set it);
  // skipped on the deterministic mock path so no real time is consumed.
  if (ctx.livenessTimeoutMs === undefined) {
    report.skip(
      ConformanceInvariant.ADAPTER_LIVENESS,
      "no livenessTimeoutMs budget set (deterministic run)"
    );
  } else if (outcome.livenessTimedOut) {
    report.fail(
      ConformanceInvariant.ADAPTER_LIVENESS,
      `no event within the liveness budget of ${ctx.livenessTimeoutMs}ms (wedged stream)`
    );
  } else {
    report.pass(ConformanceInvariant.ADAPTER_LIVENESS);
  }

  return report.build();
}

/**
 * Run the full conformance check against an adapter.
 *
 * Drives the adapter purely through `execute()` + `cancel()`, validates every
 * invariant, derives the terminal result from the observed stream, and returns a
 * structured report. `ok` is true iff no invariant failed (skips do not count).
 */
export async function runConformanceCheck(
  adapter: ProviderAdapter,
  request: AgentExecutionRequest,
  opts: ConformanceOptions = {}
): Promise<ConformanceReport> {
  const mode: HarnessMode = opts.mode ?? "normal";
  const cancelAfterEvents = Math.max(1, opts.cancelAfterEvents ?? 1);
  const maxEvents = Math.max(1, opts.maxEvents ?? DEFAULT_MAX_EVENTS);
  const cancelDrainAllowance = Math.max(0, opts.cancelDrainAllowance ?? DEFAULT_CANCEL_DRAIN_ALLOWANCE);
  const livenessTimeoutMs =
    opts.livenessTimeoutMs !== undefined ? Math.max(1, opts.livenessTimeoutMs) : undefined;

  const outcome = await driveAdapter(
    adapter,
    request,
    mode,
    cancelAfterEvents,
    maxEvents,
    livenessTimeoutMs
  );

  // Black-box cleanup / idempotence probe: a second (and, post-completion, a
  // third) cancel must be safe and not throw.
  let cancelIdempotent = true;
  let cancelIdempotentDetail = "ok";
  try {
    await adapter.cancel(request.executionId);
    await adapter.cancel(request.executionId);
  } catch (error) {
    cancelIdempotent = false;
    cancelIdempotentDetail = `cancel() threw on repeat call: ${String(error)}`;
  }

  // Split by severity: only specific-shape ("high") findings hard-fail
  // NO_SECRET_LEAKAGE; generic high-entropy ("entropy") hits are non-failing
  // warnings (a real reviewer legitimately cites base64/hashes) (M5).
  const allFindings = scanEventsForSecrets(outcome.events);
  const secretFindings = allFindings.filter((finding) => finding.severity === "high");
  const entropyFindings = allFindings.filter((finding) => finding.severity === "entropy");

  const invariants = evaluateInvariants({
    request,
    adapterProvider: adapter.provider,
    mode,
    events: outcome.events,
    outcome,
    secretFindings,
    cancelIdempotent,
    cancelIdempotentDetail,
    cancelDrainAllowance,
    livenessTimeoutMs
  });

  const result = deriveProviderResult(outcome.events, {
    provider: adapter.provider,
    executionId: request.executionId,
    schemaVersion: request.schemaVersion ?? PROVIDER_CONTRACT_SCHEMA_VERSION
  });

  return {
    provider: adapter.provider,
    executionId: request.executionId,
    mode,
    ok: invariants.every((invariant) => invariant.status !== "fail"),
    invariants,
    events: outcome.events,
    result,
    eventBudgetExceeded: outcome.eventBudgetExceeded,
    secretFindings,
    entropyFindings
  };
}

/** Convenience lookup: the result for one invariant id (undefined if absent). */
export function findInvariant(
  report: ConformanceReport,
  id: ConformanceInvariantId
): InvariantResult | undefined {
  return report.invariants.find((invariant) => invariant.id === id);
}
