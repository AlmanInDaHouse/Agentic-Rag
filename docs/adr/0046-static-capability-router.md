# ADR 0046: Static Capability Router — honest, evidence-based (A6.2)

## Date

2026-06-29

## Status

Accepted

Second sub-decision of Milestone A6. Produces the per-provider capability score the A4
owner-selection (`orchestration/routing.ts`) consumes. Mandate §A6.2; Vision §16.
Component spec: `ROUTING_LEARNING_SPEC.md` §A6.2.

## Context

The router must turn a task profile into a provider preference. The mandate is explicit:
**do not encode stereotypes as eternal truths.** At A6.2 TriForge has gathered NO
repository performance evidence (that is A6.4/A6.5), so any "provider X is better at Y"
rule would be an unfounded stereotype.

## Decision

1. **Neutral by default.** Every provider starts at an equal baseline score; the router
   asserts no preference without evidence.

2. **Rules carry evidence, not stereotypes.** Each `CapabilityRule` must declare an
   `evidenceBasis`, a `confidence`, a `fallback`, a `reason` and a `version`. The default
   set contains only a hard-fact rule (`required-capability-snapshot`: a provider whose
   capability snapshot lacks a REQUIRED capability scores 0) and a `neutral-baseline`
   rule that documents the no-stereotype stance and adjusts nothing.

3. **Versioned, overridable, auditable, deterministic.** The router and each rule are
   versioned; callers may supply custom evidence-bearing rules (e.g. from A6.4/A6.5
   repository metrics); the result records the applied rules with their evidence and
   confidence; the function is pure.

## Alternatives

1. **Hard-code provider strengths (e.g. "Claude for reasoning, Codex for refactors").**
   Rejected — that is exactly the eternal stereotype the mandate forbids; there is no
   evidence yet to support it.
2. **Skip the static router and route only by quota.** Rejected: capability is the
   PRIMARY factor in A4 owner selection; the router supplies it honestly (neutral until
   measured) rather than leaving it undefined.

## Consequences

### Positive

- Routing is honest: no fabricated preferences; only hard facts (missing required
  capability) move a score, and learned rules can be added later with their evidence.
- The output plugs directly into the A4 owner-selection as `capabilityScores`.

### Negative

- Until A6.4/A6.5 gather metrics, routing is neutral on capability and owner selection
  is effectively driven by quota/availability — by design, not by accident.

## Risks

- **R-GOV (routing bias)** — avoided: no stereotype is encoded; rules require evidence.

## Conditions to Revisit

- A6.4/A6.5 produce repository metrics → add evidence-bearing rules (with confidence and
  a minimum sample) and re-version the rule set.
- A6.3 combines these scores with quota/auth/history.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.2
- `docs/adr/0045-task-profiler.md`
- `apps/api/src/orchestration/{staticRouter,routing,taskProfiler}.ts`
