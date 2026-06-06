# RAG Engine Spec

## Objective

Move from Context Engine v0 lexical retrieval toward RAG v1 with semantic retrieval while preserving traceability, safety, deterministic tests and compatibility with the mock agent runtime.

## Scope v1

RAG v1 should support, in phases:

- embeddings per context chunk,
- semantic search over embedded chunks,
- the existing lexical search path,
- hybrid lexical plus vector search,
- deterministic ranking rules,
- document and chunk metadata,
- persisted retrieval traces,
- runtime `load_context` integration,
- reproducible harness coverage,
- lexical fallback when embeddings are unavailable,
- context data policy enforcement before real embeddings.
- optional pgvector/local embedding capability reporting without making either required,
- optional active pgvector retrieval when explicitly configured and available,
- deterministic retrieval evaluation with synthetic fixtures, simple metrics, baselines and quality gates.

## Out of Scope

- GraphRAG.
- Code Graph.
- Web crawling.
- Filesystem reading.
- External source connectors.
- Real Codex, Claude, Gemini or Ollama adapters.
- LLM answer generation.
- External model re-ranking.
- External embedding providers.
- LLM-as-judge retrieval evaluation.
- Advanced multi-tenant controls.
- Real authentication.

## Current Baseline

Context Engine v0 already provides:

- `context_sources`,
- `context_documents`,
- `context_chunks`,
- `context_retrievals`,
- deterministic chunking,
- lexical retrieval,
- `load_context` integration,
- dashboard and harness coverage.

RAG v1 must build on those entities rather than replacing them.

## Implemented Mock Embedding Entities

Milestone 1.5B implements the first embedding persistence boundary without requiring pgvector. Milestone 1.5C adds optional pgvector capability metadata while keeping JSONB as the default storage. Milestone 1.5D activates pgvector retrieval only when `TRIFORGE_EMBEDDING_STORAGE=pgvector` and the database has the required extension and optional vector table.

### `embedding_models`

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
provider TEXT NOT NULL
dimension INTEGER NOT NULL
is_active BOOLEAN NOT NULL DEFAULT true
metadata JSONB NOT NULL DEFAULT '{}'
storage_kind TEXT NOT NULL DEFAULT 'jsonb'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(name, provider)
```

Purpose:

- identify the embedding adapter/model,
- record the fixed output dimension,
- allow active/inactive model transitions,
- keep provider metadata separate from chunk metadata.

### `context_chunk_embeddings`

```sql
id UUID PRIMARY KEY
chunk_id UUID NOT NULL REFERENCES context_chunks(id) ON DELETE CASCADE
model_id UUID NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE
embedding JSONB NOT NULL
embedding_hash TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(chunk_id, model_id)
```

Notes:

- Milestone 1.5B stores deterministic mock vectors as JSONB.
- JSONB is not the final production semantic search path.
- Milestone 1.5C records storage kind metadata and pgvector availability, but does not make vector columns mandatory.
- Milestone 1.5D may mirror rows into the optional pgvector table when configured and available.
- JSONB remains the compatibility fallback and standard CI storage path.
- `embedding_hash` should be derived from normalized chunk content, model id and adapter version so re-embedding decisions are traceable.

### `rag_retrieval_runs`

```sql
id UUID PRIMARY KEY
goal_id UUID REFERENCES goals(id) ON DELETE CASCADE
query TEXT NOT NULL
mode TEXT NOT NULL
lexical_weight NUMERIC NOT NULL
vector_weight NUMERIC NOT NULL
embedding_model_id UUID REFERENCES embedding_models(id)
fallback_reason TEXT
results JSONB NOT NULL DEFAULT '[]'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Purpose:

- trace whether a retrieval used lexical, vector or hybrid mode,
- record weights,
- record fallback reasons,
- preserve result snapshots for dashboard and runtime observability.

## Contracts

Milestone 1.5B adds these contracts to `packages/shared` because API, dashboard and harness now use them.

```ts
type EmbeddingModel = {
  id: string;
  name: string;
  provider: "mock" | "local";
  dimension: number;
  storageKind: "jsonb" | "pgvector";
  isActive: boolean;
  metadata: Record<string, unknown>;
};

type EmbeddingVector = number[];

type EmbeddingRequest = {
  input: string;
};

type EmbeddingResult = {
  modelId: string;
  provider: "mock" | "local";
  dimension: number;
  embedding: EmbeddingVector;
  embeddingHash: string;
};

type HybridSearchWeights = {
  lexicalWeight: number;
  vectorWeight: number;
};

type RagSearchRequest = {
  goalId: string;
  query: string;
  limit: number;
  mode: "lexical" | "mock_vector" | "hybrid";
  weights: HybridSearchWeights;
};

type RagSearchResult = {
  sourceId: string;
  documentId: string;
  chunkId: string;
  content: string;
  lexicalScore: number;
  vectorScore: number | null;
  score: number;
  finalScore: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  metadata: Record<string, unknown>;
};
```

## Embedding Adapter Boundary

Implementations use a small adapter interface:

```ts
interface EmbeddingAdapter {
  name: string;
  provider: string;
  dimension: number;
  embedText(input: string): Promise<number[]>;
  embedBatch(inputs: string[]): Promise<number[][]>;
}
```

`mock_embedding_v1` is the initial adapter:

- provider: `mock`,
- dimension: `32`,
- deterministic SHA-256 based vector generation,
- normalized input before hashing,
- no model downloads,
- no network calls,
- no random values.

Mock embeddings are generated for persisted context chunks only. Generation skips chunks that already have an embedding for the active mock model unless `force` is requested. Recalculation rewrites the existing `(chunk_id, model_id)` row through an upsert and produces the same vector/hash for the same normalized chunk content.

Planned adapters:

```text
mock_embedding
local_ollama_embedding
local_python_embedding
openai_embedding_optional
gemini_embedding_optional
```

Preferred path for this project:

1. `mock_embedding` first for deterministic CI and harness coverage.
2. optional localhost/loopback-only embedding endpoint after adapter policy is accepted.
3. External providers only after explicit approval, redaction and data handling policy.

## Optional pgvector and Local Embeddings

Milestone 1.5C keeps pgvector and local embeddings optional. Milestone 1.5D adds an active pgvector retrieval path while preserving that optional contract.

Defaults:

```text
TRIFORGE_EMBEDDING_PROVIDER=mock
TRIFORGE_EMBEDDING_STORAGE=jsonb
```

Optional settings:

```text
TRIFORGE_EMBEDDING_PROVIDER=local
TRIFORGE_LOCAL_EMBEDDING_ENDPOINT=http://127.0.0.1:11434/api/embed
TRIFORGE_LOCAL_EMBEDDING_DIMENSION=32
TRIFORGE_EMBEDDING_STORAGE=pgvector
```

Rules:

- CI and standard harness use mock embeddings and JSONB storage.
- `pgvector` active retrieval is requested only by `TRIFORGE_EMBEDDING_STORAGE=pgvector`.
- `pgvector` is effective only when the database has the installed `vector` extension and the optional `context_chunk_vector_embeddings` table.
- A separate `postgres-vector` Docker Compose profile is available for local experiments.
- The API must keep running when pgvector is absent.
- When pgvector is requested but unavailable, generation keeps JSONB rows and search falls back to JSONB mock-vector scoring or lexical retrieval.
- The API must keep running when the local model endpoint is absent or failing.
- Local endpoint calls must use short timeout, no infinite retries and no full-content logging.
- External embedding providers remain prohibited.
- No text is sent outside the configured localhost/loopback endpoint.

`GET /api/rag/status` reports provider/storage configuration, availability and fallback warnings without exposing secrets or endpoint values.

## Active pgvector Retrieval

The optional pgvector table is:

```text
context_chunk_vector_embeddings
```

It stores one `vector(32)` row per `(chunk_id, model_id)` and references the existing JSONB `context_chunk_embeddings` row. Standard migrations do not create the `vector` extension. If the extension is already installed, migration `0011_pgvector_active_retrieval.sql` creates the optional table. Otherwise it is a safe no-op. Local operators can run `infra/sql/enable_pgvector.sql` against the optional `postgres-vector` service.

Storage selection:

- configured `jsonb`: embeddings are stored in JSONB and vector search uses JSONB mock-vector scoring.
- configured `pgvector` plus available extension/table: embeddings are stored in JSONB and mirrored to pgvector; vector search uses pgvector cosine distance.
- configured `pgvector` but unavailable extension/table: embeddings remain JSONB-only; vector search falls back to JSONB mock-vector scoring if embeddings exist, otherwise lexical.

Hybrid behavior:

- `mock_vector` uses the best available vector storage and records `vectorStorageUsed`.
- `hybrid` combines lexical and vector scores with the existing `0.4 / 0.6` weights.
- if pgvector is requested but JSONB is used, result snapshots set `fallbackUsed=true` and a pgvector fallback reason.
- if no vector scores are available, `mock_vector` and `hybrid` fall back to lexical results.

Search result snapshots include:

```text
searchMode
vectorStorageUsed: jsonb | pgvector | none
fallbackUsed
fallbackReason
lexicalScore
vectorScore
finalScore
```

Active search must continue to exclude deleted sources, deleted documents, deleted chunks, deleted embeddings and blocked/restricted documents.

## Retrieval Evaluation

Milestone 1.5E adds a deterministic evaluation harness under:

```text
tooling/retrieval-eval
```

It uses synthetic fixtures, ingests documents through the public API, runs queries across `lexical`, `mock_vector` and `hybrid`, and writes JSON/Markdown reports. Metrics include:

```text
precision_at_k
recall_at_k
hit_at_k
mean_reciprocal_rank
expected_chunk_found
fallback_used_rate
```

Rules:

- metric unit tests run without PostgreSQL,
- full evaluation uses the black-box harness runtime and therefore needs PostgreSQL,
- mock embeddings validate retrieval pipeline behavior only,
- pgvector evaluation remains opt-in and outside standard CI,
- no LLM-as-judge or real model is required.

Milestone 1.5F adds compact baselines and versioned thresholds under:

```text
tooling/retrieval-eval/baselines
```

The initial quality gate blocks on:

```text
hitAtK >= 1.0
expectedChunkFound >= 1.0
meanReciprocalRank >= 0.5
```

`precisionAtK`, `recallAtK` and `fallbackUsedRate` are reported but non-blocking initially. Full gate execution remains a black-box harness run and requires PostgreSQL. A manual retrieval-eval workflow can run the gate and upload reports without making pgvector or real models mandatory.

Milestone 1.5G expands the corpus with `answerable`, `ambiguous`, `redaction` and `no_answer` query types plus tags for security, runtime, retention, redaction and ambiguity. No-answer queries use empty expected arrays explicitly and do not require search to return zero rows. They only assert that the evaluator should not invent an expected chunk match.

Milestone 1.5H adds deterministic RAG answerability and abstention policy. Search responses include an `answerability` object that decides whether retrieved context is sufficient before any future answer generation. This policy is based only on retrieval metadata and does not call an LLM. Milestone 1.5I calibrates the abstention policy by mode, query type and fallback use while keeping thresholds deterministic and heuristic.

## Retrieval Modes

Initial modes:

```text
lexical
mock_vector
hybrid
```

`lexical` remains the default and keeps Context Engine v0 behavior.

`mock_vector` embeds the query with `mock_embedding_v1`, reads stored mock chunk embeddings and ranks by normalized cosine similarity. It does not prove semantic quality because the vectors come from deterministic hashing, not a trained embedding model.

`hybrid` combines lexical and mock vector signals:


```text
score = lexical_weight * lexical_score + vector_weight * vector_score
```

Initial weights:

```text
lexical_weight = 0.4
vector_weight = 0.6
```

Ranking rules:

- normalize lexical and vector scores before combining,
- sort by combined score descending,
- break ties deterministically by lexical score, vector score, chunk index and chunk id,
- keep `limit` bounded,
- record weights and mode in the retrieval trace.

Fallback rules:

- If no chunk embeddings exist, use lexical-only retrieval and record a fallback reason.
- If query embedding fails, use lexical-only retrieval and record a warning/fallback reason.
- Fallback metadata is stored in persisted retrieval result snapshots as `fallbackUsed` and `fallbackReason`.
- Runtime `load_context` remains lexical by default.

## Abstention Policy

Context search evaluates answerability after ranking and persists the decision with the retrieval trace when a `context_retrievals` row is created. The structured result is:

```json
{
  "shouldAnswer": false,
  "answerability": "abstain",
  "reason": "insufficient_context",
  "confidence": 0.21,
  "topScore": 0.21,
  "minRequiredScore": 1,
  "supportingResultIds": [],
  "warnings": ["No retrieved chunk passed the minimum relevance threshold"]
}
```

Initial reasons:

```text
sufficient_context
insufficient_context
no_results
low_score
fallback_only
redacted_or_restricted
deleted_context_excluded
```

Initial criteria:

- no results => `shouldAnswer=false`, reason `no_results`,
- top `finalScore` below `minRequiredScore` => `shouldAnswer=false`, reason `low_score`,
- useful supporting result count below `minSupportingResults` => `shouldAnswer=false`, reason `insufficient_context`,
- fallback lexical can answer when fallback is allowed and the top score passes threshold,
- fallback-only results abstain when `fallbackAllowed=false`,
- redacted chunks can answer if they remain active and relevant,
- restricted, blocked or deleted context must not support an answer.

Default score thresholds are simple and calibrated. Retrieval ranking scores are unchanged, but answerability compares a bounded `0..1` score. Lexical scores above `1` are normalized for answerability as `score / (score + 1)`; vector and hybrid scores already fit the bounded range.

### Calibrated Abstention Policy

Milestone 1.5I resolves an effective policy from:

```text
mode: lexical | mock_vector | hybrid
queryType: answerable | no_answer | ambiguous | redaction
fallbackUsed: true | false
```

The current static calibration is intentionally conservative:

```json
{
  "default": {
    "minRequiredScore": 0.35,
    "minSupportingResults": 1,
    "fallbackAllowed": true,
    "fallbackPenalty": 0.10
  },
  "modes": {
    "lexical": { "minRequiredScore": 0.50 },
    "mock_vector": { "minRequiredScore": 0.40 },
    "hybrid": { "minRequiredScore": 0.35 }
  },
  "queryTypes": {
    "answerable": {},
    "no_answer": { "minRequiredScore": 0.95, "fallbackAllowed": false },
    "ambiguous": { "minRequiredScore": 0.65 },
    "redaction": { "minRequiredScore": 0.30 }
  },
  "fallback": {
    "fallbackAllowed": true,
    "fallbackPenalty": 0.10
  }
}
```

Effective policy precedence is:

```text
default -> mode override -> queryType override -> fallback adjustment
```

Per-request `answerabilityPolicy` overrides remain available for tests and local experiments, but the default runtime behavior should use the static calibration. `queryType` is an optional API hint and not ground truth. Normal context search defaults to `answerable`; retrieval evaluation passes fixture query types explicitly.

Fallback adjustment raises the effective threshold by `fallbackPenalty` and caps it at `1.0`. It must not relax a stricter policy selected earlier in precedence; for example `queryType=no_answer` keeps `fallbackAllowed=false` even when fallback metadata is present.

Search responses include effective policy metadata:

```json
{
  "effectiveMinRequiredScore": 0.95,
  "effectiveFallbackAllowed": false,
  "effectivePolicySource": ["default", "mode:lexical", "queryType:no_answer"]
}
```

This policy does not generate a final answer. It only decides whether retrieved context is sufficient for a future answer step.

## Phased Roadmap

### Milestone 1.5A: Spec and ADR

- Define RAG v1 architecture.
- Decide phased embedding strategy.
- Do not implement pgvector, embeddings or adapters.

### Milestone 1.5B: Interfaces and Mock Embeddings

- Add embedding adapter interfaces.
- Add deterministic `mock_embedding`.
- Add unit tests and harness coverage.
- Keep lexical fallback.
- Avoid pgvector until CI/database implications are settled.
- Persist mock vectors as JSONB to prove lifecycle and ranking determinism.

### Milestone 1.5C-A: Context Data Policy and Redaction

- Add deterministic regex scanning/redaction.
- Store classification and redaction metadata.
- Block restricted context by default.
- Use redacted chunks for search and mock embeddings.
- Do not add pgvector, local models or external providers.

### Milestone 1.5C-B: Retention, Quota and Deletion Policy

- Add service-layer quotas for document count, document size, chunk count, chunk size and retrieval history.
- Add soft delete/restore and audit events for context lifecycle operations.
- Exclude deleted documents/chunks from active lexical, mock-vector and hybrid search.
- Block embedding generation for deleted documents/sources and skip deleted chunks.
- Keep hard delete limited to local dev/test policy.
- Do not add pgvector, local models or external providers.

### Milestone 1.5C: pgvector and Local Embeddings

- Implement only after Milestone 1.5C-A/B data policy and retention controls are accepted.
- Add optional pgvector capability checks and local embedding adapter boundary.
- Keep mock/jsonb as the CI path.
- Keep external providers out of default runtime.

### Milestone 1.5D: Real Hybrid Retrieval

- Combine lexical and vector scores.
- Store hybrid retrieval traces.
- Expose dashboard details for lexical/vector score components.
- Validate fallback behavior in harness.

### Milestone 1.5D: pgvector Active Retrieval

- Prefer pgvector vector scoring when explicitly configured and available.
- Keep JSONB/mock vector scoring and lexical fallback mandatory.
- Report pgvector extension/table availability in RAG status.
- Keep standard CI and standard harness free of pgvector requirements.
- Do not add GraphRAG, Code Graph, external providers or worker queues.

### Milestone 1.5E: Retrieval Evaluation Harness

- Add synthetic retrieval evaluation fixtures.
- Add deterministic metrics and unit tests.
- Add a black-box API runner that writes JSON and Markdown reports.
- Keep LLM-as-judge, real local models and pgvector requirements out of standard CI.

### Milestone 1.5F: Retrieval Baselines and Quality Gates

- Add compact versioned synthetic baselines.
- Add JSON thresholds with default and per-mode overrides.
- Add a quality gate that fails on blocking retrieval regressions.
- Keep precision, recall and fallback rate informational until fixture coverage grows.
- Keep pgvector, LLM-as-judge and real model requirements out of the required gate.

### Milestone 1.5G: Expanded Retrieval Eval Corpus

- Add synthetic ambiguous, overlapping-keyword, redaction-adversarial, no-answer and agent-runtime fixtures.
- Add query type and tag metadata.
- Support explicit no-answer metrics without treating empty expected arrays as valid for normal queries.
- Prepare query-type, mode and fixture threshold overrides.
- Keep all data synthetic and keep LLM-as-judge, pgvector requirements and real models out of scope.

### Milestone 1.5H: RAG Abstention Policy

- Add deterministic answerability contracts and service.
- Include answerability metadata in context search responses.
- Store answerability in runtime `load_context` step output.
- Add retrieval-eval abstention metrics for no-answer and answerable queries.
- Keep abstention metrics non-blocking initially.
- Keep LLM answer generation, GraphRAG, Code Graph, LLM-as-judge and real models out of scope.

## Safe Execution and Data Policy

- Embedding text already persisted from `manual_text`, `project_note` or `artifact` sources is medium risk when processed by an approved local/mock embedding adapter.
- Sensitive context must be scanned before persistence and redacted before chunking when findings are detected.
- Restricted context must be blocked by default.
- Deleted context must not be returned by active search or used for new embedding generation.
- Quota and deletion operations must write context audit events.
- External embedding providers are `external_adapter_call` and require future approval policy.
- Sensitive context must not be sent to an external provider. Basic regex redaction is not enough to approve external providers.
- Filesystem, web, GitHub, Gmail and Calendar sources remain out of scope.

## Acceptance Criteria for Milestone 1.5B

- Existing lexical retrieval keeps working.
- Shared Zod contracts define embedding models, vectors, chunk embeddings and search modes.
- `mock_embedding_v1` is deterministic, 32-dimensional and local-only.
- Mock embeddings can be generated for a document or source.
- Generation is idempotent and does not duplicate chunk/model rows.
- `mock_vector` search works when mock embeddings exist.
- `hybrid` search combines lexical and mock vector scores with 0.4/0.6 weights.
- `mock_vector` and `hybrid` fall back to lexical when embeddings are unavailable.
- Retrieval result snapshots record mode, scores, `finalScore`, `fallbackUsed` and `fallbackReason`.
- Runtime `load_context` remains lexical by default.
- Harness validates deterministic mock embeddings before pgvector is introduced.
- CI remains reproducible without external model access.
- No external context source or provider is enabled by default.

## Acceptance Criteria for Milestone 1.5C Optional Support

- `/api/rag/status` reports active/configured provider and storage.
- pgvector absence does not break startup, migration or harness.
- local embedding endpoint absence does not break startup.
- mock/jsonb remains the default.
- hybrid search keeps working with mock embeddings.
- lexical fallback remains available when vector paths are unavailable.
- Docker Compose offers an optional pgvector service without replacing standard `postgres:16`.

## Acceptance Criteria for Milestone 1.5D pgvector Active Retrieval

- `TRIFORGE_EMBEDDING_STORAGE=pgvector` requests pgvector active retrieval.
- The system detects extension and table availability without failing startup.
- Standard migrations do not require `CREATE EXTENSION vector`.
- Embedding generation keeps JSONB compatibility and mirrors pgvector rows only when available.
- `mock_vector` and `hybrid` use pgvector scores when configured and available.
- If pgvector is unavailable, search falls back to JSONB/mock-vector or lexical retrieval.
- Result snapshots report storage and fallback metadata.
- `/api/rag/status` reports extension availability, table availability, configured storage, effective storage, fallback reason and vector search enabled state.
- Standard unit tests and harness pass without pgvector.

## Acceptance Criteria for Milestone 1.5E Retrieval Evaluation

- Synthetic fixtures cover multiple retrieval topics.
- Metric functions cover precision@k, recall@k, hit@k and MRR.
- Evaluation reports include per-query metrics, fallback state and top results.
- JSON and Markdown reports can be generated locally.
- Metric unit tests run in standard CI without DB or model dependencies.
- Full evaluation remains black-box through HTTP and does not use private API services.

## Acceptance Criteria for Milestone 1.5F Retrieval Quality Gates

- Thresholds and compact baselines are versioned JSON.
- Quality gate reports pass/fail and blocking failures.
- Failures include fixture, mode, query, metric, expected value and actual value.
- Gate unit tests run without PostgreSQL, pgvector or real model dependencies.
- Full gate execution can run locally or manually in CI with PostgreSQL.
- Required CI remains free of pgvector, external providers, LLM-as-judge and real model requirements.

## Acceptance Criteria for Milestone 1.5G Expanded Retrieval Corpus

- Expanded fixtures remain synthetic and contain no real secrets.
- Fixture validation enforces query types, tags and explicit no-answer expected arrays.
- No-answer metrics do not penalize empty expected results.
- Reports show query type and tags.
- Threshold and baseline JSON account for expanded fixtures and query metadata.
- pgvector, LLM-as-judge, external providers and real model requirements remain out of scope.

## Acceptance Criteria for Milestone 1.5H RAG Abstention Policy

- Shared Zod contracts define abstention reasons, answerability result and policy.
- Context search returns `answerability` without changing the existing `results` payload.
- Runtime `load_context` stores `answerability` and continues when `shouldAnswer=false`.
- No-results, low-score, sufficient-context and fallback-only policy cases have unit coverage.
- Retrieval evaluation records `abstention_accuracy`, `false_answer_rate` and `false_abstention_rate`.
- Abstention metrics remain informational until thresholds are proven stable.
- No LLM-as-judge, LLM answer generation, GraphRAG, Code Graph, external providers or required real models are added.

### Milestone 1.5I: Abstention Calibration by Mode and Query Type

- Add shared Zod contracts for calibrated answerability policy.
- Resolve effective abstention thresholds by mode, query type and fallback use.
- Pass retrieval evaluation `queryType` into context search.
- Report effective threshold, fallback allowance, policy source and answerability reason.
- Make no-answer abstention accuracy eligible for blocking quality gates.
- Keep false-answer and false-abstention rates non-blocking while calibration is still synthetic.
- Do not add generation, GraphRAG, Code Graph, LLM-as-judge, real models or external providers.

## Risks

- pgvector requires explicit extension/table setup and a fixed vector dimension.
- Mock embeddings do not prove semantic quality.
- Local embedding models add runtime resource and reproducibility concerns.
- External providers introduce data handling, approval and privacy risks.
- Hybrid scoring can become hard to reason about without clear normalization.
- Regex redaction is not complete DLP and does not eliminate the need for stronger data governance before real providers.
- Basic retention has no background pruning worker yet.
- Existing retrieval snapshots may reference content selected before later deletion.
- Approximate pgvector indexes and production-grade vector tuning are not configured yet.
- Evaluation fixtures and quality gates are synthetic, so they do not prove production semantic quality.
