# ADR 0027: Quota Aware Provider Orchestration

## Date

2026-06-28

## Status

Accepted

## Context

TriForge Agentic Lab is being reoriented as a local, multi-agent software
engineering environment that coordinates official provider CLIs, initially
OpenAI Codex CLI and Anthropic Claude Code. Each provider runs through its
official CLI, authenticated locally with the user's own account and
subscription. The initial flow uses no API keys and no additional paid credits.

Prior ADRs kept real providers out of scope. ADR 0010 defines the mock agent
runtime state machine and stores run budgets as `max_steps`, `max_failures` and
`failure_count` on `agent_runs`. ADR 0011 and ADR 0012 define the Safe Execution
Policy, risk levels, approval gates and concurrency hardening. ADR 0017 owns the
existing context retention and quota concept. The runtime is still mock-only and
calls no real adapters. This ADR records the first provider-aware design and
revisits the deferral of external providers, while keeping execution mock-only
until adapters are specified and built.

In this environment a provider invocation is a scarce resource. Provider quotas
are heterogeneous, partially opaque, can change over time, and can share
capacity with the user's own interactive use of the same subscription. Several
provider-dependent facts are temporal and must be treated as dated assumptions
rather than permanent truths.

## Problem

Without a quota-aware design, TriForge would risk:

- exhausting provider quota during planning, leaving none for implementation or
  review,
- modelling heterogeneous providers as a single universal counter,
- treating client-side cost estimates as authoritative billing,
- assuming a fixed dollar pool for Claude that does not currently exist,
- silently degrading critical tasks to a non-preferred provider,
- waiting in the background indefinitely on a quota reset,
- baking temporal external claims into architecture without reverification.

## Decision

TriForge adopts a quota-aware provider orchestration design, specified in
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md`, with:

- heterogeneous per-provider budgets, not a symmetric per-invocation counter,
- reserves for implementation and review, checked before each runtime transition
  that consumes provider capacity,
- `Specialist Mode` as the economical default,
- conditional escalation to `Pair`, `Full Debate` and `Competitive` modes based
  on risk, uncertainty and available budget,
- a hard stop when quota is exhausted with no API keys and no automatic credits,
- explicit quota and budget condition codes, expressed as `UPPER_SNAKE_CASE`
  reason codes consistent with the existing `ACTION_BLOCKED` family and mapped
  onto the existing lowercase `agent_runs` lifecycle and stop conditions,
- visible degraded routing, with critical tasks pausing for a human decision
  instead of degrading silently,
- usage and cost metrics treated as client-side estimates, never authoritative,
- external provider facts recorded as dated, versioned, reverifiable
  assumptions.

Quota signals are consumed from structured provider events when available. If a
signal cannot be verified against the installed provider version, the adapter
reports `unknown` rather than inventing a value, and TriForge never fabricates a
remaining percentage.

## Alternatives Considered

### Quota-aware heterogeneous orchestration

Selected. Heterogeneous per-provider budgets, reserves, a Specialist default
with conditional escalation, explicit hard stops, visible degraded routing and
dated external assumptions match the reality of opaque, non-equivalent provider
quotas and the no-API-key, no-extra-spend policy.

### Symmetric per-invocation budget

Rejected. Provider usage models and quota signals are not equivalent, so a
single symmetric invocation counter would misrepresent both providers.

### Fixed dollar pool for Claude

Rejected. The Anthropic change that would have created a separate monthly
programmatic pool was paused, so no fixed active dollar pool exists for TriForge
to treat as an independent budget.

### Use `--bare`

Rejected. Bare mode does not use the normal OAuth subscription authentication,
so it does not fit the no-API-key subscription flow.

### Always run Pair Mode

Rejected. Running two providers on every task consumes scarce quota
excessively; Specialist Mode is the economical default and escalation is
conditional.

### Automatically switch to API keys or paid credits

Rejected. Automatic fallback to an API key or to paid or usage credits
contradicts the initial policy of no keys and no automatic spend.

### Wait silently for the reset

Rejected. The runtime must not perform indefinite background work or hide a
pause; exhaustion is surfaced explicitly and resumed manually after the reset.

### Permanently invert the specialization matrix

Rejected. A temporary availability limitation does not redefine technical
capability, so degradation is per-run and never a permanent reassignment.

### Parse `/status` text as the primary contract

Rejected. Human-readable status text has no structured, versioned guarantee and
must not be the authoritative contract; structured events are required, with
`unknown` reported otherwise.

## Final Decision

Milestone A0.1 records the quota-aware provider orchestration design as a spec
and this ADR only. No code, tests, migrations, endpoints, dashboard changes,
runtime integration, `ProviderAdapter`, Codex or Claude adapter, implemented
mock adapters, real JSONL parsing, API keys or automatic credit purchase are
added in this milestone. The execution runtime remains mock-only.

## Verification Requirements

- Each external provider-dependent claim is recorded as a dated
  `ExternalProviderAssumption` with a source type, a verification date, a
  confidence level, whether it was verified against the installed CLI version,
  and whether it requires reverification.
- The paused Anthropic monthly programmatic pool, the `--bare` exclusion, Codex
  usage ranges and the provider event schemas are flagged
  `REQUIRES_REVERIFICATION` and were not verified against installed versions in
  this documentation milestone; no source URL is invented.
- Before any adapter is implemented or frozen, its quota and usage signals and
  event schemas must be verified against the installed provider version, and
  unverifiable signals must report `unknown`.
- The concrete addition of new lowercase stop conditions or lifecycle states to
  `AgentRunStatusSchema`, `StopConditionSchema`, the SQL `CHECK` constraints and
  the runtime service is deferred to the implementation milestone and must be
  added in those synchronized locations together.

## Consequences

- Provider consumption is lower because Specialist Mode is the default and
  debate is an escalation.
- Runs are more predictable because reserves protect implementation and review.
- Degradation is explicit and auditable instead of silent.
- The design tolerates incomplete information, keeping unknown fields unknown.
- Cost figures are governance estimates, improving auditability without implying
  billing precision.
- The first provider-aware design exists, while execution stays mock-only until
  adapters are specified and built.

## Pending Risks

- The runtime has more states and a more complex routing decision than before.
- Some runs will pause or stop on quota, which changes the operator experience.
- Remaining quota may be unknown, so reservation operates on partial signals.
- External provider facts require periodic reverification and can change.
- The MVP needs mock adapters before any real adapter, and those are not built
  yet.
- New stop conditions and any hold state still need to be wired into the Zod
  enums, SQL `CHECK` constraints and runtime service in a later milestone.
