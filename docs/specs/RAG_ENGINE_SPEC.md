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
- lexical fallback when embeddings are unavailable.

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

## Candidate Future Entities

These entities are proposed for a future migration. They are not implemented in Milestone 1.5A.

### `embedding_models`

```sql
id UUID PRIMARY KEY
name TEXT NOT NULL
provider TEXT NOT NULL
dimension INTEGER NOT NULL
is_active BOOLEAN NOT NULL DEFAULT true
metadata JSONB NOT NULL DEFAULT '{}'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
model_id UUID NOT NULL REFERENCES embedding_models(id)
embedding VECTOR(...)
embedding_hash TEXT NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE(chunk_id, model_id)
```

Notes:

- If pgvector is used, `VECTOR(dimension)` requires a fixed dimension.
- The migration should choose one dimension per model family or use separate tables/columns per supported dimension if needed.
- `embedding_hash` should be derived from normalized chunk content, model id and adapter version so re-embedding decisions are traceable.
- If pgvector is postponed, deterministic mock embeddings can be represented in test-only service objects or in JSONB during a narrow interface milestone, but JSONB should not become the production semantic search path.

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

## Conceptual Contracts

These are conceptual contracts for future implementation. They should not be added to `packages/shared` until runtime/API code needs them.

```ts
type EmbeddingModel = {
  id: string;
  name: string;
  provider: "mock_embedding" | "local_ollama_embedding" | "local_python_embedding" | "openai_embedding_optional" | "gemini_embedding_optional";
  dimension: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
};

type EmbeddingVector = number[];

type EmbeddingRequest = {
  modelId: string;
  input: string;
};

type EmbeddingResult = {
  modelId: string;
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
  mode: "lexical" | "vector" | "hybrid";
  weights: HybridSearchWeights;
  modelId?: string;
};

type RagSearchResult = {
  sourceId: string;
  documentId: string;
  chunkId: string;
  content: string;
  lexicalScore: number;
  vectorScore: number | null;
  score: number;
  metadata: Record<string, unknown>;
};
```

## Embedding Adapter Boundary

Future implementations should use a small adapter interface:

```ts
interface EmbeddingAdapter {
  name: string;
  dimension: number;
  embedText(input: string): Promise<number[]>;
  embedBatch(inputs: string[]): Promise<number[][]>;
}
```

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

## Hybrid Retrieval

Hybrid retrieval should combine lexical and vector signals:

```text
score = lexical_weight * lexical_score + vector_weight * vector_score
```

Initial proposed weights:

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
- If the selected embedding model is inactive, reject the request or fall back according to API policy defined in the implementation milestone.

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

### Milestone 1.5C: pgvector and Local Embeddings

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
- External embedding providers are `external_adapter_call` and require future approval policy.
- Sensitive context must not be sent to an external provider until redaction and data handling policy exists.
- Filesystem, web, GitHub, Gmail and Calendar sources remain out of scope.

## Acceptance Criteria for Future Implementation

- Existing lexical retrieval keeps working.
- Semantic retrieval can be disabled without breaking `load_context`.
- Hybrid retrieval records mode, scores, weights and fallback reason.
- Harness validates deterministic mock embeddings before pgvector is introduced.
- CI remains reproducible without external model access.
- No external context source or provider is enabled by default.

## Risks

- pgvector requires extension support and a fixed vector dimension.
- Mock embeddings do not prove semantic quality.
- Local embedding models add runtime resource and reproducibility concerns.
- External providers introduce data handling, approval and privacy risks.
- Hybrid scoring can become hard to reason about without clear normalization.
