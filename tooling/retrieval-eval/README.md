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
```

`test:retrieval-eval` is unit-only and does not require PostgreSQL.

`eval:retrieval` requires the same local PostgreSQL availability as `pnpm test:harness`.

## Reports

Runtime reports are written to:

```text
reports/retrieval-eval/latest.json
reports/retrieval-eval/latest.md
```

Reports are generated artifacts and are ignored by git.

## Scope

This harness does not use LLM-as-judge, external providers, real local models, GraphRAG or Code Graph. Mock embeddings validate retrieval pipeline behavior only; they do not prove semantic quality.
