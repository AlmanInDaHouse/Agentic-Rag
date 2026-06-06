# Retrieval Evaluation Harness

This tool evaluates Context Engine retrieval against deterministic synthetic fixtures.

It measures:

- precision@k
- recall@k
- hit@k
- mean reciprocal rank
- expected chunk found
- fallback used rate

The runner starts the existing black-box harness runtime, creates a temporary PostgreSQL schema, ingests fixture documents through HTTP, runs `lexical`, `mock_vector` and `hybrid` searches, and writes reports.

## Commands

```bash
corepack pnpm test:retrieval-eval
corepack pnpm eval:retrieval
corepack pnpm eval:retrieval:gate
```

`test:retrieval-eval` is unit-only and does not require PostgreSQL.

`eval:retrieval` requires the same local PostgreSQL availability as `pnpm test:harness`.

`eval:retrieval:gate` runs the full evaluation with `tooling/retrieval-eval/baselines/thresholds.v1.json`. It exits with code `1` when a blocking gate fails and writes the gate status into the reports.

## Reports

Runtime reports are written to:

```text
reports/retrieval-eval/latest.json
reports/retrieval-eval/latest.md
```

Reports are generated artifacts and are ignored by git.

## Baselines and Thresholds

Versioned baselines live in:

```text
tooling/retrieval-eval/baselines/baseline.v1.json
tooling/retrieval-eval/baselines/thresholds.v1.json
```

The initial gate blocks on:

- hitAtK >= 1.0
- expectedChunkFound >= 1.0
- meanReciprocalRank >= 0.5

`precisionAtK`, `recallAtK` and `fallbackUsedRate` are reported but non-blocking initially.

To update thresholds, run the evaluation, inspect the generated JSON/Markdown reports, and commit only the intentional baseline or threshold JSON change. Do not commit generated `reports/retrieval-eval` outputs.

## Scope

This harness does not use LLM-as-judge, external providers, real local models, GraphRAG or Code Graph. Mock embeddings validate retrieval pipeline behavior only; they do not prove semantic quality. pgvector evaluation remains opt-in outside the required gate.
