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

## Out of Scope

- GraphRAG.
- Code Graph.
- Web crawling.
- Filesystem reading.
- External source connectors.
- Real Codex, Claude, Gemini or Ollama adapters.
- LLM answer generation.
- External model re-ranking.
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

Milestone 1.5B implements the first embedding persistence boundary without pgvector.

### `embedding_models`

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
provider TEXT NOT NULL
dimension INTEGER NOT NULL
is_active BOOLEAN NOT NULL DEFAULT true
metadata JSONB NOT NULL DEFAULT '{}'
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
- Future pgvector work must introduce a separate migration and extension plan.
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
  provider: "mock";
  dimension: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

type EmbeddingVector = number[];

type EmbeddingRequest = {
  input: string;
};

type EmbeddingResult = {
  modelId: string;
  provider: "mock";
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
2. `local_ollama_embedding` later after adapter policy is accepted.
3. External providers only after explicit approval, redaction and data handling policy.

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

### Milestone 1.5C: pgvector and Local Embeddings

- Implement only after Milestone 1.5C-A data policy is accepted.
- Add pgvector migration and database support if operationally acceptable.
- Add optional local embedding model path, preferably Ollama.
- Keep external providers out of default runtime.

### Milestone 1.5D: Real Hybrid Retrieval

- Combine lexical and vector scores.
- Store hybrid retrieval traces.
- Expose dashboard details for lexical/vector score components.
- Validate fallback behavior in harness.

## Safe Execution and Data Policy

- Embedding text already persisted from `manual_text`, `project_note` or `artifact` sources is medium risk when processed by an approved local/mock embedding adapter.
- Sensitive context must be scanned before persistence and redacted before chunking when findings are detected.
- Restricted context must be blocked by default.
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

## Risks

- pgvector requires extension support and a fixed vector dimension.
- Mock embeddings do not prove semantic quality.
- Local embedding models add runtime resource and reproducibility concerns.
- External providers introduce data handling, approval and privacy risks.
- Hybrid scoring can become hard to reason about without clear normalization.
- Regex redaction is not complete DLP and does not eliminate the need for stronger data governance before real providers.
