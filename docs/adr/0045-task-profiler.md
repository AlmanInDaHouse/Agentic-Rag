# ADR 0045: Task Profiler (A6.1)

## Date

2026-06-29

## Status

Accepted

First sub-decision of Milestone A6 (Routing & Performance Learning). Produces the A1
`TaskProfile` the A4 `orchestration/routing.ts` already consumes. Mandate §8/§A6.1;
Vision §16. Component spec: `ROUTING_LEARNING_SPEC.md` §A6.1.

## Context

A6 must choose a provider per task from EVIDENCE, not stereotype. The A4 owner-selection
router consumes a `TaskProfile` but nothing produced one; routing decisions were
therefore ungrounded. A6.1 fills that gap with a deterministic, auditable classifier.

## Decision

1. **A pure, deterministic profiler.** `profileTask(spec, signals?, override?)` maps a
   `TaskSpecification` (+ optional `filesTouched`/language/framework signals) to the A1
   `TaskProfile` + an extended profile, using heuristics over the spec text and signals
   only — no clock, no randomness — so the same input always yields the same output.

2. **Validated, versioned, overrideable, auditable.** The profile is parsed against
   `TaskProfileSchema` (invalid → throw); it carries a `profilerVersion`; an explicit
   override wins over the computed value and the overridden fields + rationale are
   returned for audit.

3. **Profile the task, not the provider.** The profiler encodes no provider stereotype;
   capability/provider rules with evidence/confidence/fallback are the A6.2 router's
   responsibility (mandate "no eternal stereotypes").

## Alternatives

1. **Let the router classify inline.** Rejected: a separate, validated, versioned
   profile is reusable (routing, metrics, UI), auditable and overrideable.
2. **LLM-based classification.** Rejected for A6.1: non-deterministic and unverifiable;
   heuristic classification from the structured spec is reproducible and testable. An
   LLM-assisted profile could be added later behind the same validated contract.

## Consequences

### Positive

- Routing decisions are now grounded in a reproducible, auditable profile; overrides
  give the owner explicit control.

### Negative

- Heuristic classification is coarse; the richer extended fields (framework, context
  size) are best-effort and may need repository-specific tuning (A6.5).

## Risks

- **R-GOV (routing bias)** — mitigated: the profiler is task-only and override-able; the
  stereotype constraint is enforced at A6.2.

## Conditions to Revisit

- A6.2/A6.3 consume the profile; A6.5 adds repository-specific tuning.
- An LLM-assisted profile is introduced behind the validated contract.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.1
- `docs/context/TRIFORGE_PROJECT_VISION.md` §16
- `apps/api/src/orchestration/{taskProfiler,routing}.ts`
