/**
 * The A2.1 scenario catalog: 35 named, deterministic provider-stream fixtures.
 *
 * Scenarios are parameterised by `ProviderId` so the *same* scenario id runs
 * through both `MockCodexAdapter` and `MockClaudeAdapter` and produces an
 * identical event shape (only the provider identity, and the inherited
 * quota-flavor vocabulary, differ). This keeps the engine and the scenarios
 * fully shared — the adapters add nothing but identity (mandate §14 A2.1).
 *
 * Each scenario is tagged `conformant` or `violating`:
 *  - conformant   — every emitted event validates against `ProviderEventSchema`
 *                   and the stream honours the protocol (single terminal, etc.).
 *                   Well-formed *failures* (auth, timeout, crash, quota) are
 *                   conformant: the defect is in the run, not in the contract.
 *  - violating    — the engine deliberately emits a contract violation (malformed
 *                   payload, unknown discriminator, sequence manipulation, double
 *                   or missing terminal, post-terminal emission, secret leakage,
 *                   read-only write attempt) for the A2.2 harness to detect. The
 *                   engine never silently repairs these.
 *
 * Several entries are *resource* or *orchestration* conditions rather than pure
 * schema cases; how each is modelled is documented inline and in
 * PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §"Scenario catalog".
 */

import type { ProviderId } from "@triforge/shared";
import type { EmitStep, ScenarioDefinition, ScenarioStep } from "./scenarioEngine.js";

/** Stable id for every catalog scenario. */
export const SCENARIO_IDS = [
  "success",
  "authenticationRequired",
  "authenticationExpired",
  "unavailableProvider",
  "unsupportedVersion",
  "timeout",
  "cancellationBeforeStart",
  "cancellationDuringStream",
  "providerCrash",
  "partialRun",
  "malformedEvent",
  "unknownEvent",
  "duplicateSequenceNumber",
  "sequenceGap",
  "outOfOrderEvent",
  "duplicateTerminalEvent",
  "missingTerminalEvent",
  "rateLimited",
  "quotaWarning",
  "quotaExhausted",
  "quotaUnknown",
  "usageUpdate",
  "toolUse",
  "fileChange",
  "approvalRequest",
  "warning",
  "structuredResult",
  "oversizedOutput",
  "secretLikePayload",
  "reviewerWriteAttempt",
  "continuedEmissionAfterCancellation",
  "cleanupFailure",
  "wallTimeExhaustion",
  "maxTurnExhaustion",
  "maxRepairLoopExhaustion"
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

/**
 * A clearly-FAKE secret used only by the redaction-test scenario. This is AWS's
 * own documentation example access-key id, assembled by concatenation so it is
 * never mistaken for a real credential by a scanner. NEVER put a real secret here.
 */
export const FAKE_AWS_ACCESS_KEY = "AKIA" + "IOSFODNN7" + "EXAMPLE";

/** A large, deterministic payload used by the output-flood / oversized scenario. */
export const OVERSIZED_TEXT = "x".repeat(70_000);

/** A clock advance comfortably larger than any sane per-execution timeout. */
const TIMEOUT_OVERSHOOT_MS = 86_400_000; // 24h

// --- step builders -------------------------------------------------------

const emit = (type: EmitStep["type"], payload: unknown, extra: Partial<EmitStep> = {}): EmitStep => ({
  kind: "emit",
  type,
  payload,
  ...extra
});

const started = (readOnly: boolean): EmitStep => emit("run.started", { readOnly });
const message = (text: string, role: "assistant" | "system" | "user" = "assistant"): EmitStep =>
  emit("agent.message", { role, text });
const completed = (summary: string | null, filesChangedCount = 0): EmitStep =>
  emit("run.completed", { summary, filesChangedCount });
const failed = (errorCode: string, message: string, partial: boolean): EmitStep =>
  emit("run.failed", { errorCode, message, partial });
const warning = (code: string, msg: string): EmitStep => emit("warning.raised", { code, message: msg });
const delay = (advanceMs: number): ScenarioStep => ({ kind: "delay", advanceMs });
const cancel = (): ScenarioStep => ({ kind: "cancel" });

const usagePayload = (provider: ProviderId, extra: Record<string, unknown> = {}): unknown => ({
  usage: {
    provider,
    inputTokens: 1200,
    outputTokens: 800,
    turns: 1,
    invocations: 1,
    durationMs: 4200,
    reasoningIntensity: "medium",
    source: "provider_event",
    // Emitted explicitly (not left to the schema default) so the RAW stream the
    // adapter yields literally matches the spec annotation: usage is never
    // billing-authoritative (ADR 0027 / ProviderUsageSchema).
    isBillingAuthoritative: false,
    ...extra
  }
});

// --- catalog -------------------------------------------------------------

/** Build the full 35-scenario catalog for a given provider. */
export function createScenarioCatalog(provider: ProviderId): Record<ScenarioId, ScenarioDefinition> {
  const exhaustionFlavor = provider === "claude" ? "claude_seven_day" : "codex_weekly";

  const catalog: Record<ScenarioId, ScenarioDefinition> = {
    success: {
      id: "success",
      title: "Successful read-only run",
      conformance: "conformant",
      intent: "Lifecycle from run.started through a single run.completed terminal.",
      steps: [
        started(true),
        emit("authentication.updated", { state: "authenticated", detail: null }),
        message("Analyzing the objective."),
        emit("plan.updated", {
          steps: [
            { title: "Read context", status: "completed" },
            { title: "Summarize findings", status: "in_progress" }
          ]
        }),
        message("Summary complete."),
        emit("usage.updated", usagePayload(provider)),
        completed("Objective satisfied.", 0)
      ]
    },

    authenticationRequired: {
      id: "authenticationRequired",
      title: "Authentication required",
      conformance: "conformant",
      intent: "Well-formed auth-required failure; no local session.",
      probe: { authentication: "required" },
      steps: [
        emit("authentication.updated", { state: "required", detail: "No local session found." }),
        failed("authentication_required", "Provider session required.", false)
      ]
    },

    authenticationExpired: {
      id: "authenticationExpired",
      title: "Authentication expired",
      conformance: "conformant",
      intent: "Well-formed auth-expired failure; local session lapsed.",
      probe: { authentication: "expired" },
      steps: [
        emit("authentication.updated", { state: "expired", detail: "Local session expired." }),
        failed("authentication_expired", "Provider session expired.", false)
      ]
    },

    unavailableProvider: {
      id: "unavailableProvider",
      title: "Unavailable provider",
      conformance: "conformant",
      intent: "Provider CLI not installed/reachable; terminal provider_unavailable.",
      probe: { availability: "unavailable" },
      steps: [failed("provider_unavailable", "Provider CLI not installed or unreachable.", false)]
    },

    unsupportedVersion: {
      id: "unsupportedVersion",
      title: "Unsupported CLI version",
      conformance: "conformant",
      intent:
        "Version drift (T-GIT-10): warning + terminal. No dedicated error code, so modelled as 'unknown'.",
      probe: {
        cliVersion: "0.0.0-unsupported",
        capabilityOverrides: {
          headlessSupport: "unknown",
          structuredOutput: "unknown",
          eventStream: "unknown",
          cancellation: "unknown",
          resume: "unknown"
        }
      },
      steps: [
        warning(
          "unsupported_cli_version",
          "Installed CLI version is unsupported; capability snapshot invalidated."
        ),
        failed("unknown", "Unsupported provider CLI version (version drift).", false)
      ]
    },

    timeout: {
      id: "timeout",
      title: "Execution timeout",
      conformance: "conformant",
      intent: "Clock advances past the request timeout; engine emits a timeout terminal.",
      steps: [
        started(true),
        delay(TIMEOUT_OVERSHOOT_MS),
        message("This message is preempted by the timeout."),
        completed("Unreachable.", 0)
      ]
    },

    cancellationBeforeStart: {
      id: "cancellationBeforeStart",
      title: "Cancellation before start",
      conformance: "conformant",
      intent: "Cancel flag set before any emit; only the cancellation terminal is produced.",
      steps: [cancel(), started(true), message("Preempted."), completed("Unreachable.", 0)]
    },

    cancellationDuringStream: {
      id: "cancellationDuringStream",
      title: "Cancellation during stream",
      conformance: "conformant",
      intent: "Cancel mid-stream; emission stops at the cancel point with a cancellation terminal.",
      steps: [
        started(true),
        message("Working..."),
        cancel(),
        message("Preempted after cancel."),
        completed("Unreachable.", 0)
      ]
    },

    providerCrash: {
      id: "providerCrash",
      title: "Provider crash",
      conformance: "conformant",
      intent: "Process exits unexpectedly mid-run; terminal process_crashed with partial=true.",
      steps: [
        started(true),
        message("Partial progress before crash."),
        failed("process_crashed", "Provider process exited unexpectedly.", true)
      ]
    },

    partialRun: {
      id: "partialRun",
      title: "Partial run",
      conformance: "conformant",
      intent: "Run ends early after partial output; terminal carries partial=true.",
      steps: [
        started(true),
        message("Began work."),
        emit("tool.started", {
          toolCallId: "call-1",
          toolName: "read_file",
          arguments: { path: "src/index.ts" }
        }),
        failed("unknown", "Run ended early with partial output.", true)
      ]
    },

    malformedEvent: {
      id: "malformedEvent",
      title: "Malformed event",
      conformance: "violating",
      intent: "An agent.message whose payload has a non-string text — schema-invalid on purpose.",
      steps: [
        started(true),
        emit("agent.message", { role: "assistant", text: "valid" }, {
          mutate: (event) => {
            event.payload = { role: "assistant", text: 12345 };
            return event;
          }
        }),
        completed("Done despite malformed event.", 0)
      ]
    },

    unknownEvent: {
      id: "unknownEvent",
      title: "Unknown event type",
      conformance: "violating",
      intent: "A discriminator outside the 13-event union (diagnostic.note).",
      steps: [
        started(true),
        emit("agent.message", { role: "assistant", text: "diagnostic" }, {
          mutate: (event) => {
            event.type = "diagnostic.note";
            return event;
          }
        }),
        completed("Done despite unknown event.", 0)
      ]
    },

    duplicateSequenceNumber: {
      id: "duplicateSequenceNumber",
      title: "Duplicate sequence number",
      conformance: "violating",
      intent: "Two events share sequenceNumber 1.",
      steps: [
        started(true), // seq 0
        message("first"), // seq 1
        emit("agent.message", { role: "assistant", text: "duplicate-seq" }, { sequenceOverride: 1 }),
        completed("Done.", 0) // seq 3
      ]
    },

    sequenceGap: {
      id: "sequenceGap",
      title: "Sequence gap",
      conformance: "violating",
      intent: "Sequence jumps 0 -> 5 -> 6, leaving a gap.",
      steps: [
        started(true), // seq 0
        emit("agent.message", { role: "assistant", text: "after-gap" }, { sequenceOverride: 5 }),
        emit("run.completed", { summary: "Done.", filesChangedCount: 0 }, { sequenceOverride: 6 })
      ]
    },

    outOfOrderEvent: {
      id: "outOfOrderEvent",
      title: "Out-of-order event",
      conformance: "violating",
      intent: "Sequence 2 is emitted after sequence 3.",
      steps: [
        started(true), // seq 0
        emit("agent.message", { role: "assistant", text: "seq-3" }, { sequenceOverride: 3 }),
        emit("agent.message", { role: "assistant", text: "seq-2 (out of order)" }, {
          sequenceOverride: 2
        }),
        emit("run.completed", { summary: "Done.", filesChangedCount: 0 }, { sequenceOverride: 4 })
      ]
    },

    duplicateTerminalEvent: {
      id: "duplicateTerminalEvent",
      title: "Duplicate terminal event",
      conformance: "violating",
      intent: "Two terminal run.completed events end the run.",
      steps: [started(true), completed("First terminal.", 0), completed("Second terminal.", 0)]
    },

    missingTerminalEvent: {
      id: "missingTerminalEvent",
      title: "Missing terminal event",
      conformance: "violating",
      intent: "Stream ends with no terminal event.",
      steps: [started(true), message("No terminal follows.")]
    },

    rateLimited: {
      id: "rateLimited",
      title: "Rate limited",
      conformance: "conformant",
      intent: "Provider reports a rate-limit quota signal, then a rate_limited terminal.",
      steps: [
        started(true),
        emit("quota.updated", {
          // isBillingAuthoritative emitted explicitly (not via schema default) so
          // the raw stream matches the spec/ADR 0027 annotation — same rationale
          // as usagePayload; applied to every quota.updated payload below.
          quota: {
            provider,
            status: "rate_limited",
            window: "five_hour",
            source: "cli_status",
            isBillingAuthoritative: false
          }
        }),
        failed("rate_limited", "Provider rate limit hit.", true)
      ]
    },

    quotaWarning: {
      id: "quotaWarning",
      title: "Quota warning",
      conformance: "conformant",
      intent: "A quota warning (utilization 0.82) before a normal completion.",
      steps: [
        started(true),
        emit("quota.updated", {
          quota: {
            provider,
            status: "warning",
            window: "five_hour",
            utilization: 0.82,
            source: "cli_status",
            isBillingAuthoritative: false
          }
        }),
        message("Proceeding under quota warning."),
        completed("Completed under warning.", 0)
      ]
    },

    quotaExhausted: {
      id: "quotaExhausted",
      title: "Quota exhausted",
      conformance: "conformant",
      intent: "Quota fully exhausted; terminal quota_exhausted (no paid fallback).",
      steps: [
        started(true),
        emit("quota.updated", {
          quota: {
            provider,
            status: "exhausted",
            window: "seven_day",
            utilization: 1,
            exhaustionFlavor,
            source: "cli_status",
            isBillingAuthoritative: false
          }
        }),
        failed("quota_exhausted", "Provider quota exhausted.", true)
      ]
    },

    quotaUnknown: {
      id: "quotaUnknown",
      title: "Quota unknown",
      conformance: "conformant",
      intent: "Quota cannot be verified; status/window/source all 'unknown' (never fabricated).",
      steps: [
        started(true),
        emit("quota.updated", {
          quota: {
            provider,
            status: "unknown",
            window: "unknown",
            source: "unknown",
            isBillingAuthoritative: false
          }
        }),
        completed("Completed with unknown quota.", 0)
      ]
    },

    usageUpdate: {
      id: "usageUpdate",
      title: "Usage update",
      conformance: "conformant",
      intent: "A client-side usage estimate (isBillingAuthoritative=false).",
      steps: [
        started(true),
        emit("usage.updated", usagePayload(provider, { source: "provider_event" })),
        completed("Completed with usage.", 0)
      ]
    },

    toolUse: {
      id: "toolUse",
      title: "Tool started/completed",
      conformance: "conformant",
      intent: "A matched tool.started / tool.completed pair.",
      steps: [
        started(true),
        emit("tool.started", {
          toolCallId: "call-1",
          toolName: "read_file",
          arguments: { path: "src/app.ts" }
        }),
        emit("tool.completed", {
          toolCallId: "call-1",
          toolName: "read_file",
          status: "succeeded",
          summary: "Read 42 lines."
        }),
        completed("Completed with tool use.", 0)
      ]
    },

    fileChange: {
      id: "fileChange",
      title: "File change event",
      conformance: "conformant",
      intent: "A writable run emits a legitimate file.changed (readOnly=false).",
      steps: [
        started(false),
        emit("file.changed", {
          path: "src/app.ts",
          changeType: "modified",
          diffHash: "sha256:abc123"
        }),
        completed("Edited app.ts.", 1)
      ]
    },

    approvalRequest: {
      id: "approvalRequest",
      title: "Approval request",
      conformance: "conformant",
      intent: "A high-risk action raises an approval.requested event.",
      steps: [
        started(false),
        emit("approval.requested", {
          approvalId: "appr-1",
          actionType: "modify_code",
          riskLevel: "high",
          reason: "Edit requires approval."
        }),
        completed("Completed after approval.", 0)
      ]
    },

    warning: {
      id: "warning",
      title: "Warning raised",
      conformance: "conformant",
      intent: "A non-fatal warning.raised before completion.",
      steps: [
        started(true),
        warning("deprecated_flag", "A deprecated CLI flag was used."),
        completed("Completed with warning.", 0)
      ]
    },

    structuredResult: {
      id: "structuredResult",
      title: "Structured result",
      conformance: "conformant",
      intent: "A rich completion: plan, tools, file change and usage feeding ProviderResult.",
      steps: [
        started(false),
        emit("plan.updated", { steps: [{ title: "Implement feature", status: "completed" }] }),
        emit("tool.started", {
          toolCallId: "call-9",
          toolName: "write_file",
          arguments: { path: "src/feature.ts" }
        }),
        emit("tool.completed", {
          toolCallId: "call-9",
          toolName: "write_file",
          status: "succeeded",
          summary: "Wrote feature."
        }),
        emit("file.changed", {
          path: "src/feature.ts",
          changeType: "created",
          diffHash: "sha256:def456"
        }),
        emit("usage.updated", usagePayload(provider)),
        completed("Feature implemented.", 1)
      ]
    },

    oversizedOutput: {
      id: "oversizedOutput",
      title: "Oversized output (output flood)",
      conformance: "conformant",
      intent:
        "A ~70KB agent.message; with a maxOutputBytes budget the engine emits an output_limit_exceeded terminal.",
      steps: [started(true), message(OVERSIZED_TEXT), completed("Unreachable under a small limit.", 0)]
    },

    secretLikePayload: {
      id: "secretLikePayload",
      title: "Secret-like payload (redaction test)",
      conformance: "violating",
      intent: "Carries a clearly-FAKE AWS example key so a future redaction control can be tested.",
      steps: [
        started(true),
        message(`Found credentials in config: ${FAKE_AWS_ACCESS_KEY} (do not leak).`),
        completed("Completed; payload contains a fake secret.", 0)
      ]
    },

    reviewerWriteAttempt: {
      id: "reviewerWriteAttempt",
      title: "Reviewer write attempt",
      conformance: "violating",
      intent: "A read-only run emits a file.changed — an unauthorized write attempt (T-INT-14).",
      steps: [
        started(true), // readOnly = true
        emit("file.changed", {
          path: "src/should-not-write.ts",
          changeType: "modified",
          diffHash: "sha256:bad"
        }),
        completed("Reviewer attempted a write.", 1)
      ]
    },

    continuedEmissionAfterCancellation: {
      id: "continuedEmissionAfterCancellation",
      title: "Continued emission after cancellation",
      conformance: "violating",
      intent: "Adapter ignores the cancel flag and keeps emitting (orphan-like misbehaviour).",
      ignoresCancellation: true,
      steps: [
        started(true),
        message("Working..."),
        cancel(),
        message("Still emitting after cancellation (violation)."),
        message("And again."),
        completed("Completed despite cancellation.", 0)
      ]
    },

    cleanupFailure: {
      id: "cleanupFailure",
      title: "Cleanup failure (post-terminal emission)",
      conformance: "violating",
      intent: "A warning.raised is emitted AFTER the terminal — a post-terminal event.",
      steps: [
        started(true),
        completed("Done.", 0), // terminal
        warning("cleanup_failed", "Temp worktree could not be removed.") // post-terminal (violation)
      ]
    },

    wallTimeExhaustion: {
      id: "wallTimeExhaustion",
      title: "Wall-time exhaustion",
      conformance: "conformant",
      intent:
        "Orchestration-level: warning + terminal 'unknown'. Models shared.maxWallTimeMs, not the per-exec timeout.",
      steps: [
        started(true),
        emit("usage.updated", usagePayload(provider, { turns: 6, durationMs: 600000 })),
        warning("wall_time_exhausted", "Orchestration wall-time budget exhausted."),
        failed("unknown", "Run stopped: wall-time budget exhausted.", true)
      ]
    },

    maxTurnExhaustion: {
      id: "maxTurnExhaustion",
      title: "Maximum turn exhaustion",
      conformance: "conformant",
      intent: "Orchestration-level: maximum turns per invocation reached.",
      steps: [
        started(true),
        emit("usage.updated", usagePayload(provider, { turns: 12 })),
        warning("max_turns_exhausted", "Maximum turns per invocation reached."),
        failed("unknown", "Run stopped: maximum turns reached.", true)
      ]
    },

    maxRepairLoopExhaustion: {
      id: "maxRepairLoopExhaustion",
      title: "Maximum repair-loop exhaustion",
      conformance: "conformant",
      intent: "Orchestration-level: maximum repair rounds reached.",
      steps: [
        started(true),
        warning("max_repair_loops_exhausted", "Maximum repair rounds reached."),
        failed("unknown", "Run stopped: maximum repair rounds reached.", true)
      ]
    }
  };

  return catalog;
}

/** Ids of conformant scenarios. */
export const CONFORMANT_SCENARIO_IDS: ScenarioId[] = SCENARIO_IDS.filter(
  (id) => createScenarioCatalog("codex")[id].conformance === "conformant"
);

/** Ids of deliberately contract-violating scenarios. */
export const VIOLATING_SCENARIO_IDS: ScenarioId[] = SCENARIO_IDS.filter(
  (id) => createScenarioCatalog("codex")[id].conformance === "violating"
);
