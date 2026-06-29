# Provider Mocks, Adapter Harness and Quota Manager Spec

**Milestone:** A2 — Mocks, Harness and Quota Manager (mandate §14: A2.1 + A2.2 + A2.3)
**Status (this PR):** A2.1 **implemented** in `apps/api/src/providers/mock`
(deterministic scenario engine + `MockCodexAdapter`/`MockClaudeAdapter` + the
35-scenario catalog + direct tests). A2.2 (adapter harness) and A2.3 (quota
manager) are **specified here, not yet implemented** — later PRs build to this
spec. No real CLIs, no network, no credentials, no writes; the runtime stays
mock-only and is **not** wired to execute these adapters.
**Related:** `docs/specs/PROVIDER_CONTRACTS_SPEC.md` (A1, ADR 0033),
`docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` (A0.5, ADR 0032),
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` (ADR 0027),
`docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md` (ADR 0028/0029),
`docs/specs/SAFE_EXECUTION_POLICY_SPEC.md` (ADR 0011),
`docs/specs/HARNESS_ENGINEERING_SPEC.md`,
`docs/context/TRIFORGE_PROJECT_VISION.md` §11, §12, §14, §16,
`docs/instrucciones.md` §14.

A2 turns the A1 contracts from shapes into a **testable runtime**. It provides
provider doubles whose event streams are exactly reproducible, a black-box
harness that proves any adapter (mock now, real in A3) obeys the contract, and a
quota manager that governs scarce subscription budgets — so that all of
TriForge's orchestration can be exercised **without ever invoking a real Codex or
Claude CLI** (mandate §14 "Cierre de A2"; Vision §14 "harness before trust").

### Evidence classification

Reusing the A0.5 tag set:

- `VERIFIED_FROM_REPOSITORY` — confirmed by reading this repository's code/config.
- `DECIDED` — an architectural decision recorded by this milestone.
- `PLANNED` — named future work (A2.2/A2.3 or later); does **not** exist today.
- `REQUIRES_VERIFICATION` — must be confirmed against an installed CLI version
  before relied on (A3).
- `UNKNOWN` — deliberately left open.

> **Standing caveat (`VERIFIED_FROM_REPOSITORY`).** Only A2.1 is implemented.
> Every A2.2/A2.3 control in this document is `PLANNED` and must never be
> described or relied on as existing until its PR lands.

---

## 1. Objective and Scope

### 1.1 Objective

Make the provider boundary verifiable before any real provider runs:

- **A2.1 (this PR):** a deterministic scenario engine and two mock adapters that
  emit the normalized A1 `ProviderEvent` stream — both conformant and
  deliberately contract-violating — so downstream code can be developed and
  tested against realistic, reproducible provider behaviour.
- **A2.2 (`PLANNED`):** a black-box **adapter harness** that consumes any
  `ProviderAdapter` and asserts the contract invariants (ordering, single
  terminal, cancellation, timeout, no secret leakage, malformed handling…).
- **A2.3 (`PLANNED`):** a **quota manager** that governs per-provider budgets,
  reservations, warnings, hard stops and the unknown/rate-limited states defined
  by the quota spec.

### 1.2 Scope

| Sub-part | In scope | PR |
|---|---|---|
| A2.1 | Scenario engine, injectable clock, `MockCodexAdapter`, `MockClaudeAdapter`, the 35-scenario catalog, `deriveProviderResult`, direct unit tests | **this PR** |
| A2.2 | Black-box harness module + invariant assertions over an `AsyncIterable<ProviderEvent>` | `PLANNED` |
| A2.3 | Quota manager (budgets/reservations/accounting) per `QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` | `PLANNED` |

### 1.3 Non-Goals (`DECIDED`)

A2 does **not**:

- run any real CLI, open any network socket, read or write any credential, or
  read secret env vars — everything is pure and deterministic;
- write outside controlled in-memory/temp fixtures;
- perform adaptive routing or owner selection (A4/A6);
- authorize writable execution — A2 emits *events that describe* writes (e.g. a
  `file.changed`) but performs none; writable execution remains unauthorized
  until the A0.5 controls land (mandate §17, ADR 0032 — the A0.5 writable-
  execution gate; ADR 0031 is autonomous-loop governance, a separate concern);
- add or change dependencies, the lockfile, the database schema, endpoints or CI;
- freeze any schema against a real CLI — the mocks model the A1 contract, which
  remains a versioned assumption until A3 verifies it
  (`REQUIRES_VERIFICATION`).

---

## 2. Architecture (`DECIDED`)

```text
ScenarioDefinition            EngineContext (per execute)
(declarative steps)     ┌── executionId, provider, injected Clock,
        │               │    cancelState, timeoutMs, maxOutputBytes
        ▼               ▼
   ┌──────────────────────────┐   fills the A1 envelope, applies overrides/
   │  Scenario engine          │   mutators, observes cancel/timeout/output
   │  runScenario(scn, ctx)    │   budget — FAITHFUL REPLAYER, no repair
   └────────────┬─────────────┘
                │ AsyncIterable<ProviderEvent>  (pull-based, lazy)
                ▼
   ┌──────────────────────────┐   provider id + capability/probe fixtures
   │ Mock adapter              │   (the ONLY per-provider difference)
   │ Mock{Codex,Claude}Adapter │   execute / cancel / checkAvailability /
   │  implements ProviderAdapter│  checkAuthentication / getCapabilities
   └────────────┬─────────────┘
                │ AsyncIterable<ProviderEvent>  (the adapter's sole output;
                │   results are DERIVED from this stream, not returned by it)
                ▼
   ┌──────────────────────────┐   verifies invariants as a BLACK BOX
   │ Adapter harness (A2.2)    │   (same harness will validate A3 real adapters)
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐   budgets, reservations, accounting,
   │ Quota manager (A2.3)      │   warnings, hard stops, unknown/rate-limit
   └──────────────────────────┘
```

Key boundary: the engine **replays faithfully** and never silently repairs a
violation (`VERIFIED_FROM_REPOSITORY` — `scenarioEngine.ts`). Detecting and
normalizing violations is the harness's job (A2.2) and, for real streams, the
normalizer's (A3.3). This separation is what lets A2.1 produce the adversarial
inputs the harness must catch.

**`getResult()` is a mock convenience, not adapter output.**
`BaseMockAdapter.getResult(executionId)` is a helper for A2.1's own unit tests
(it derives a `ProviderResult` from the events it recorded). It is **not** part
of the A1 `ProviderAdapter` interface, and real A3 adapters do not provide it.
An adapter's only contractual output is the `AsyncIterable<ProviderEvent>`
stream; the structured terminal result is always **derived** from that stream by
the exported `deriveProviderResult(events, meta)`. A2.2 and A3 MUST derive
results via `deriveProviderResult` (over the events they observe), never by
calling `adapter.getResult`.

### 2.1 A2.1 file map (`VERIFIED_FROM_REPOSITORY`)

- `apps/api/src/providers/mock/clock.ts` — `Clock` interface + `ManualClock`.
- `apps/api/src/providers/mock/scenarioEngine.ts` — step types,
  `runScenario`, `deriveProviderResult`, `makeEvidenceRef`, `payloadByteLength`.
- `apps/api/src/providers/mock/scenarios.ts` — `createScenarioCatalog`,
  `SCENARIO_IDS`, conformant/violating id lists, fake-secret constant.
- `apps/api/src/providers/mock/mockAdapter.ts` — `BaseMockAdapter`,
  `MockCodexAdapter`, `MockClaudeAdapter`, capability fixtures.
- `apps/api/src/providers/mock/index.ts` — public surface.
- `apps/api/src/test/scenarioEngine.test.ts`,
  `apps/api/src/test/mockProviders.test.ts` — direct tests (pure, no DB).

---

## 3. Determinism Model (`DECIDED`, A2.1)

The mandate forbids `Date.now()`/`Math.random()` and real sleeps on production
paths and requires exactly-reproducible event order. A2.1 achieves this:

- **Injectable clock.** Every timestamp comes from an injected `Clock`.
  `ManualClock` starts at a frozen epoch (`2026-01-01T00:00:00.000Z`, a literal
  parse — never `Date.now()`) and only moves when the engine calls
  `advance(ms)`. Two runs of one scenario produce byte-identical timestamps.
- **Controllable scheduler.** The engine is a **pull-based async generator**.
  There is no timer and no real sleep: the consumer drives pacing by pulling the
  iterator, so tests are never timing- or speed-sensitive. "Time passing" is
  modelled by `delay` steps that advance the clock.
- **Predictable ids.** `sequenceNumber` is a monotonic counter from 0;
  `rawEvidenceRef` is derived as `evidence://{executionId}/{sequence}.jsonl` (a
  fake, non-secret pointer); payload ids (`toolCallId`, `approvalId`, …) are
  fixed strings in the fixtures. Nothing is random.
- **Provider-parameterised fixtures.** A scenario is built per provider so the
  same id runs through both adapters and yields an identical event *shape* (only
  the provider identity and inherited quota-flavor vocabulary differ). This is
  asserted in `mockProviders.test.ts`.

`DEFAULT_TICK_MS = 1000`: each emitted event advances the clock one tick before
stamping, giving strictly increasing timestamps.

---

## 4. Lifecycle and Temporal Model

- A run is the ordered emission of `ProviderEvent`s for one `executionId`,
  terminated (in a conformant run) by exactly one terminal event.
- A conformant run begins with `run.started` **when it actually starts**;
  pre-start failures (auth required/expired, provider unavailable, cancellation
  before start) legitimately omit `run.started` and carry a normalized terminal
  instead.
- Temporal ordering is the sequence-number order, which equals emission order in
  a conformant run. Timestamps are non-decreasing and derived from the clock.
- `delay` steps advance the clock without emitting; they exist to drive the
  timeout check deterministically.

---

## 5. Events

A2.1 emits the A1 13-event discriminated union verbatim (`run.started`,
`authentication.updated`, `agent.message`, `plan.updated`, `tool.started`,
`tool.completed`, `file.changed`, `usage.updated`, `quota.updated`,
`approval.requested`, `warning.raised`, `run.failed`, `run.completed`) with the
common envelope (`schemaVersion` = `PROVIDER_CONTRACT_SCHEMA_VERSION`,
`executionId`, `provider`, `sequenceNumber`, `timestamp`, `rawEvidenceRef`,
`type`, `payload`). Terminal semantics follow A1: `run.failed | run.completed`
are terminal; `isTerminalEvent`/`TERMINAL_EVENT_TYPES` express it. The engine
does **not** enforce single-terminal — that is verified by the harness (A2.2).

---

## 6. Errors

Terminals use the A1 error taxonomy (`provider_unavailable`,
`authentication_required`, `authentication_expired`, `timeout`, `cancelled`,
`quota_exhausted`, `rate_limited`, `malformed_event`, `duplicate_event`,
`sequence_gap`, `process_crashed`, `output_limit_exceeded`, `unknown`).

The synthetic terminals the engine generates are `cancelled`, `timeout` and
`output_limit_exceeded`. Conditions with **no dedicated code** —
unsupported/drifted CLI version and orchestration-budget exhaustion (wall-time,
max turns, max repair loops) — are modelled as terminal `unknown` plus a
`warning.raised` carrying a descriptive code, never a fabricated code (mandate
§4.5). `deriveProviderResult` maps the first terminal to a
`ProviderResult.status` (`completed` | `failed` | `cancelled`).

---

## 7. Cancellation (`DECIDED`, A2.1)

- `adapter.cancel(executionId)` flips a shared `cancelState.requested` flag. The
  engine observes it **at the next step boundary** (mandate wording) and, for a
  well-behaved scenario, emits exactly one `run.failed{cancelled}` terminal and
  stops — dropping any remaining scripted steps.
- A scenario may also carry an internal `cancel` step so it is self-contained
  and reproducible without external orchestration (used by
  `cancellationBeforeStart` / `cancellationDuringStream`).
- A violation scenario can set `ignoresCancellation` to model a misbehaving
  adapter that keeps emitting after cancellation (orphan-like;
  `continuedEmissionAfterCancellation`). The harness (A2.2) must detect this.

---

## 8. Timeout (`DECIDED`, A2.1)

The engine compares elapsed **clock** time (not wall time) against the request
`timeoutMs` at each step boundary; once exceeded it emits a single
`run.failed{timeout}` and stops. The `timeout` scenario advances the clock with a
`delay` larger than any sane budget so the check fires deterministically.

---

## 9. Output Limits (`DECIDED`, A2.1)

When the request carries `maxOutputBytes`, the engine accumulates the UTF-8 byte
length of each event payload; on exceeding the budget it emits the offending
event faithfully and then a `run.failed{output_limit_exceeded}` terminal. The
`oversizedOutput` scenario (a ~70 KB `agent.message`) exercises the output-flood
threat (T-EXE-13/14). With no budget set, enforcement is off (the default).

---

## 10. Scenario Catalog (A2.1, `VERIFIED_FROM_REPOSITORY`)

35 named fixtures, built by `createScenarioCatalog(provider)`. "C/V" = conformant
(schema-valid, protocol-honouring; a well-formed *failure* is still C) vs
violating (a deliberate contract defect for the harness to catch). "Threats"
references the A0.5 catalog the scenario lets A2.2/A3 exercise.

These 35 are the *implemented catalog*, not a literal mandate quota: they **cover
and exceed** the mandate's ~19 enumerated A2.1 scenarios (instrucciones.md §14 —
success, auth required/expired, timeout, cancellation, crash, partial output,
malformed/duplicate/sequence-gap, quota warning/exhausted, rate limit, tool use,
file change, structured result, reviewer write attempt, orphan-process
simulation, output flood). The extra entries (e.g. unknown event, out-of-order,
duplicate/missing terminal, post-terminal emission, secret-like payload, the
orchestration-budget cases) broaden harness coverage of the A1 contract and the
A0.5 threat set.

| # | id | C/V | Emits / how modelled | Threats |
|---|---|---|---|---|
| 1 | success | C | started→auth→messages→plan→usage→completed | — |
| 2 | authenticationRequired | C | auth.updated{required} + failed{authentication_required}; probe auth=required | T-CMP-02 |
| 3 | authenticationExpired | C | auth.updated{expired} + failed{authentication_expired}; probe auth=expired | T-CMP-02 |
| 4 | unavailableProvider | C | failed{provider_unavailable}; probe availability=unavailable | T-GIT-10 |
| 5 | unsupportedVersion | C | warning{unsupported_cli_version} + failed{unknown}; probe cliVersion + unknown caps (no dedicated code) | T-GIT-10, T-CMP-02 |
| 6 | timeout | C | started + delay>budget → synthetic failed{timeout} | T-EXE-05 |
| 7 | cancellationBeforeStart | C | cancel flag before any emit → only failed{cancelled} | T-EXE-03/04 |
| 8 | cancellationDuringStream | C | started→message→cancel → failed{cancelled}, rest dropped | T-EXE-03/04 |
| 9 | providerCrash | C | started→message→failed{process_crashed, partial} | T-EXE-04 |
| 10 | partialRun | C | started→message→tool.started→failed{unknown, partial} (partial evidence) | T-EXE-13 |
| 11 | malformedEvent | **V** | agent.message with non-string `text` (mutator); schema-invalid | T-INJ-12, T-EXE-14 |
| 12 | unknownEvent | **V** | discriminator `diagnostic.note` outside the union | T-INJ-12 |
| 13 | duplicateSequenceNumber | **V** | two events share sequence 1 | T-INJ-12 |
| 14 | sequenceGap | **V** | sequence jumps 0→5→6 | T-INJ-12 |
| 15 | outOfOrderEvent | **V** | sequence 2 after sequence 3 | T-INJ-12 |
| 16 | duplicateTerminalEvent | **V** | two `run.completed` terminals | T-INJ-12 (A-21) |
| 17 | missingTerminalEvent | **V** | stream ends with no terminal; `deriveProviderResult`→null | T-INJ-12 |
| 18 | rateLimited | C | quota.updated{rate_limited} + failed{rate_limited} | T-EXE-08 |
| 19 | quotaWarning | C | quota.updated{warning, util 0.82} + completed | T-EXE-06/07 |
| 20 | quotaExhausted | C | quota.updated{exhausted, flavor} + failed{quota_exhausted} | T-EXE-06/07/08 |
| 21 | quotaUnknown | C | quota.updated{unknown/unknown/unknown} (never fabricated) | T-INJ-12 |
| 22 | usageUpdate | C | usage.updated (isBillingAuthoritative=false) | — |
| 23 | toolUse | C | matched tool.started / tool.completed | — |
| 24 | fileChange | C | writable run (readOnly=false) emits file.changed | — |
| 25 | approvalRequest | C | approval.requested{high} | — |
| 26 | warning | C | non-fatal warning.raised | — |
| 27 | structuredResult | C | plan+tools+file+usage→completed; feeds ProviderResult | T-INJ-11 |
| 28 | oversizedOutput | C | ~70 KB agent.message; with budget → output_limit_exceeded | T-EXE-13/14 |
| 29 | secretLikePayload | **V** | message carries a FAKE AWS example key (redaction target) | T-EXE-10, T-CMP-09 |
| 30 | reviewerWriteAttempt | **V** | read-only run emits file.changed (unauthorized write) | T-INT-14 |
| 31 | continuedEmissionAfterCancellation | **V** | ignores cancel, keeps emitting (orphan-like) | T-EXE-03/04 |
| 32 | cleanupFailure | **V** | warning.raised AFTER the terminal (post-terminal) | T-INJ-12, T-EXE-04 |
| 33 | wallTimeExhaustion | C | usage + warning{wall_time_exhausted} + failed{unknown} (orchestration) | T-EXE-05/06 |
| 34 | maxTurnExhaustion | C | usage{turns:12} + warning{max_turns_exhausted} + failed{unknown} (orchestration) | T-EXE-06 |
| 35 | maxRepairLoopExhaustion | C | warning{max_repair_loops_exhausted} + failed{unknown} (orchestration) | T-EXE-06 |

Totals: 24 conformant, 11 violating.

**Threat-coverage of the A0.5 "must be able to produce" set:** secret-like
payload (#29), output flood (#28), malformed events (#11/#12), post-terminal
emission (#31/#32), reviewer write attempt (#30), sequence manipulation
(#13–#16), and **spoofed identity** — produced by the engine's `providerOverride`
step field and exercised directly in `scenarioEngine.test.ts` (an event whose
`provider` differs from the engine context). Mapping to mandate §14's named A2.1
list: "output flood" ≈ #28; "orphan process simulation" ≈ #31 + #32 (an orphan
keeps emitting after the run should have ended).

---

## 11. Quota Manager Contract (A2.3, `PLANNED`)

Defers implementation to a later PR; the **contract** it must satisfy (from
`QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md`, ADR 0027) is fixed here:

- **Per-provider budgets** (not one universal counter): Claude
  (`maxInvocations`, `maxTurnsPerInvocation`, optional `maxEstimatedCostUsd`,
  `stopOnQuotaWarning`, `allowUsageCredits:false`) and Codex (`maxInvocations`,
  `maxReasoningHeavyRuns`, `stopWhenWindowLow`, `allowPurchasedCredits:false`),
  plus shared `maxRepairRounds`, `maxWallTimeMs`, `reserveForImplementation`,
  `reserveForReview`, optional `reserveForRepair`.
- **Reservations** for implementation and review checked **before** each
  capacity-consuming transition (planning must not starve them).
- **Commit / release** accounting: a reservation is committed on use or released
  on completion/abort; consumed + reserved must never exceed the budget.
- **States**: warning, hard-stop on exhaustion, `rate_limited`, and `unknown`
  (never fabricated). Limits on max turns, max repair loops and max wall time.
- **Manual resume** only; **no paid fallback** and **no API-key fallback**
  (`allow*Credits:false`; mandate §3.3). Exhaustion stops the run; it never
  silently crosses to paid capacity.
- **Accounting invariants**: estimates are client-side
  (`isBillingAuthoritative:false`); absent fields stay absent; provenance
  (`source`) weights confidence; an `unknown` source is never authoritative.

A2.3 is exercised with the quota scenarios (#18–#21, #33–#35) so the whole quota
lifecycle is testable without a real provider.

---

## 12. Harness Invariants (A2.2, `PLANNED`)

The black-box harness consumes any `ProviderAdapter` (mocks now, A3 real
adapters later) and must verify, treating the adapter as opaque:

1. first lifecycle event is `run.started` for runs that actually start;
2. provider identity on every event matches the adapter (catches spoofed
   identity);
3. stable `executionId` across the stream;
4. correct `schemaVersion` on every event;
5. valid, non-decreasing ISO timestamps;
6. strictly monotonic, contiguous `sequenceNumber` (flags duplicates and gaps);
7. no duplicate events;
8. exactly one terminal event;
9. no events after the terminal (post-terminal/orphan detection);
10. cancellation produces a single `cancelled` terminal and stops emission;
11. timeout produces a single `timeout` terminal;
12. partial evidence is preserved on early termination;
13. errors are normalized to the A1 taxonomy;
14. auth and quota states surface correctly;
15. output limits are enforced;
16. no secret leakage in any payload or evidence ref (the fake-secret scenario
    is the redaction test fixture);
17. malformed / unknown events are rejected or quarantined, never trusted;
18. cleanup occurs and `cancel()` is idempotent.

A2.1 deliberately ships the inputs (conformant + violating scenarios) that make
each of these assertions falsifiable.

### 12.1 A3-gate hardening (`DECIDED`)

Because the SAME harness is the gate for the A3 REAL read-only Codex/Claude
adapters ("harness before trust"), several invariants are tightened so the
harness is correct against an untrusted, real, possibly-hanging adapter — not
just against the cooperative mocks:

- **Read-only authority is the REQUEST, never the adapter payload.** The
  `NO_WRITE_UNDER_READ_ONLY` (T-INT-14) check reads `request.readOnly` (the
  orchestrator's authoritative input), NOT `run.started.readOnly` (which the
  adapter emits and could spoof). Under `request.readOnly === true` ANY
  `file.changed` fails the invariant, regardless of payload; additionally, a
  `run.started.readOnly` that diverges from `request.readOnly` is itself a defect
  (the adapter must reflect the input it was given). This closes a false-pass
  where a write is laundered by claiming `readOnly:false` in the payload.
- **Cancellation tolerates a bounded in-flight drain.** A real adapter cannot
  stop instantly, so `CANCELLATION_STOPS_EMISSION` allows up to
  `cancelDrainAllowance` (default 3) in-flight events after `cancel()` and passes
  when the run then closes in a `cancelled` terminal (cancel honoured) OR a
  `completed` terminal (it finished before cancel took effect — a legitimate
  race). It fails only if emission runs past the allowance with no terminal, or
  events continue after the terminal.
- **Liveness budget for real runs (`REQUIRES_VERIFICATION`).** A black-box
  adapter can hang. An optional `livenessTimeoutMs` races each pull of the event
  stream against a wall-clock timer (the only real timer the harness uses) and,
  on timeout, abandons the wedged stream and fails `ADAPTER_LIVENESS`. It is
  UNDEFINED by default so the deterministic mock tests consume no real time;
  **A3 real-adapter runs MUST set `livenessTimeoutMs`** (a hung CLI must be a
  failure, not a hang).
- **A throwing adapter is a failure, not a crash.** `execute()`/iteration
  throwing is caught and surfaced as `ADAPTER_NO_THROW`; the harness never
  propagates the exception.
- **Output-limit accounting includes content-bearing terminals.**
  `OUTPUT_LIMITS_ENFORCED` counts the payload bytes of every event INCLUDING a
  terminal that carries content (e.g. a huge `run.completed.summary`), EXCEPT the
  synthetic `output_limit_exceeded` terminal itself. Excluding all terminals
  false-passed an adapter that hid its flood in the terminal. The byte base is
  the normalized-JSON payload — an APPROXIMATION of a real adapter's raw stdout
  volume (refined in A3/A9; see §15).
- **Secret scan: specific shapes hard-fail, generic entropy warns.** Specific
  credential SHAPES (AWS key id, PEM block, JWT, prefixed provider key, Slack
  token) hard-fail `NO_SECRET_LEAKAGE`. The generic high-entropy heuristic is
  DOWNGRADED to a non-failing warning (`entropyFindings` on the report): a real
  read-only reviewer legitimately cites base64 blobs and content hashes, so an
  entropy hit must not false-fail conformance. The fake-secret fixture still
  hard-fails via the AWS shape, not via entropy.
- **Content-before-start is illegitimate.** `FIRST_EVENT_VALID` treats a content
  event (`agent.message`/`plan.updated`/`tool.*`/`file.changed`) — or a
  `run.completed` — with no preceding `run.started` as a failure. A legitimate
  pre-start failure carries only status events plus a normalized `run.failed`
  terminal.
- **Partial-evidence counts only real output.** `PARTIAL_EVIDENCE_PRESERVED`
  counts only OUTPUT events (`agent.message`/`tool.*`/`file.changed`/
  `plan.updated`) as partial work; status events
  (`quota.updated`/`warning.raised`/`authentication.updated`/`usage.updated`) do
  not force `partial=true`.

**Known coverage limits (`REQUIRES_VERIFICATION` / limitations).** The secret
scan does not flag hex-encoded secrets (they fall below the alnum-run entropy
threshold) and the entropy heuristic is advisory only; the harness does not
assert semantic quota coherence (e.g. that a reported utilization is consistent
with a later `quota_exhausted`) — only that quota/auth payloads are well-formed.
These are deferred to A3 (real-CLI reconciliation) and the redaction control
(A4/A5).

---

## 13. Invariants (A2 overall, `DECIDED`)

- The engine never invokes a real CLI, network, credential store or filesystem
  write; it is pure given its inputs and clock.
- The engine is a faithful replayer: it never silently repairs a scripted
  violation.
- Determinism: identical scenario + identical clock ⇒ byte-identical stream.
- The only per-provider difference is identity (id, capability/probe fixtures,
  inherited quota-flavor vocabulary). No other per-provider branching exists
  (preserves the A1 provider-agnostic boundary, ADR 0033).
- A2 introduces no dependency, lockfile, schema, endpoint or CI change.

---

## 14. Acceptance Criteria

**A2.1 (this PR) — closed when:**

- the scenario engine, both adapters and all 35 named scenarios are implemented
  and exported from `apps/api/src/providers/mock`;
- every conformant scenario is schema-valid, single-terminal and contiguous in
  sequence; every violating scenario reproduces exactly its named defect and the
  engine does not repair it;
- determinism holds (a scenario replays byte-identically) and the same scenario
  through both adapters yields an identical event shape with correct identity;
- both adapters satisfy the `ProviderAdapter` interface (compile-time + runtime);
- cancellation, timeout and output-limit behaviours are covered;
- the secret-like fixture carries a clearly-FAKE example key, never a real
  secret;
- `corepack pnpm --filter @triforge/shared build`, `corepack pnpm typecheck`,
  the two new test files, `corepack pnpm lint:deps` and `corepack pnpm build`
  all pass; `pnpm-lock.yaml` is unchanged.

**A2.2 (`PLANNED`) — closed when** the harness verifies §12 against both mock
adapters (and is ready to validate A3 real adapters unchanged).

**A2.3 (`PLANNED`) — closed when** the quota manager satisfies §11 and the quota
scenarios drive its full lifecycle.

**A2 (mandate §14 closure) — closed when** all of TriForge's provider
orchestration can be tested without executing a real Codex or Claude.

---

## 15. Failure Modes

- **A scenario drifts from the real CLI behaviour** (`REQUIRES_VERIFICATION`):
  the mocks model the A1 contract, not a verified CLI. A3 smoke tests reconcile
  the contract against installed versions; mismatches feed back as contract or
  scenario fixes.
- **A new event type or error code is added to A1** but not to the catalog: the
  catalog and harness must be extended in the same change (caught by the
  "all 13 event types" and scenario-count tests).
- **A consumer relies on the engine to enforce protocol** (e.g. single
  terminal): by design it does not — enforcement is the harness's job.
- **Output-limit accounting underestimates real byte cost**: the mock measures
  JSON payload bytes, an approximation of real stdout volume; A3/A9 refine.

---

## 16. Relation to A1, A3 and A0.5

- **A1 (implements):** A2.1 is the first concrete implementation of the
  `ProviderAdapter` interface and the `ProviderEvent`/`ProviderResult`/
  `CapabilitySnapshot` contracts; it imports them from `@triforge/shared` and
  adds no provider logic to the contract layer.
- **A3 (same harness):** the A2.2 harness is written against the
  `ProviderAdapter` boundary, so it validates the A3 real read-only Codex/Claude
  adapters with no change — "harness before trust" (Vision §4.3/§14).
- **A0.5 (threats exercised):** the violating and resource scenarios are the
  executable inputs for the threat model's planned controls — falsified events
  (T-INJ-12), forged structured result (T-INJ-11), reviewer write attempt
  (T-INT-14), output flood (T-EXE-13/14), secret leakage (T-EXE-10/T-CMP-09),
  orphan/post-terminal emission (T-EXE-03/04), quota exhaustion
  (T-EXE-06/07/08) and spoofed identity. A2 emits these so A2.2/A4/A5 can prove
  they are caught.
