# ADR 0024: RAG Abstention Calibration

## Date

2026-06-06

## Status

Accepted

## Context

Milestone 1.5H added deterministic answerability metadata to context search and runtime `load_context`. The initial policy used simple global and mode-aware score thresholds. Retrieval evaluation now has synthetic `answerable`, `no_answer`, `ambiguous` and `redaction` query types, so the abstention policy needs a deterministic way to tune thresholds for those fixture classes without adding answer generation.

## Problem

Global thresholds are too coarse for the expanded corpus. No-answer cases should be conservative, ambiguous queries should require stronger evidence, and redaction cases may have weaker lexical matches after sensitive values are removed. Fallback retrieval also needs a visible adjustment because fallback results can be useful but should be treated as lower confidence.

## Decision

Add deterministic abstention calibration by search mode, query type and fallback use.

The effective policy is resolved in this order:

1. Default policy.
2. Search mode override.
3. Query type override.
4. Fallback adjustment.

Per-request policy overrides remain available for tests and local experimentation, but calibration is the product default. The policy stays static and versioned in code for this milestone. Synthetic fixtures are the first calibration source.

Fallback adjustment is conservative: it raises the effective score threshold and preserves stricter earlier decisions such as `fallbackAllowed=false` for `queryType=no_answer`.

## Alternatives Considered

### Global thresholds

Rejected as the only mechanism. They are simple, but they cannot distinguish no-answer, ambiguous and redaction behavior.

### Thresholds by mode

Useful and retained. Lexical, mock-vector and hybrid scores have different meanings, so mode-specific defaults remain part of the effective policy.

### Thresholds by queryType

Selected. Query type calibration lets no-answer fixtures use conservative thresholds while redaction fixtures can tolerate lower safe lexical scores.

### LLM-as-judge

Rejected. It would introduce model dependency, non-determinism and data-handling risks before the project has approved judge models or answer generation.

## Final Decision

Milestone 1.5I uses deterministic calibration by mode, query type and fallback use. It does not introduce LLM-as-judge, GraphRAG, Code Graph, real models, external providers or answer generation. Thresholds are conservative heuristics and are tuned first against synthetic fixtures.

## Consequences

- Search responses include effective policy metadata for evaluation and dashboard inspection.
- Retrieval evaluation passes fixture `queryType` to search and can block on no-answer abstention accuracy.
- Fallback results remain allowed by default, but the effective minimum score is raised by a fallback penalty.
- The system still does not prove production semantic quality or generation faithfulness.

## Pending Risks

- Synthetic fixtures can overfit the current scoring behavior.
- Mock-vector and hybrid modes still do not prove real semantic quality.
- Query type is an API hint, not ground truth from the runtime.
- Future answer generation will need separate faithfulness and abstention evaluation.
- Larger fixture sets may require threshold changes.
