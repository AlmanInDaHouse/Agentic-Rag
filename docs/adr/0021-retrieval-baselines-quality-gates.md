# ADR 0021: Retrieval Baselines and Quality Gates

## Date

2026-06-06

## Status

Accepted

## Context

Milestone 1.5E introduced a deterministic retrieval evaluation harness with synthetic fixtures, simple metrics and JSON/Markdown reports. Those reports make retrieval behavior visible, but they do not yet fail when expected retrieval quality regresses.

## Problem

Without baselines or thresholds, retrieval evaluation is observational only. A change can lower `hit_at_k`, miss expected chunks or push expected chunks too far down the ranking while still passing unit tests. The project needs a controlled way to compare evaluation output against expected quality floors before adding GraphRAG, Code Graph or real models.

## Decision

Add versioned retrieval thresholds and compact synthetic baselines under:

```text
tooling/retrieval-eval/baselines
```

The quality gate:

- loads versioned JSON thresholds,
- evaluates generated retrieval reports,
- fails on blocking regressions,
- reports fixture, mode, query, metric, expected value and actual value,
- keeps `precisionAtK`, `recallAtK` and `fallbackUsedRate` non-blocking initially,
- writes pass/fail state and failures into JSON and Markdown reports.

The required modes remain:

```text
lexical
mock_vector
hybrid
```

Do not require pgvector, real models, external providers or LLM-as-judge for the gate.

## Alternatives Considered

### No thresholds

Rejected. Reports alone do not create a regression signal.

### Hardcoded thresholds

Rejected. Hardcoded thresholds are harder to review, version and update when fixtures or accepted behavior intentionally change.

### Versioned baselines

Selected. Small JSON files make expectations explicit, reviewable and reproducible without committing noisy generated reports.

### LLM-as-judge

Rejected for now. LLM judging would add non-determinism, model/provider requirements and data-handling policy questions before the project approves real judge models.

## Final Decision

Milestone 1.5F uses versioned JSON thresholds plus compact synthetic baselines. CI can run metric and gate unit tests without a database or real model. Full gate execution remains available through the black-box harness runtime and can be run locally or through a manual workflow with PostgreSQL.

## Consequences

- Retrieval regressions can fail deterministically when the full gate is run.
- Threshold changes become explicit source diffs.
- Generated reports remain local artifacts and are not committed.
- The required CI path remains free of real models and pgvector.
- The gate still measures only synthetic pipeline behavior.

## Pending Risks

- Synthetic fixtures are small and can overfit current chunking/ranking behavior.
- Initial thresholds are minimal and do not prove production semantic quality.
- pgvector-specific quality still needs opt-in evaluation.
- Future real embedding models will need separate baselines and possibly different thresholds.
- LLM-as-judge remains out of scope until evaluation and data policies are stronger.
