# Quota Aware Provider Orchestration Spec

## Purpose

TriForge Agentic Lab is being reoriented as a local, multi-agent software
engineering environment that coordinates official provider CLIs, initially
OpenAI Codex CLI and Anthropic Claude Code, each authenticated locally with the
user's own account and subscription. The initial flow uses no API keys and no
additional paid credits.

In this environment a provider invocation is a scarce resource. Provider quotas
are not equivalent across vendors, are partially opaque, can change over time,
and can share capacity with the user's own interactive use of the same
subscription. Quota is therefore a central runtime constraint, not a secondary
metric, and it must not be modelled as a single universal counter.

Milestone A0.1 defines the documentation for how TriForge represents
heterogeneous budgets, records estimated usage, processes quota events, reserves
capacity for implementation and review, selects collaboration modes, degrades
routing, stops on exhaustion, distinguishes authoritative data from estimates,
and exercises these scenarios through mock adapters. This milestone is
documentation only. It does not add code, tests, migrations, endpoints, runtime
integration, dashboard changes or any provider adapter.

The conceptual contracts in this document use `ts` blocks for readability. These
types are conceptual. This milestone does not define a database schema, a Zod
contract in `packages/shared`, a JSON contract or an API response shape. The
matching architecture decision is recorded in
`docs/adr/0027-quota-aware-provider-orchestration.md`.

## Goals

- Avoid exhausting provider quota during planning.
- Reserve capacity for implementation before planning consumes the run budget.
- Reserve capacity for review before planning or repair consumes the run budget.
- Stop runs before they exceed configured budgets.
- Distinguish a quota warning from a rate limit from full exhaustion.
- Allow explicit, visible degraded routing instead of silent substitution.
- Keep traceability of estimated provider usage for governance.
- Function correctly when individual fields are unknown, without inventing them.

## Non-Goals

Milestone A0.1 does not include:

- a real Codex integration,
- a real Claude integration,
- a `ProviderAdapter` implementation or any concrete adapter,
- implemented mock adapters,
- process execution or subprocess management,
- reading real JSONL or other provider event streams,
- API keys,
- automatic purchased credits,
- automatic usage credits,
- billing or authoritative cost accounting,
- exact prediction of remaining quota,
- scraping of provider web pages or dashboards,
- fragile parsing of human-readable provider messages as authoritative data,
- bypassing provider limits,
- automatic background waiting for quota resets,
- runtime, database, endpoint or dashboard changes.

## Provider Budget Model

TriForge represents budgets per provider, because provider usage models and
quota signals are not equivalent. The budget is a local governance policy. It is
not provider billing and it does not represent an authoritative balance.

```ts
type ProviderRunBudget = {
  claude: {
    maxInvocations: number;
    maxTurnsPerInvocation: number;
    maxEstimatedCostUsd?: number;
    stopOnQuotaWarning: boolean;
    allowUsageCredits: false;
  };

  codex: {
    maxInvocations: number;
    maxReasoningHeavyRuns: number;
    preferredModel?: string;
    stopWhenWindowLow: boolean;
    allowPurchasedCredits: false;
  };

  shared: {
    maxRepairRounds: number;
    maxWallTimeMs: number;
    reserveForImplementation: number;
    reserveForReview: number;
    reserveForRepair?: number;
  };
};
```

Clarifications:

- Not every field is available for every provider. Fields that a provider does
  not expose must remain absent rather than be filled with invented values.
- `maxEstimatedCostUsd` is an optional local policy ceiling based on client-side
  estimates. It is not billing, it is not an authoritative balance, and it does
  not represent any fixed dollar pool granted by a provider.
- There is no fixed Claude dollar pool assumed by this model. The Anthropic
  change that would have created a separate monthly programmatic pool was paused
  (see `External Fact Verification`), so TriForge must not assume a separate
  active programmatic budget for Claude.
- `allowUsageCredits` and `allowPurchasedCredits` are fixed to `false` in the
  initial flow. The initial flow never spends credits and never falls back to an
  API key.
- The `shared` reserves (`reserveForImplementation`, `reserveForReview`, and the
  optional `reserveForRepair`) must be checked before each runtime transition
  that would consume provider capacity.
- This conceptual `ProviderRunBudget` is intentionally distinct from the
  existing `RunBudget` (`maxSteps`, `maxFailures`) exported from
  `packages/shared` for the ADR 0010 per-run step and failure budget. It is a
  superset governance concept; any later reconciliation of the two is deferred
  to the implementation milestone and is not performed here.
- Budgets are configured per repository. Numeric limits shown anywhere in this
  document are illustrative placeholders, not canonical constants.

## Usage Observation

TriForge records estimated provider usage for governance. Estimates are
client-side and are never presented as exact charges.

```ts
type ProviderUsageEstimate = {
  provider: "claude" | "codex";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  turns?: number;
  invocations?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  reasoningIntensity?: "light" | "medium" | "heavy" | "unknown";
  source:
    | "provider_event"
    | "cli_status"
    | "local_estimate"
    | "unknown";
  isBillingAuthoritative: false;
};
```

Rules:

- Estimates exist to govern routing and reservation, not to bill the user.
- `estimatedCostUsd` and equivalent fields, including any provider-reported
  `total_cost_usd`, are treated as client-side estimates, never as authoritative
  billing.
- Missing data stays missing. Absent fields must not be back-filled with
  invented numbers, averages or guesses.
- `isBillingAuthoritative` is fixed to `false`.
- `source` records provenance so consumers can weight confidence. A
  `local_estimate` is weaker than a `provider_event`. An `unknown` source must
  not be treated as authoritative.

## Quota Event Model

Quota signals are normalized into a single event shape so the runtime can reason
about heterogeneous providers uniformly. The normalization never fabricates a
remaining percentage.

```ts
type ProviderQuotaEvent = {
  provider: "claude" | "codex";
  status:
    | "available"
    | "warning"
    | "rate_limited"
    | "exhausted"
    | "unknown";
  window:
    | "five_hour"
    | "seven_day"
    | "model_specific"
    | "credits"
    | "unknown";
  utilization?: number;
  resetsAt?: string;
  rawProviderType?: string;
  source:
    | "provider_event"
    | "cli_status"
    | "adapter_inference"
    | "unknown";
};
```

Rules:

- `adapter_inference` is lower confidence than `provider_event` and `cli_status`
  and must not be promoted to an authoritative signal.
- Unstable human-readable text must never be parsed as authoritative data
  without a capability and version check against the installed provider CLI.
- If a signal cannot be verified against the installed provider version, the
  adapter reports `status: "unknown"` and `window: "unknown"` rather than
  guessing.
- `utilization` is populated only when the provider exposes it through a
  structured, reliable interface. TriForge never invents a remaining
  percentage.
- `rawProviderType` preserves the original provider classification for audit.
  The raw payload is retained safely for audit, with secrets and credentials
  excluded.
- A Codex weekly window normalizes to `window: "seven_day"`. The matching
  `codex_weekly` exhaustion flavor preserves the provider's native terminology,
  while the normalized `window` value keeps both providers comparable. The exact
  Codex window duration is REQUIRES_REVERIFICATION and may not be exactly seven
  days.
- `ProviderQuotaEvent` models quota status only. Provider authentication and
  reachability are not quota statuses and are not encoded in `status`; they are
  surfaced through a separate adapter availability and authentication signal and
  map to the `PROVIDER_AUTHENTICATION_REQUIRED` and `PROVIDER_UNAVAILABLE`
  condition codes.

## Runtime States and Condition Codes

The orchestration introduces normalized quota and budget condition codes. To
stay consistent with the existing runtime state machine (ADR 0010), these are
expressed as `UPPER_SNAKE_CASE` condition and reason codes, in the same family
as the existing `ACTION_BLOCKED`, `APPROVAL_REJECTED` and `APPROVAL_EXPIRED`
codes. They are not new lifecycle states by themselves; the `Mapping to the
existing runtime state machine` subsection defines how each resolves onto the
existing lowercase `agent_runs` lifecycle.

```text
PROVIDER_AUTHENTICATION_REQUIRED
PROVIDER_QUOTA_WARNING
PROVIDER_QUOTA_EXHAUSTED
PROVIDER_RATE_LIMITED
PROVIDER_USAGE_CREDITS_REQUIRED
PROVIDER_UNAVAILABLE
PROVIDER_STATUS_UNKNOWN
RUN_BUDGET_EXHAUSTED
RUN_BUDGET_RESERVE_VIOLATION
```

A quota exhaustion condition carries a flavor that records which window or limit
was exhausted, so the operator and the audit trail can distinguish provider and
window without guessing.

```ts
type QuotaExhaustionFlavor =
  | "claude_five_hour"
  | "claude_seven_day"
  | "claude_model_specific"
  | "codex_five_hour"
  | "codex_weekly"
  | "credits"
  | "unknown";
```

`monthly_credit_exhausted` is intentionally excluded as an active flavor,
because the Anthropic monthly programmatic pool change was paused. It may be
documented later as a disabled future flavor only if Anthropic officially
reactivates that system and the claim is reverified against the installed
version.

### Mapping to the existing runtime state machine

The condition codes above do not replace the `agent_runs` lifecycle from ADR
0010. Each resolves onto it as follows.

Terminal codes resolve the run to a terminal `stopped` (or `failed`) state with
a new lowercase stop condition, and emit the matching `UPPER_SNAKE_CASE` reason
code in the timeline payload, the same way a blocked action emits
`ACTION_BLOCKED`. The proposed stop conditions are named to match the existing
lowercase `StopConditionSchema` family (`max_steps`, `max_failures`,
`approval_rejected`, `approval_expired`):

- `PROVIDER_AUTHENTICATION_REQUIRED` resolves to stop condition
  `provider_authentication_required`. The run is resumed manually after the
  local CLI session is re-authenticated.
- `PROVIDER_QUOTA_EXHAUSTED` resolves to stop condition
  `provider_quota_exhausted`, carrying the relevant `QuotaExhaustionFlavor`.
- `PROVIDER_USAGE_CREDITS_REQUIRED` resolves to stop condition
  `provider_usage_credits_required`. Under the no-credits policy this is a hard
  stop, because spending credits is forbidden rather than approvable.
- `RUN_BUDGET_EXHAUSTED` resolves to stop condition `run_budget_exhausted`.
- `RUN_BUDGET_RESERVE_VIOLATION` resolves to stop condition
  `run_budget_reserve_violation`, unless the Budget Reservation rules direct the
  run to pause for a human decision first.

Non-terminal and informational codes do not, by themselves, stop the run:

- `PROVIDER_QUOTA_WARNING` is recorded as a timeline event and may influence
  routing and mode selection without halting the run.
- `PROVIDER_RATE_LIMITED` is a transient condition. The run does not silently
  wait in the background; it is paused or stopped explicitly with the reason
  surfaced.
- `PROVIDER_UNAVAILABLE` is treated as transient. For low and medium risk it may
  trigger degraded routing to the alternate provider; otherwise the run is
  paused or stopped explicitly with the reason surfaced, and a critical task
  pauses for a human decision rather than degrading silently.
- `PROVIDER_STATUS_UNKNOWN` is recorded and never coerced into `available`; it
  does not by itself stop the run.

If a run must be observably resumable after a reset, a non-terminal hold may
reuse the existing `waiting_for_approval` pause pattern rather than introducing
an implicit background wait.

The concrete addition of any new lowercase stop condition or lifecycle state to
`AgentRunStatusSchema`, `StopConditionSchema`, the SQL `CHECK` constraints and
the runtime service is out of scope for this documentation milestone and is
deferred to the implementation milestone.

## Hard-Stop Policy

Under the initial policy:

```text
no API keys
no automatic purchased credits
no automatic usage credits
```

When quota is exhausted and no permitted budget remains, the runtime must:

1. stop issuing new provider invocations,
2. preserve partial artifacts already produced,
3. mark the run as explicitly paused or failed, never silently idle,
4. not lose stdout or provider events already received,
5. surface the reason, including the quota exhaustion flavor when known,
6. allow manual resumption after the reset,
7. not wait in the background indefinitely,
8. not automatically switch to an API key or to paid credits.

Exhaustion with no permitted budget is a hard stop. This maps onto the Safe
Execution Policy (ADR 0011): a provider invocation that has no remaining
permitted budget behaves like a blocked action and fails the run with an
explicit reason code, rather than creating an approval gate to spend money the
policy forbids.

## Budget Reservation

Before activating planning, review or repair, the runtime checks reserves. A
reserve is capacity set aside for a later, more critical phase, so that earlier
phases cannot consume the budget that implementation and review depend on.

Example, with illustrative placeholder values:

```text
Planning budget remaining: 2
Reserved implementation calls: 1
Reserved review calls: 1

Result:
No additional planning call allowed.
```

Rules:

- Implementation capacity is reserved before planning is allowed to spend the
  shared budget.
- Review capacity is reserved before planning or repair is allowed to spend the
  shared budget.
- A repair reserve is optional and, when configured, is protected the same way.
- Reserved capacity must not be spent on decorative synthesis, restating prior
  output, or other low-value calls.
- If critical execution cannot be completed within the remaining reserved
  capacity, the run pauses and requests a human decision rather than consuming a
  reserve or degrading silently.
- A reserve violation is reported as `RUN_BUDGET_RESERVE_VIOLATION` and resolves
  to the `run_budget_reserve_violation` stop condition.

## Collaboration Modes

These four collaboration modes are introduced by this spec. They do not yet
exist in the repository; the current debate model in `DEBATE_ENGINE_SPEC.md` is
a single mock round with three mock agents and a highest-confidence judge, and
it is the seed for Full Debate Mode. Mode selection is driven by risk,
uncertainty and available budget.

### Specialist Mode

The economical default. Used for a clear task with low or medium risk: a single
owner implements, performs self-review, and triggers cross-vendor review only
conditionally when risk or uncertainty warrants it. This mode is selected unless
risk, uncertainty or an explicit human opt-in escalates to another mode.

### Pair Mode

Used for a moderately complex task: one provider produces the primary proposal,
the second provider critiques it, then implementation and review follow.

### Full Debate Mode

Used for architecture, security, migrations and high uncertainty. It requires
sufficient budget after implementation and review reserves are protected, and is
not selected when the budget cannot fund the debate plus the reserved phases.

### Competitive Mode

An exceptional mode. It requires a human opt-in, sufficient budget, separate
worktrees per competing owner, high uncertainty, and comparative quality gates.
It is never selected automatically on cost grounds alone.

## Quota-Aware Routing

Routing chooses an owner for a task. Technical capability is considered first;
quota can modify the assignment, but degradation is always explicit.

```ts
type RoutingDecision = {
  preferredOwner: "claude" | "codex";
  assignedOwner: "claude" | "codex";
  capabilityScore: number;
  quotaAvailabilityScore: number;
  historicalPerformanceScore: number;
  risk: "low" | "medium" | "high" | "critical";
  degradedFromPreferredOwner: boolean;
  reason: string[];
  humanApprovalRequired: boolean;
};
```

Rules:

- Technical capability is the primary factor in selecting `preferredOwner`.
- Quota availability and historical performance may change `assignedOwner`, but
  the change sets `degradedFromPreferredOwner: true` and records `reason`.
- Degradation must be visible. A degraded assignment is never silent.
- Low and medium risk tasks may degrade to an alternate provider when the
  preferred owner is unavailable.
- High risk tasks may degrade only with a recorded `reason` and
  `degradedFromPreferredOwner: true`; if the required specialist is unavailable
  and no acceptable alternate exists, the run pauses and sets
  `humanApprovalRequired: true` rather than degrading silently.
- Critical tasks must not silently degrade. If the required specialist is
  unavailable, a critical task pauses and sets `humanApprovalRequired: true`.
- A temporary availability limitation must not permanently invert the
  specialization matrix. Degradation is per-run, not a permanent reassignment.
- `historicalPerformanceScore` is repository-specific.

The selection considers, simultaneously: technical suitability, risk, available
budget, historical performance, and provider availability.

## External Fact Verification

Every provider-dependent claim is recorded as a dated, versioned assumption, so
that an external statement does not become architecture merely because it was
published, looks recent, has a past target date, or was produced confidently by
an AI.

```ts
type ExternalProviderAssumption = {
  id: string;
  provider: "anthropic" | "openai";
  claim: string;
  sourceUrl?: string;
  sourceType: "official" | "secondary" | "local_observation";
  verifiedAt: string;
  verifiedAgainstInstalledVersion: boolean;
  confidence: "high" | "medium" | "low";
  status:
    | "active"
    | "paused"
    | "deprecated"
    | "unverified"
    | "superseded";
  reverifyBeforeImplementation: boolean;
};
```

The following assumptions were recorded from product-owner canonical premises on
2026-06-28. They were not independently verified against the installed provider
CLI versions during this documentation milestone, so each is flagged for
reverification and no source URL is invented. Each is marked
`REQUIRES_REVERIFICATION` until checked against the installed version.

- Anthropic monthly programmatic pool change. The change previously expected on
  2026-06-15, which would have created a separate monthly pool for programmatic
  use, was paused. `claude -p` currently still consumes the normal shared limits
  of the Claude Pro/Max plan. There is no separate active dollar pool TriForge
  can treat as an independent budget. `status: "paused"`,
  `verifiedAgainstInstalledVersion: false`, `reverifyBeforeImplementation: true`.
  REQUIRES_REVERIFICATION.
- Claude bare mode with subscription OAuth. `--bare` is excluded from the
  no-API-key subscription flow, because bare mode does not use the normal OAuth
  subscription authentication. `status: "active"` (as a design exclusion),
  `verifiedAgainstInstalledVersion: false`, `reverifyBeforeImplementation: true`.
  REQUIRES_REVERIFICATION.
- Codex usage windows and ranges. Codex limits are window-based and partially
  opaque. Any specific ranges are temporary and subject to reverification.
  `status: "unverified"`, `verifiedAgainstInstalledVersion: false`,
  `reverifyBeforeImplementation: true`. REQUIRES_REVERIFICATION.
- Provider event schemas. The structured event and status schemas for each CLI
  must be verified against the installed version before adapters are frozen.
  `status: "unverified"`, `verifiedAgainstInstalledVersion: false`,
  `reverifyBeforeImplementation: true`. REQUIRES_REVERIFICATION.

Temporal or provider-dependent claims must always carry a source, a verification
date, a confidence status, whether they were verified against the installed
version, and whether they require future reverification.

## Privacy and Credential Boundaries

TriForge must not:

- read cookies,
- copy OAuth tokens,
- persist provider tokens,
- automate provider web pages,
- query provider dashboards through scraping,
- share accounts,
- trigger additional billing automatically.

Adapters interact only with:

- official provider CLIs,
- existing local authenticated sessions,
- officially supported commands and output formats.

This is consistent with the Safe Execution Policy (ADR 0011) and the existing
data boundaries. A real provider invocation is an external action in the same
family as `external_adapter_call`: it requires the provider CLI to be
explicitly available and authenticated locally, and it must respect the existing
redaction and data-handling boundaries before any context is passed to a
provider. The raw quota and usage payloads retained for audit must exclude
secrets and credentials.

## Mock Scenarios

The orchestration is exercised against mock adapters that emit
`ProviderQuotaEvent` and `ProviderUsageEstimate` values. The mock adapters
themselves are not implemented in this milestone; this section defines the
scenarios they must cover.

```text
claude quota available
claude quota warning
claude five-hour exhausted
claude seven-day exhausted
claude status unknown
codex quota available
codex five-hour warning
codex five-hour exhausted
codex weekly exhausted
codex status unknown
rate limited
auth expired
provider unavailable
usage credits required
run budget exhausted
reserve violation
partial run before exhaustion
reset becomes available
critical task cannot degrade
low-risk task degrades to alternate provider
```

## Acceptance Criteria

This documentation milestone is accepted when the spec and the matching ADR:

- define heterogeneous per-provider budgets,
- do not assume a fixed `$100` Claude pool,
- mark reported costs as client-side estimates and never as authoritative
  billing,
- exclude `--bare` from the subscription-auth flow,
- define the quota and budget condition codes and the quota exhaustion flavors,
- define implementation and review reserves and how they are checked,
- define the hard-stop behavior with no API keys and no automatic credits,
- define explicit, visible degraded routing,
- define the collaboration modes scaled by cost and risk,
- define the mock scenarios,
- document dated, reverifiable verification of external provider facts,
- change no runtime code, tests, migrations, endpoints or dashboard.

## Open Questions

- How can the quota status of each CLI be obtained in a stable, structured way?
- Which quota and usage signals are actually available in the installed provider
  versions?
- How should reasoning intensity be estimated without a provider-authoritative
  signal?
- How should usage metrics be persisted without recording any secrets?
- When should cross-vendor review be required rather than optional?
- How are per-repository budgets configured?
- How is a run resumed after a quota reset?
- How are changes in the provider event contracts detected over time?
- How is quota uncertainty surfaced in the IDE without implying false precision?
- Which data requires explicit user opt-in before it is observed or persisted?
