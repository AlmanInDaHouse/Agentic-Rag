# ADR 0020: Retrieval Evaluation Harness

## Date

2026-06-05

## Status

Accepted

## Context

TriForge Agentic Lab now has Context Engine ingestion, lexical search, deterministic mock embeddings, hybrid retrieval and optional pgvector active retrieval. Before adding GraphRAG, Code Graph or real embedding models, the project needs a repeatable way to see whether retrieval returns the expected chunks for known queries.

## Problem

Without a retrieval evaluation harness, ranking changes can appear correct in unit tests while degrading expected retrieval behavior. Manual inspection is too inconsistent, and using an LLM as judge would add model dependency, non-determinism and data-handling concerns before the project has a stronger evaluation policy.

## Decision

Add a deterministic retrieval evaluation harness based on synthetic fixtures and expected chunks.

The harness:

- ingests fixture documents through the public API,
- generates mock embeddings when evaluating vector or hybrid modes,
- runs configured queries against `lexical`, `mock_vector` and `hybrid`,
- resolves expected chunks after deterministic ingestion/chunking,
- calculates simple metrics,
- writes JSON and Markdown reports.

Do not introduce LLM-as-judge, real local models, external providers or pgvector requirements for standard CI.

## Alternatives Considered

### No evaluation yet

Rejected. Retrieval behavior is now broad enough that changes need repeatable measurement before more retrieval layers are added.

### Manual evaluation

Rejected. Manual inspection is useful for debugging but not reproducible enough for regression tracking.

### Fixtures plus expected chunks

Selected. Synthetic fixtures with expected document titles and chunk substrings provide deterministic, transparent evaluation without extra infrastructure.

### LLM-as-judge

Rejected for now. It would introduce non-determinism, model/provider policy questions and possible data-handling risk before the project approves external or real local judge models.

## Final Decision

Milestone 1.5E implements deterministic fixture-based retrieval evaluation with simple traceable metrics. It keeps mock embeddings as the default vector path and keeps pgvector evaluation opt-in. Reports are generated artifacts, not source-of-truth fixtures.

## Consequences

- Retrieval changes can be compared with consistent JSON and Markdown reports.
- Metric unit tests can run without PostgreSQL or model dependencies.
- The full runner reuses black-box HTTP behavior through the harness runtime.
- Results are interpretable because expected chunks are explicit.
- The project still does not claim real semantic quality from mock embeddings.

## Pending Risks

- Synthetic fixtures may not reflect production retrieval needs.
- No pass/fail quality threshold is enforced yet.
- pgvector evaluation requires explicit local setup.
- Future real models will need separate evaluation fixtures and quality baselines.
- LLM-as-judge remains out of scope until evaluation and data policies are stronger.
