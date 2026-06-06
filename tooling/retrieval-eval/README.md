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

Fixtures include `answerable`, `ambiguous`, `redaction` and `no_answer` queries. No-answer queries use empty expected arrays explicitly; they do not require search to return zero rows, only that the evaluator does not invent an expected match. Report summaries keep total query count separate from retrieval metric query count so no-answer cases do not inflate aggregate retrieval quality.

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

The default threshold block must include `hitAtK`, `expectedChunkFound` and `meanReciprocalRank`. Other metrics can be omitted to leave them ungated, or marked in `nonBlocking` to report them without failing the gate. Blocking thresholds are minimums except `fallbackUsedRate`, which is treated as a maximum if it is ever made blocking.

To update thresholds, run the evaluation, inspect the generated JSON/Markdown reports, and commit only the intentional baseline or threshold JSON change. Do not commit generated `reports/retrieval-eval` outputs.

Threshold overrides can be declared by query type, mode or fixture. Current vector-mode gates are conservative because mock embeddings are deterministic hashes, not semantic vectors.

## Scope

This harness does not use LLM-as-judge, external providers, real local models, GraphRAG or Code Graph. Mock embeddings validate retrieval pipeline behavior only; they do not prove semantic quality. pgvector evaluation remains opt-in outside the required gate. Redaction fixtures use synthetic placeholders only and must not include real secrets.
