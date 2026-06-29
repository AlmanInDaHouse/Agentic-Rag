# ADR 0050: Protected Adaptive Router (A6.6) — closes A6

## Date

2026-06-29

## Status

Accepted

Sixth and final sub-decision of Milestone A6. Composes A6.2 (static) and A6.5 (learned
rules) into the adaptive routing layer behind protective guards. Mandate §A6.6.
Component spec: `ROUTING_LEARNING_SPEC.md` §A6.6.

## Context

Adaptive routing can improve owner selection from learned evidence — but unguarded it
can also act on sparse data, hide its reasoning, override a human, or trade correctness
for speed on a security-sensitive task. The mandate enumerates the guards an adaptive
router MUST satisfy; A6.6 enforces them and otherwise falls back to the honest static
routing.

## Decision

1. **Guarded activation.** Learned rules apply only when ALL guards hold: a confident
   (≥ minConfidence) learned rule exists; the task is not security-sensitive
   (critical-risk or high security sensitivity → conservative/neutral, correctness over
   speed); a static fallback is always available. A human override wins outright.

2. **Static fallback.** When any guard fails, routing falls back to the A6.2 static
   neutral baseline — never a fabricated or sparse-data-driven preference.

3. **Explainable, audited.** Every decision returns its mode
   (`override`/`adaptive`/`static`), the activated rules with their evidence/confidence,
   the guard outcomes and an explanation, so a human can see exactly why a provider was
   chosen.

## Alternatives

1. **Always apply learned rules.** Rejected: sparse data, security tasks and missing
   human override make unguarded adaptation unsafe.
2. **Pure static routing forever.** Rejected: it discards real, evidence-gated
   repository learning; the guards make adaptation safe rather than banning it.
3. **Optimize for speed.** Rejected outright by the mandate: security and correctness
   take priority; the security guard enforces it.

## Consequences

### Positive

- Routing can learn and adapt where the evidence is strong, while staying honest, safe
  and explainable, with a human override and a static fallback — closing A6.

### Negative

- Adaptation only kicks in once a repository has confident, sample-gated rules; until
  then routing is static/neutral — by design.

## Risks

- **R-GOV (adaptive bias / opaque routing)** — mitigated: guards + explainability +
  human override + static fallback; security tasks never trade correctness for speed.

## Conditions to Revisit

- A durable metrics/profile store enables cross-session adaptation.
- Tuning minConfidence / the security guard as real evidence accrues.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.6 + A6 closure
- `docs/adr/0045-..0049-..` (the A6.1–A6.5 stack)
- `apps/api/src/orchestration/adaptiveRouter.ts`
