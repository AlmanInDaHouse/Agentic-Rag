# ADR 0022: Expanded Retrieval Evaluation Corpus

## Date

2026-06-06

## Status

Accepted

## Context

Milestone 1.5E added a deterministic retrieval evaluation harness. Milestone 1.5F added baselines and quality gates. The initial fixtures were intentionally small and useful for proving the pipeline, but they did not cover ambiguous queries, overlapping vocabulary, redaction-adversarial cases, no-answer queries or TriForge runtime-domain retrieval.

## Problem

Small fixtures make retrieval regressions easier to miss. Before adding GraphRAG, Code Graph or real embedding models, the project needs broader synthetic coverage that exercises failure modes common in retrieval systems while staying deterministic and safe for CI.

## Decision

Expand the retrieval evaluation corpus with synthetic fixtures covering:

- ambiguous security terminology,
- overlapping keyword documents with different intent,
- redaction-adversarial retrieval facts,
- explicit no-answer queries,
- TriForge agent runtime and policy concepts.

Add query metadata:

```text
queryType: answerable | no_answer | ambiguous | redaction
tags: security | runtime | redaction | retention | no_answer | ambiguous
```

No-answer queries use explicit empty expected arrays and are handled separately by the evaluator. Do not use real data, real secrets, external providers, real models, pgvector requirements or LLM-as-judge.

## Alternatives Considered

### Keep fixtures small

Rejected. The small corpus was sufficient to prove the harness but too narrow for regression tracking.

### Expand synthetic corpus

Selected. Synthetic fixtures are reviewable, deterministic and safe for CI while covering more retrieval shapes.

### Use real data

Rejected. Real data introduces privacy, data handling and secret exposure risk before stronger dataset governance exists.

### Use LLM-as-judge

Rejected. LLM judging would add non-determinism, model dependency and data policy questions before the project approves judge models.

## Final Decision

Milestone 1.5G expands the corpus synthetically and prepares future finer-grained baselines through query types, tags and threshold override hooks. The evaluation remains deterministic and model-free.

## Consequences

- The harness covers more retrieval failure modes without production data.
- Reports can group and inspect query type and tags.
- Baselines can evolve toward fixture, mode and query-type thresholds.
- Mock-vector and hybrid quality gates remain conservative because mock embeddings are not semantic.
- Generated reports remain local artifacts.

## Pending Risks

- Synthetic corpora can still overfit current ranking and chunking behavior.
- No-answer handling does not prove answer abstention; it only prevents expected-match invention.
- Real semantic model evaluation will need separate baselines.
- Redaction placeholders are synthetic and do not prove complete DLP.
- LLM-as-judge remains out of scope until evaluation and data policies mature.
