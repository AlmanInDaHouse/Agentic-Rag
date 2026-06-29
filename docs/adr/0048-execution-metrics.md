# ADR 0048: Execution Metrics (A6.4)

## Date

2026-06-29

## Status

Accepted

Fourth sub-decision of Milestone A6. Records the evidence the repository profiles (A6.5)
and adaptive router (A6.6) learn from. Mandate §A6.4. Component spec:
`ROUTING_LEARNING_SPEC.md` §A6.4.

## Context

Adaptive routing is only as trustworthy as its metrics. The mandate enumerates five
ways metrics can mislead — duplication, cross-run contamination, unverified provider
self-reporting, missing samples, cherry-picking — and requires the store to protect
against each. Without these protections an adaptive router would learn from noise or
from a provider's own unverified claims.

## Decision

1. **Append-only, idempotent store.** `MetricsStore.record` is idempotent on the
   `(runId, taskId)` key — a repeat is ignored — so one run/task contributes exactly
   one sample, and there is no delete API (no cherry-picking).

2. **Run-scoped samples.** Every sample carries its `runId`; the store keys by it and
   never overwrites another run's sample (no cross-run contamination).

3. **Provenance-gated aggregation.** Each sample records its `provenance`
   (`re_derived` vs `provider_reported`); aggregates count ONLY re-derived samples
   (gates/ledger/governance), reporting how many provider-reported samples were
   excluded. A provider's own claim never moves a learned rate.

4. **Unknown, never fabricated.** An aggregate over zero matching samples reports
   `"unknown"`, never a 0 or a made-up rate; every aggregate reports its sample count
   `n`.

## Alternatives

1. **A plain mutable list.** Rejected: it permits overwrite (contamination), deletion
   (cherry-picking) and duplicate inflation.
2. **Trust provider-reported metrics.** Rejected: that is the unverified-self-report
   surface; only re-derived evidence feeds learning.
3. **Fabricate a default rate (e.g. 0.5) for missing samples.** Rejected: that invents
   evidence; `"unknown"` is the honest state, and A6.6 must require a minimum sample.

## Consequences

### Positive

- The metrics the adaptive router will learn from cannot be inflated, contaminated,
  self-reported, fabricated from zero, or cherry-picked.

### Negative

- Until enough re-derived samples accrue, aggregates are `"unknown"` and the router
  stays neutral/static — by design (A6.6 requires a minimum sample).

## Risks

- **R-GOV (adaptive bias)** — mitigated: only verified, complete, append-only samples
  feed aggregation; `n` is always reported so confidence can be gated.

## Conditions to Revisit

- A6.5/A6.6 consume the aggregates with a minimum-sample + confidence gate.
- A durable (DB-backed) metrics store replaces the in-memory one for cross-session
  learning.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.4
- `apps/api/src/orchestration/executionMetrics.ts`
