/**
 * Shared normalization core for the real provider adapters (A3).
 *
 * Both the Codex and Claude normalizers transform a provider's RAW output stream
 * (tagged stdout/stderr lines from a `ProcessRunner`) into the normalized A1
 * `ProviderEvent` stream. Everything provider-agnostic lives here; the only
 * provider-specific piece is a pure `mapLine` function (see codexNormalizer.ts /
 * claudeNormalizer.ts). This is what makes "provider differences are confined to
 * bin name, argv, the normalizer, and capability fixtures" true.
 *
 * Contract honored for EVERY run (so both real adapters pass the A2.2 harness
 * UNCHANGED):
 *  - order preserved; one monotonic `sequenceNumber` from 0; ISO timestamps from
 *    the injected `Clock` (no real time);
 *  - a `rawEvidenceRef` on every event pointing at retained raw evidence — never a
 *    secret;
 *  - raw kinds mapped onto the 13 `ProviderEvent` types;
 *  - parse errors surfaced as `warning.raised` (never thrown); UNKNOWN raw kinds
 *    surfaced as `warning.raised` (never a crash, never an unknown discriminator);
 *  - exactly ONE terminal (`run.completed` / `run.failed`) closes the stream, with
 *    a normalized error code derived from the process exit and any provider-
 *    reported error condition;
 *  - usage/quota mapped where the provider exposes them (`isBillingAuthoritative`
 *    is always false); omitted/unknown where not observable.
 *
 * The exact provider event schemas are versioned assumptions
 * (REQUIRES_VERIFICATION against the installed CLI version); the mapping reports
 * `unknown` / `warning.raised` rather than fabricating when it cannot recognize a
 * line (OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §13/§20; Vision §12).
 */

import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  type AgentExecutionRequest,
  type ProviderError,
  type ProviderEvent,
  type ProviderEventType,
  type ProviderId
} from "@triforge/shared";
import type { Clock } from "../clock.js";
import type { ProcessOutputLine, ProcessExit, RunningProcess } from "./processRunner.js";

/** Default per-event clock advance, mirroring the mock engine for readable timestamps. */
export const DEFAULT_TICK_MS = 1000;

/**
 * Deterministic, non-secret evidence reference. Points at retained raw evidence by
 * executionId + sequence; carries no payload content and therefore no secrets.
 */
export function makeRealEvidenceRef(executionId: string, sequenceNumber: number): string {
  return `evidence://real/${executionId}/${sequenceNumber}.jsonl`;
}

/** The non-terminal, non-run.started event types a mapping is allowed to emit. */
export type MappableEventType = Exclude<
  ProviderEventType,
  "run.started" | "run.completed" | "run.failed"
>;

/** A single normalized event a mapping wants emitted for one raw line. */
export interface NormalizedEvent {
  type: MappableEventType;
  payload: unknown;
}

/**
 * The result of mapping ONE raw output line. A mapping is pure and never throws;
 * it returns intents that the core turns into enveloped events.
 */
export interface MappedLine {
  /** Provider events to emit for this line, in order. */
  events?: NormalizedEvent[];
  /** The line was structured but could not be parsed → surfaced as warning.raised. */
  parseError?: string;
  /** The line parsed but its kind is unrecognized → surfaced as warning.raised (no crash). */
  unknownKind?: string;
  /** A provider-reported terminal error condition; overrides the exit-derived code. */
  terminalError?: { code: ProviderError["code"]; message: string };
  /** Provider signalled successful completion (carries an optional summary). */
  completed?: { summary?: string | null };
}

/** Provider-specific, pure line mapper. The ONLY provider-specific normalizer code. */
export interface ProviderLineMapper {
  readonly provider: ProviderId;
  /** Map one tagged output line to normalized intents. MUST be pure and never throw. */
  mapLine(line: ProcessOutputLine): MappedLine;
}

const OUTPUT_EVENT_TYPES = new Set<MappableEventType>([
  "agent.message",
  "plan.updated",
  "tool.started",
  "tool.completed",
  "file.changed"
]);

/** Map a runner termination reason to the A1 error taxonomy (when no provider error). */
function exitReasonToErrorCode(exit: ProcessExit): ProviderError["code"] {
  switch (exit.reason) {
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "output_limit":
      return "output_limit_exceeded";
    case "spawn_error":
      return "provider_unavailable";
    case "exited":
    default:
      return "process_crashed";
  }
}

function exitFailureMessage(exit: ProviderError["code"], raw: ProcessExit): string {
  switch (exit) {
    case "timeout":
      return "Provider process exceeded its timeout.";
    case "cancelled":
      return "Execution cancelled by request.";
    case "output_limit_exceeded":
      return "Provider output exceeded the configured byte budget.";
    case "provider_unavailable":
      return "Provider process could not be started.";
    default:
      return `Provider process exited abnormally (code=${String(raw.code)}, signal=${String(raw.signal)}).`;
  }
}

export interface NormalizeArgs {
  request: AgentExecutionRequest;
  running: RunningProcess;
  clock: Clock;
  mapper: ProviderLineMapper;
  /** Clock advance per event. Defaults to {@link DEFAULT_TICK_MS}. */
  tickMs?: number;
}

/**
 * Normalize a `RunningProcess` into an ordered `AsyncGenerator<ProviderEvent>`.
 *
 * Always emits a leading `run.started` (so the stream's first event is valid), maps
 * every output line through the provider mapper, and closes with exactly one
 * terminal synthesized from the process exit + any provider-reported error. The
 * generator never throws out of `execute()`; a stream error is downgraded to a
 * `warning.raised` and the run still terminates with a single terminal.
 */
export async function* normalizeProcess(args: NormalizeArgs): AsyncGenerator<ProviderEvent> {
  const { request, running, clock, mapper } = args;
  const tickMs = args.tickMs ?? DEFAULT_TICK_MS;
  const schemaVersion = request.schemaVersion ?? PROVIDER_CONTRACT_SCHEMA_VERSION;

  let sequenceNumber = 0;
  let emittedOutput = false;
  let filesChangedCount = 0;
  let terminalError: { code: ProviderError["code"]; message: string } | undefined;
  let completedSummary: string | null | undefined;

  const build = (type: ProviderEventType, payload: unknown): ProviderEvent => {
    clock.advance(tickMs);
    const seq = sequenceNumber;
    sequenceNumber += 1;
    return {
      schemaVersion,
      executionId: request.executionId,
      provider: mapper.provider,
      sequenceNumber: seq,
      timestamp: clock.iso(),
      rawEvidenceRef: makeRealEvidenceRef(request.executionId, seq),
      type,
      payload
    } as ProviderEvent;
  };

  // 1. Leading lifecycle event — the run has started (read-only per the request).
  yield build("run.started", { readOnly: request.readOnly });

  // 2. Map the raw output stream, line by line, in order.
  try {
    for await (const line of running.output) {
      const mapped = mapper.mapLine(line);

      if (mapped.parseError !== undefined) {
        yield build("warning.raised", {
          code: "provider_parse_error",
          message: mapped.parseError
        });
        continue;
      }
      if (mapped.unknownKind !== undefined) {
        yield build("warning.raised", {
          code: "unknown_provider_event",
          message: `Unrecognized provider event kind: ${mapped.unknownKind}`
        });
        continue;
      }

      for (const event of mapped.events ?? []) {
        if (OUTPUT_EVENT_TYPES.has(event.type)) {
          emittedOutput = true;
        }
        if (event.type === "file.changed") {
          filesChangedCount += 1;
        }
        yield build(event.type, event.payload);
      }

      if (mapped.terminalError !== undefined) {
        terminalError = mapped.terminalError;
      }
      if (mapped.completed !== undefined) {
        completedSummary = mapped.completed.summary ?? null;
      }
    }
  } catch (error) {
    // A misbehaving runner must not throw out of execute(): downgrade to a warning
    // and still close the run with a single terminal below.
    yield build("warning.raised", {
      code: "provider_stream_error",
      message: `Provider output stream error: ${String(error)}`
    });
  }

  // 3. Exactly one terminal, synthesized from the exit + any provider error.
  const exit = await running.exit;
  const succeeded = exit.reason === "exited" && exit.code === 0 && terminalError === undefined;

  if (succeeded) {
    yield build("run.completed", {
      summary: completedSummary ?? null,
      filesChangedCount
    });
    return;
  }

  const errorCode = terminalError?.code ?? exitReasonToErrorCode(exit);
  const message = terminalError?.message ?? exitFailureMessage(errorCode, exit);
  yield build("run.failed", {
    errorCode,
    message,
    partial: emittedOutput
  });
}
