/**
 * Conformance invariant identifiers (A2.2).
 *
 * Stable, enumerable ids for every contract invariant the black-box adapter
 * harness verifies. They are a public, versioned vocabulary: A3 (real Codex /
 * Claude adapters) references these exact ids when asserting conformance, so the
 * values MUST stay stable across milestones (treat them like an API).
 *
 * The set maps onto PROVIDER_MOCKS_HARNESS_QUOTA_SPEC §12's 18 invariants, but
 * splits a few coarse ones into independently-assertable checks so a single
 * violating scenario fails exactly one (or a small, predictable set of) id(s):
 *
 *   spec §12.6  "monotonic, contiguous sequence (flags dups/gaps)"
 *               -> SEQUENCE_MONOTONIC + SEQUENCE_CONTIGUOUS + SEQUENCE_NO_DUPLICATES
 *   spec §12.7  "no duplicate events"           -> NO_DUPLICATE_EVENTS
 *   spec §12.14 "auth and quota states surface" -> AUTH_STATES_WELL_FORMED + QUOTA_STATES_WELL_FORMED
 *   spec §12.17 "malformed/unknown rejected"    -> EVENT_SCHEMA_VALID + EVENT_TYPE_KNOWN
 *
 * Several ids extend §12 with controls the spec's scenario catalog (§10), the
 * threat model and the A3 real-adapter gate require but §12 folds elsewhere:
 *   NO_WRITE_UNDER_READ_ONLY  - reviewer write attempt (T-INT-14, scenario #30);
 *                               authority is request.readOnly, NOT the adapter-
 *                               emitted run.started.readOnly (which it controls)
 *   WITHIN_EVENT_BUDGET       - runaway/orphan stream guard (the max-event cap)
 *   ADAPTER_NO_THROW          - execute()/iteration throwing is a conformance
 *                               failure, never an exception out of the harness
 *   ADAPTER_LIVENESS          - a wedged (non-progressing) stream is caught by an
 *                               opt-in wall-clock liveness budget (A3 real runs)
 */

/** The stable invariant id vocabulary. Values are part of the public contract. */
export const ConformanceInvariant = {
  FIRST_EVENT_VALID: "first-event-valid",
  PROVIDER_IDENTITY_STABLE: "provider-identity-stable",
  EXECUTION_ID_STABLE: "execution-id-stable",
  SCHEMA_VERSION_CONSISTENT: "schema-version-consistent",
  TIMESTAMPS_VALID_MONOTONIC: "timestamps-valid-monotonic",
  SEQUENCE_MONOTONIC: "sequence-monotonic",
  SEQUENCE_CONTIGUOUS: "sequence-contiguous",
  SEQUENCE_NO_DUPLICATES: "sequence-no-duplicates",
  NO_DUPLICATE_EVENTS: "no-duplicate-events",
  EXACTLY_ONE_TERMINAL: "exactly-one-terminal",
  NO_EVENTS_AFTER_TERMINAL: "no-events-after-terminal",
  PARTIAL_EVIDENCE_PRESERVED: "partial-evidence-preserved",
  ERRORS_NORMALIZED: "errors-normalized",
  AUTH_STATES_WELL_FORMED: "auth-states-well-formed",
  QUOTA_STATES_WELL_FORMED: "quota-states-well-formed",
  OUTPUT_LIMITS_ENFORCED: "output-limits-enforced",
  NO_SECRET_LEAKAGE: "no-secret-leakage",
  EVENT_SCHEMA_VALID: "event-schema-valid",
  EVENT_TYPE_KNOWN: "event-type-known",
  NO_WRITE_UNDER_READ_ONLY: "no-write-under-read-only",
  CANCELLATION_STOPS_EMISSION: "cancellation-stops-emission",
  TIMEOUT_PRODUCES_TERMINAL: "timeout-produces-terminal",
  WITHIN_EVENT_BUDGET: "within-event-budget",
  CANCEL_IDEMPOTENT: "cancel-idempotent",
  ADAPTER_NO_THROW: "adapter-no-throw",
  ADAPTER_LIVENESS: "adapter-liveness"
} as const;

export type ConformanceInvariantId =
  (typeof ConformanceInvariant)[keyof typeof ConformanceInvariant];

/** Human-readable title per invariant (used in the report). */
export const INVARIANT_TITLES: Record<ConformanceInvariantId, string> = {
  [ConformanceInvariant.FIRST_EVENT_VALID]:
    "First lifecycle event is run.started for runs that actually start",
  [ConformanceInvariant.PROVIDER_IDENTITY_STABLE]:
    "Provider identity is stable and matches the adapter on every event",
  [ConformanceInvariant.EXECUTION_ID_STABLE]:
    "executionId is stable across the stream and equals the request",
  [ConformanceInvariant.SCHEMA_VERSION_CONSISTENT]:
    "schemaVersion is present and consistent on every event",
  [ConformanceInvariant.TIMESTAMPS_VALID_MONOTONIC]:
    "Timestamps are valid ISO-8601 and non-decreasing",
  [ConformanceInvariant.SEQUENCE_MONOTONIC]:
    "sequenceNumber is strictly increasing (no out-of-order events)",
  [ConformanceInvariant.SEQUENCE_CONTIGUOUS]:
    "sequenceNumber is contiguous from 0 (no gaps)",
  [ConformanceInvariant.SEQUENCE_NO_DUPLICATES]: "sequenceNumber has no duplicates",
  [ConformanceInvariant.NO_DUPLICATE_EVENTS]: "No duplicate events in the stream",
  [ConformanceInvariant.EXACTLY_ONE_TERMINAL]: "Exactly one terminal event ends the run",
  [ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL]:
    "No events are emitted after the terminal event",
  [ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED]:
    "Partial evidence is preserved on early termination",
  [ConformanceInvariant.ERRORS_NORMALIZED]: "Errors are normalized to the A1 error taxonomy",
  [ConformanceInvariant.AUTH_STATES_WELL_FORMED]: "Authentication states are well-formed",
  [ConformanceInvariant.QUOTA_STATES_WELL_FORMED]:
    "Quota states are well-formed (including unknown)",
  [ConformanceInvariant.OUTPUT_LIMITS_ENFORCED]:
    "Output limits are enforced when a budget is set",
  [ConformanceInvariant.NO_SECRET_LEAKAGE]:
    "No secret leakage in event payloads or evidence refs",
  [ConformanceInvariant.EVENT_SCHEMA_VALID]: "Every event validates against ProviderEventSchema",
  [ConformanceInvariant.EVENT_TYPE_KNOWN]: "Every event type is a known A1 event type",
  [ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY]:
    "No file.changed under a read-only run (T-INT-14)",
  [ConformanceInvariant.CANCELLATION_STOPS_EMISSION]:
    "Cancellation yields a single cancelled terminal and stops emission",
  [ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL]: "Timeout yields a single timeout terminal",
  [ConformanceInvariant.WITHIN_EVENT_BUDGET]: "Stream terminates within the max-event budget",
  [ConformanceInvariant.CANCEL_IDEMPOTENT]:
    "cancel() is idempotent and safe after completion (cleanup)",
  [ConformanceInvariant.ADAPTER_NO_THROW]:
    "execute()/iteration does not throw out of the adapter boundary",
  [ConformanceInvariant.ADAPTER_LIVENESS]:
    "Adapter makes progress within the liveness budget (no wedged stream)"
};

/** Every invariant id, in canonical (report) order. */
export const ALL_INVARIANT_IDS: ConformanceInvariantId[] = [
  ConformanceInvariant.FIRST_EVENT_VALID,
  ConformanceInvariant.PROVIDER_IDENTITY_STABLE,
  ConformanceInvariant.EXECUTION_ID_STABLE,
  ConformanceInvariant.SCHEMA_VERSION_CONSISTENT,
  ConformanceInvariant.TIMESTAMPS_VALID_MONOTONIC,
  ConformanceInvariant.SEQUENCE_MONOTONIC,
  ConformanceInvariant.SEQUENCE_CONTIGUOUS,
  ConformanceInvariant.SEQUENCE_NO_DUPLICATES,
  ConformanceInvariant.NO_DUPLICATE_EVENTS,
  ConformanceInvariant.EXACTLY_ONE_TERMINAL,
  ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL,
  ConformanceInvariant.PARTIAL_EVIDENCE_PRESERVED,
  ConformanceInvariant.ERRORS_NORMALIZED,
  ConformanceInvariant.AUTH_STATES_WELL_FORMED,
  ConformanceInvariant.QUOTA_STATES_WELL_FORMED,
  ConformanceInvariant.OUTPUT_LIMITS_ENFORCED,
  ConformanceInvariant.NO_SECRET_LEAKAGE,
  ConformanceInvariant.EVENT_SCHEMA_VALID,
  ConformanceInvariant.EVENT_TYPE_KNOWN,
  ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY,
  ConformanceInvariant.CANCELLATION_STOPS_EMISSION,
  ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL,
  ConformanceInvariant.WITHIN_EVENT_BUDGET,
  ConformanceInvariant.CANCEL_IDEMPOTENT,
  ConformanceInvariant.ADAPTER_NO_THROW,
  ConformanceInvariant.ADAPTER_LIVENESS
];
