# ADR 0049: Repository-specific Profiles (A6.5)

## Date

2026-06-29

## Status

Accepted

Fifth sub-decision of Milestone A6. Turns the A6.4 metrics into repo-scoped,
evidence-bearing routing rules. Mandate §A6.5. Component spec:
`ROUTING_LEARNING_SPEC.md` §A6.5.

## Context

TriForge may legitimately learn "in THIS repository, provider X is better at task family
Y" — but the mandate forbids auto-generalizing such a finding to all repositories, and
it must not act on sparse data. The learned rules must be scoped, gated and evidenced.

## Decision

1. **Learn per repository, scoped by `repoId`.** A derived `CapabilityRule` fires only
   when `RouterContext.repoId` matches the repository it was learned from (an additive
   `repoId` field on `RouterContext`); it is inert elsewhere — no generalization.

2. **Gate on sample size and difference.** A rule forms only when BOTH providers have at
   least `minSample` re-derived samples for the task family AND their first-pass success
   rates differ by at least `minDifference`. Otherwise the task family is reported as
   UNKNOWN — never a fabricated preference.

3. **Carry the evidence.** Each rule records `n` per provider and a `confidence` from the
   observed difference, with an evidence basis citing the repository and counts; it
   favors the better provider by a delta proportional to confidence.

## Alternatives

1. **Global provider rankings.** Rejected: that is the eternal-stereotype / auto-
   generalization the mandate forbids.
2. **Act on any observed difference.** Rejected: sparse or noisy data would drive
   biased routing; the sample + difference gates require real evidence.

## Consequences

### Positive

- Learned routing is honest, scoped to the repository, gated on real evidence, and
  inert where it has no data.

### Negative

- Until a repository accrues enough samples, its task families are UNKNOWN and routing
  stays neutral there — by design.

## Risks

- **R-GOV (routing bias)** — mitigated: rules are evidence-gated, repo-scoped, versioned
  and overridable; sparse data yields no rule.

## Conditions to Revisit

- A6.6 consumes these rules with its own confidence gate + human override.
- A durable metrics store enables cross-session repository learning.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.5
- `docs/adr/0046-static-capability-router.md`, `0048-execution-metrics.md`
- `apps/api/src/orchestration/{repositoryProfiles,executionMetrics,staticRouter}.ts`
