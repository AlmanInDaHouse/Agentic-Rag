/**
 * Deterministic scenario engine for the mock provider framework (A2.1).
 *
 * A *scenario* is a declarative list of scripted steps. The engine turns a
 * scenario plus an injected `Clock` into an `AsyncIterable<ProviderEvent>` whose
 * order, sequence numbers and timestamps are exactly reproducible.
 *
 * Design contract (PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §"Scenario engine"):
 *
 * - The engine is a **faithful replayer**. It fills the common envelope
 *   (schemaVersion, executionId, provider, sequenceNumber, timestamp,
 *   rawEvidenceRef) and emits exactly what the scenario scripts. It does **not**
 *   enforce protocol invariants (single terminal, monotonic sequence, stop on
 *   cancel) and it does **not** silently repair deliberately-malformed steps —
 *   detecting violations is the job of the A2.2 black-box harness.
 * - Determinism: ids are derived from `executionId` + sequence, timestamps come
 *   from the injected clock, and there are no real sleeps. The consumer pulls
 *   the async iterator, so pacing is consumer-driven, never timing-sensitive.
 * - Two runtime behaviours are modelled (a well-behaved adapter reacting to its
 *   environment, not protocol enforcement): cooperative **cancellation** (a flag
 *   observed at the next step) and **timeout** (elapsed clock time vs the
 *   request budget). Violation scenarios opt out of these via `ignoresCancellation`
 *   so they can demonstrate misbehaviour (e.g. emitting after cancellation).
 */

import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  TERMINAL_EVENT_TYPES,
  type ProviderEvent,
  type ProviderEventType,
  type ProviderId,
  type ProviderResult,
  type ProviderResultStatus,
  type ProviderError,
  type ProviderUsage,
  type ProviderQuota,
  type AvailabilityStatus,
  type AuthenticationState,
  type CapabilityState
} from "@triforge/shared";
import type { Clock } from "../clock.js";

/** Default per-event clock advance. Small and fixed for readable timestamps. */
export const DEFAULT_TICK_MS = 1000;

/** Whether a scenario is contract-conformant or a deliberate contract violation. */
export type ScenarioConformance = "conformant" | "violating";

/**
 * An `emit` step. The engine builds the envelope and applies any overrides /
 * mutator before yielding. Overrides exist so violation scenarios can corrupt a
 * single field (sequence/provider/schemaVersion) without hand-building a whole
 * event; `mutate` covers arbitrary malformation (wrong payload type, missing
 * field, unknown discriminator).
 */
export interface EmitStep {
  kind: "emit";
  /** Discriminator written into the envelope (a valid type; use `mutate` for unknown types). */
  type: ProviderEventType;
  /** Event payload (validated by `ProviderEventSchema` only for conformant scenarios). */
  payload: unknown;
  /** Clock advance applied before stamping this event. Defaults to `DEFAULT_TICK_MS`. */
  advanceMs?: number;
  /** Replace the assigned monotonic sequence number (duplicate / gap / out-of-order). */
  sequenceOverride?: number;
  /** Replace the provider id (spoofed-identity violation). */
  providerOverride?: string;
  /** Replace the schema version (version-drift / spoofing). */
  schemaVersionOverride?: string;
  /** Arbitrary final mutation of the built event (malformed / unknown-type). */
  mutate?: (event: Record<string, unknown>) => Record<string, unknown>;
}

/** A `delay` step advances the clock without emitting (used to drive timeout). */
export interface DelayStep {
  kind: "delay";
  advanceMs: number;
}

/**
 * A `cancel` step flips the internal cancellation flag (the same flag set by
 * `adapter.cancel()`), making the scenario self-contained: the next step
 * boundary observes it and the engine emits a single cancellation terminal —
 * unless the scenario sets `ignoresCancellation`.
 */
export interface CancelStep {
  kind: "cancel";
}

export type ScenarioStep = EmitStep | DelayStep | CancelStep;

/** Optional probe fixtures so a scenario can stay cohesive across the adapter methods. */
export interface ScenarioProbe {
  availability?: AvailabilityStatus;
  authentication?: AuthenticationState;
  cliVersion?: string | null;
  capabilityOverrides?: Partial<Record<CapabilityFlag, CapabilityState>>;
}

/** The tri-state capability flags on `CapabilitySnapshot` (excluding metadata fields). */
export type CapabilityFlag =
  | "headlessSupport"
  | "structuredOutput"
  | "eventStream"
  | "authProbe"
  | "usageObservable"
  | "quotaObservable"
  | "readOnly"
  | "write"
  | "cancellation"
  | "resume";

export interface ScenarioDefinition {
  id: string;
  title: string;
  conformance: ScenarioConformance;
  /** One-line statement of what the scenario emits and why. */
  intent: string;
  steps: ScenarioStep[];
  /**
   * Violation switch: when true the engine does not stop on a cancellation flag,
   * so the scenario can demonstrate emission continuing after cancellation.
   */
  ignoresCancellation?: boolean;
  /** When true the engine does not synthesise a timeout terminal (default false). */
  ignoresTimeout?: boolean;
  probe?: ScenarioProbe;
}

/** Mutable cancellation flag shared between an adapter and its running engine. */
export interface CancelState {
  requested: boolean;
}

export interface EngineContext {
  executionId: string;
  provider: ProviderId;
  clock: Clock;
  cancelState: CancelState;
  /** Per-execution timeout budget in ms (from the request). `null` disables the check. */
  timeoutMs: number | null;
  /** Output-byte budget. `null` disables enforcement (the default). */
  maxOutputBytes: number | null;
  /** Sink the engine pushes every yielded event into (powers `adapter.getResult`). */
  recordedEvents?: ProviderEvent[];
}

/** Deterministic, non-secret evidence reference derived from executionId + sequence. */
export function makeEvidenceRef(executionId: string, sequenceNumber: number): string {
  return `evidence://${executionId}/${sequenceNumber}.jsonl`;
}

/** UTF-8 byte length of a JSON-serialised payload (output-limit accounting). */
export function payloadByteLength(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
}

const TERMINAL_TYPES = new Set<string>(TERMINAL_EVENT_TYPES);

/** Build a single envelope+payload event, applying overrides and any mutator. */
function buildEvent(ctx: EngineContext, step: EmitStep, sequenceNumber: number): ProviderEvent {
  const seq = step.sequenceOverride ?? sequenceNumber;
  const base: Record<string, unknown> = {
    schemaVersion: step.schemaVersionOverride ?? PROVIDER_CONTRACT_SCHEMA_VERSION,
    executionId: ctx.executionId,
    provider: step.providerOverride ?? ctx.provider,
    sequenceNumber: seq,
    timestamp: ctx.clock.iso(),
    rawEvidenceRef: makeEvidenceRef(ctx.executionId, seq),
    type: step.type,
    payload: step.payload
  };
  const finalEvent = step.mutate ? step.mutate(base) : base;
  // The cast is deliberate: violation scenarios emit runtime-invalid objects on
  // purpose. The interface stays `AsyncIterable<ProviderEvent>`; the harness
  // (A2.2) validates against the schema and detects the planted defects.
  return finalEvent as unknown as ProviderEvent;
}

/** Synthesise a terminal `run.failed` event (cancellation / timeout / output limit). */
function buildSyntheticTerminal(
  ctx: EngineContext,
  sequenceNumber: number,
  errorCode: "cancelled" | "timeout" | "output_limit_exceeded",
  message: string
): ProviderEvent {
  ctx.clock.advance(DEFAULT_TICK_MS);
  const event: Record<string, unknown> = {
    schemaVersion: PROVIDER_CONTRACT_SCHEMA_VERSION,
    executionId: ctx.executionId,
    provider: ctx.provider,
    sequenceNumber,
    timestamp: ctx.clock.iso(),
    rawEvidenceRef: makeEvidenceRef(ctx.executionId, sequenceNumber),
    type: "run.failed",
    payload: { errorCode, message, partial: true }
  };
  return event as unknown as ProviderEvent;
}

/**
 * Run a scenario, yielding the normalized event stream. The generator is lazy
 * (pull-based) and observes the cancellation flag and timeout budget at each
 * step boundary, exactly as a cooperative adapter would.
 */
export async function* runScenario(
  scenario: ScenarioDefinition,
  ctx: EngineContext
): AsyncGenerator<ProviderEvent> {
  const startMs = ctx.clock.now();
  const elapsed = (): number => ctx.clock.now() - startMs;
  let sequenceNumber = 0;
  let outputBytes = 0;

  const record = (event: ProviderEvent): void => {
    ctx.recordedEvents?.push(event);
  };

  for (const step of scenario.steps) {
    // Cooperative cancellation, observed at the next step boundary.
    if (ctx.cancelState.requested && !scenario.ignoresCancellation) {
      const terminal = buildSyntheticTerminal(
        ctx,
        sequenceNumber++,
        "cancelled",
        "Execution cancelled by request."
      );
      record(terminal);
      yield terminal;
      return;
    }

    // Timeout, observed against the injected clock (no real sleep).
    if (!scenario.ignoresTimeout && ctx.timeoutMs !== null && elapsed() >= ctx.timeoutMs) {
      const terminal = buildSyntheticTerminal(
        ctx,
        sequenceNumber++,
        "timeout",
        `Execution exceeded timeout of ${ctx.timeoutMs}ms.`
      );
      record(terminal);
      yield terminal;
      return;
    }

    if (step.kind === "delay") {
      ctx.clock.advance(step.advanceMs);
      continue;
    }

    if (step.kind === "cancel") {
      ctx.cancelState.requested = true;
      continue;
    }

    // emit
    ctx.clock.advance(step.advanceMs ?? DEFAULT_TICK_MS);
    const event = buildEvent(ctx, step, sequenceNumber);
    sequenceNumber++;

    if (ctx.maxOutputBytes !== null) {
      outputBytes += payloadByteLength(step.payload);
      if (outputBytes > ctx.maxOutputBytes) {
        record(event);
        yield event; // emit the offending event faithfully...
        const terminal = buildSyntheticTerminal(
          ctx,
          sequenceNumber++,
          "output_limit_exceeded",
          `Output exceeded ${ctx.maxOutputBytes} bytes (saw ${outputBytes}).`
        );
        record(terminal);
        yield terminal; // ...then a normalized terminal.
        return;
      }
    }

    record(event);
    yield event;
  }

  // A cancellation flag set by the final step still produces the terminal.
  if (ctx.cancelState.requested && !scenario.ignoresCancellation) {
    const terminal = buildSyntheticTerminal(
      ctx,
      sequenceNumber++,
      "cancelled",
      "Execution cancelled by request."
    );
    record(terminal);
    yield terminal;
  }
}

/** Map a terminal event to a `ProviderResult.status`. */
function statusForTerminal(event: ProviderEvent): ProviderResultStatus {
  if (event.type === "run.completed") {
    return "completed";
  }
  // run.failed
  const code = (event.payload as { errorCode?: string }).errorCode;
  return code === "cancelled" ? "cancelled" : "failed";
}

/**
 * Derive the structured terminal `ProviderResult` from an emitted event list.
 *
 * Faithful: uses the FIRST terminal event (a conformant stream has exactly one;
 * a duplicate-terminal violation is reported by the harness, not fixed here) and
 * returns `null` when no terminal was emitted (missing-terminal violation).
 */
export function deriveProviderResult(
  events: ProviderEvent[],
  meta: { provider: ProviderId; executionId: string; schemaVersion?: string }
): ProviderResult | null {
  const terminal = events.find((event) => TERMINAL_TYPES.has(event.type));
  if (!terminal) {
    return null;
  }

  const schemaVersion = meta.schemaVersion ?? PROVIDER_CONTRACT_SCHEMA_VERSION;
  const status = statusForTerminal(terminal);

  let lastUsage: ProviderUsage | null = null;
  let lastQuota: ProviderQuota | null = null;
  const filesChanged: string[] = [];
  for (const event of events) {
    if (event.type === "usage.updated") {
      lastUsage = (event.payload as { usage: ProviderUsage }).usage;
    } else if (event.type === "quota.updated") {
      lastQuota = (event.payload as { quota: ProviderQuota }).quota;
    } else if (event.type === "file.changed") {
      filesChanged.push((event.payload as { path: string }).path);
    }
  }

  let error: ProviderError | null = null;
  if (terminal.type === "run.failed") {
    const payload = terminal.payload as { errorCode: ProviderError["code"]; message: string };
    error = {
      code: payload.errorCode,
      message: payload.message,
      provider: meta.provider,
      executionId: meta.executionId,
      retriable: payload.errorCode === "rate_limited" || payload.errorCode === "timeout",
      rawEvidenceRef: terminal.rawEvidenceRef ?? null
    };
  }

  return {
    schemaVersion,
    provider: meta.provider,
    executionId: meta.executionId,
    status,
    terminalEventType: terminal.type as ProviderResult["terminalEventType"],
    terminalSequenceNumber: terminal.sequenceNumber,
    error,
    usage: lastUsage,
    quota: lastQuota,
    filesChanged,
    rawEvidenceRef: terminal.rawEvidenceRef ?? null
  };
}
