# Retrieval Evaluation Spec

## Objective

Evaluate whether the Context Engine retrieves the expected chunks for a query in a deterministic, reproducible way before adding GraphRAG, Code Graph or real embedding models.

## Scope

Milestone 1.5E adds a retrieval evaluation harness for:

- deterministic synthetic corpora,
- expected chunk assertions,
- repeatable metric calculation,
- JSON and Markdown reporting,
- black-box API execution through the existing harness runtime.

Milestone 1.5F adds:

- versioned quality thresholds,
- compact synthetic baselines,
- a deterministic quality gate,
- report output that records pass/fail state and blocking failures.

Milestone 1.5G expands the synthetic corpus with:

- ambiguous queries,
- overlapping-keyword corpora,
- redaction-adversarial fixtures,
- explicit no-answer queries,
- project-domain runtime and policy fixtures.

Milestone 1.5H connects no-answer fixtures to deterministic RAG answerability metadata and records abstention metrics without adding LLM-as-judge or answer generation.

The evaluation harness measures pipeline behavior, not production semantic quality.

## Out of Scope

- GraphRAG.
- Code Graph.
- External providers.
- Codex, Claude, Gemini or other real adapter integrations.
- Required local model runtime.
- Required pgvector in standard CI.
- pgvector index tuning.
- LLM-as-judge.
- Dashboard UI.

## Metrics

Minimum metrics:

- `precision_at_k`: matching retrieved chunks in the top `k` divided by `k`.
- `recall_at_k`: matching retrieved chunks divided by expected chunks up to `k`.
- `hit_at_k`: `1` when any expected chunk appears in the top `k`, otherwise `0`.
- `mean_reciprocal_rank`: reciprocal rank of the first expected chunk, or `0`.
- `expected_chunk_found`: boolean equivalent of `hit_at_k > 0`.
- `fallback_used_rate`: fraction of evaluated query/mode runs where any top result reported fallback.
- `abstention_accuracy`: `1` when the search answerability decision matches `expectedShouldAnswer`, otherwise `0`.
- `false_answer_rate`: `1` when a query expected abstention but answerability returned `shouldAnswer=true`, otherwise `0`.
- `false_abstention_rate`: `1` when a query expected an answer but answerability returned `shouldAnswer=false`, otherwise `0`.

Metrics are calculated over expected chunk ids resolved after ingestion and deterministic chunking.

## Evaluated Modes

Standard evaluated modes:

```text
lexical
mock_vector
hybrid
```

`mock_vector` and `hybrid` generate mock embeddings before evaluation. pgvector may be evaluated manually by running the same tool against an opt-in pgvector environment, but pgvector is not required by standard CI.

## Baselines

A retrieval baseline is a versioned description of the expected quality floor for the current synthetic fixtures and evaluated modes. Baselines are not full generated reports; they are compact source-controlled reference files that state which fixtures, modes, query count and minimum quality expectations are considered stable for a milestone.

Baselines live in:

```text
tooling/retrieval-eval/baselines
```

The initial baseline is:

```text
baseline.v1.json
```

It contains:

- baseline version,
- fixture names,
- evaluated modes,
- expected query count,
- minimum blocking metrics,
- non-blocking metrics,
- notes about synthetic scope and pgvector opt-in status.

Update a baseline only when fixture content, expected chunks, retrieval modes or accepted ranking behavior intentionally changes. The normal flow is:

1. Run `pnpm eval:retrieval`.
2. Inspect `reports/retrieval-eval/latest.json` and `latest.md`.
3. Update the compact baseline and/or thresholds with the intentional change.
4. Keep generated reports out of git.

Baselines are compared during quality-gate runs by applying the matching versioned thresholds to the generated evaluation report.

## Quality Gates

Quality gates compare an evaluation report against versioned thresholds. Thresholds live next to baselines:

```text
tooling/retrieval-eval/baselines/thresholds.v1.json
```

Initial default blocking thresholds for the current synthetic fixtures:

- `hitAtK >= 1.0`,
- `expectedChunkFound >= 1.0`,
- `meanReciprocalRank >= 0.5`.

Initial non-blocking metrics:

- `precisionAtK`,
- `recallAtK`,
- `fallbackUsedRate`,
- `abstentionAccuracy`,
- `falseAnswerRate`,
- `falseAbstentionRate`.

`fallbackUsedRate` remains reported but does not block because fallback can be acceptable while pgvector is optional. `precisionAtK` and `recallAtK` are informational initially because the fixture set is small and `k` is intentionally broad.

`hitAtK`, `expectedChunkFound` and `meanReciprocalRank` must be present in the default threshold block. Other metrics may be omitted to leave them ungated. Threshold values are bounded to `0..1`. Blocking thresholds are minimums except `fallbackUsedRate`, which is treated as a maximum if it is ever made blocking.

Thresholds may be overridden per mode for:

```text
lexical
mock_vector
hybrid
```

pgvector remains opt-in and outside the required gate.

Thresholds may also include optional overrides by fixture name and query type. Override precedence is:

```text
default -> queryTypes -> modes -> fixtures
```

This keeps lexical defaults strict while allowing conservative handling for mock-vector and hybrid modes until real semantic embeddings exist.

## Fixtures

Fixtures live in:

```text
tooling/retrieval-eval/fixtures
```

Each fixture includes:

```json
{
  "name": "basic-security-corpus",
  "documents": [
    {
      "title": "Phishing incident notes",
      "content": "Synthetic incident notes..."
    }
  ],
  "queries": [
    {
      "query": "how was the phishing email detected",
      "expectedDocumentTitles": ["Phishing incident notes"],
      "expectedChunkContains": ["mail gateway flagged the sender domain"],
      "k": 3
    }
  ]
}
```

Fixture content must be synthetic. Do not include real user data, credentials, logs, customer content or production incidents.

## Expanded Corpus

Milestone 1.5G expands fixtures while keeping all data synthetic. The expanded set covers:

- basic security and mixed-topic retrieval,
- ambiguous security terms such as `alert`, `incident`, `policy` and `token`,
- overlapping vocabulary with different intent, such as phishing detection versus notification settings,
- redaction-adversarial context that uses placeholder values only,
- no-answer queries with explicit empty expected arrays,
- TriForge runtime concepts such as agent runs, approval gates, safe execution policy, retention policy and context lifecycle.

All fixture documents must avoid real secrets, real customer data, production logs and live credentials.

## Query Types and Tags

Each query declares:

```text
queryType: answerable | no_answer | ambiguous | redaction
tags: security | runtime | redaction | retention | no_answer | ambiguous
```

Rules:

- `answerable`, `ambiguous` and `redaction` queries require expected document titles and expected chunk substrings.
- `no_answer` queries must use empty `expectedDocumentTitles` and `expectedChunkContains` arrays.
- `expectedShouldAnswer` may be provided explicitly. Defaults are `false` for `no_answer` and `true` for other query types.
- `no_answer` does not mean search must return zero rows. It means the fixture has no expected relevant chunk and the evaluator must not invent an expected match.
- Aggregate retrieval metrics exclude `no_answer` queries and report their count separately from total query count.
- `redaction` queries must assert retrieval facts that remain after redaction; expected substrings must not be original secret-like placeholder values.
- `ambiguous` queries intentionally share terms across documents but still identify one expected chunk.

## Ambiguous and Overlapping Queries

Ambiguous and overlapping fixtures are designed to catch ranking regressions where common words appear in several documents. These fixtures should use short synthetic documents and precise expected substrings so failures are easy to debug.

## Redaction-Adversarial Queries

Redaction-adversarial fixtures may include synthetic placeholders such as:

```text
fake-token-for-redaction-test
user@example.test
```

They must not include real secrets. Expected substrings should target safe retrieval facts or redaction behavior, not the original placeholder value.

## No-Answer Queries

No-answer queries are represented explicitly with `queryType: no_answer`, `tags` containing `no_answer`, and empty expected arrays. For these queries:

- `hit_at_k` is treated as `1`,
- `expected_chunk_found` is treated as `true`,
- `mean_reciprocal_rank` is treated as `1`,
- `recall_at_k` is treated as `1`,
- `precision_at_k` remains `0`.

This prevents empty expected arrays from penalizing the corpus while preserving a clear distinction from answerable queries.

## Answerability Evaluation

The retrieval evaluation runner reads `answerability` from search responses. Expected answerability is:

- `false` for `queryType=no_answer`,
- `true` for `queryType=answerable`,
- configurable with `expectedShouldAnswer` for ambiguous and redaction queries.

The runner records abstention metrics per query and summarizes them by mode. These metrics are non-blocking initially because score thresholds are heuristic and the corpus is still synthetic. They can become blocking later after behavior is stable.

## Reports

Runtime reports are written to:

```text
reports/retrieval-eval/latest.json
reports/retrieval-eval/latest.md
```

The JSON report stores per-fixture, per-mode and per-query metrics plus aggregate metrics. When the quality gate is enabled, it also stores pass/fail status and blocking failures. The Markdown report includes fixture name, mode, query, metrics, fallback status, top results and a Quality Gate section when present.

Generated reports are runtime outputs and are not committed by default.

## Acceptance Criteria

- Fixtures are reproducible and synthetic.
- Evaluation is deterministic for the same database, code and fixture set.
- Fixture validation supports query type, tags and explicit no-answer expectations.
- Unit tests cover metric calculations.
- The runner uses API HTTP behavior rather than private API services.
- The runner can write JSON and Markdown reports.
- Standard metric tests do not require PostgreSQL, pgvector or a real model.
- The full evaluation runner does not require a real model.
- pgvector evaluation remains opt-in and outside standard CI unless a future profile is added.
- Quality thresholds are versioned in JSON.
- Quality gate failures list fixture, mode, query, metric, expected value and actual value.
- The gate can run without LLM-as-judge or real model dependencies.

## Risks

- Mock embeddings validate pipeline behavior but not semantic quality.
- Small synthetic fixtures can overfit current chunking and ranking behavior.
- Full evaluation needs a local PostgreSQL-compatible harness runtime.
- Initial thresholds are intentionally minimal and do not prove production semantic quality.
