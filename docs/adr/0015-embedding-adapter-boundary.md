# ADR 0015: Embedding Adapter Boundary

## Date

2026-06-03

## Status

Accepted

## Context

Context Engine v0 provides source/document/chunk persistence, lexical retrieval, retrieval traces and runtime `load_context`. ADR 0014 defines the RAG v1 rollout and identifies deterministic mock embeddings as the next implementation milestone before pgvector or real local/external models.

## Problem

The project needs to prove embedding lifecycle, contracts, ranking modes and fallback behavior without introducing database extensions, model downloads, external provider risk or non-deterministic CI. Adding real embeddings too early would blur adapter policy, redaction and operational concerns before the boundary is stable.

## Decision

Create an `EmbeddingAdapter` boundary now and implement `mock_embedding_v1` as the only active adapter.

The mock adapter:

- provider `mock`,
- dimension `32`,
- normalizes input,
- generates deterministic SHA-256 based numeric vectors,
- uses no network, model runtime, randomness or external dependency.

Persist mock vectors in PostgreSQL JSONB through `embedding_models` and `context_chunk_embeddings`. Keep lexical retrieval as the default and mandatory fallback. `mock_vector` and `hybrid` search may use persisted mock embeddings when present, but fall back to lexical retrieval and record a fallback reason when embeddings are unavailable.

Do not add pgvector, real local models, Ollama, OpenAI/Gemini/Claude embeddings, GraphRAG, Code Graph or real adapters in this milestone.

## Alternatives Considered

### No embeddings yet

Rejected. It would keep the code simple but would not validate adapter shape, persistence lifecycle, idempotent regeneration or search-mode contracts.

### pgvector direct

Rejected for this milestone. pgvector is likely useful later, but extension setup, fixed vector dimensions and CI database implications should be introduced after the adapter boundary and harness behavior are proven.

### Mock embeddings deterministically

Selected. It gives stable CI, repeatable tests and a way to exercise vector/hybrid flow without semantic claims or external runtime dependencies.

### Real local model from the start

Rejected. Local model choice, resource use, model availability and reproducibility concerns are out of scope until adapter policy and redaction requirements are accepted.

## Final Decision

Milestone 1.5B introduces embedding contracts, SQL persistence, `EmbeddingAdapter`, deterministic mock embeddings, document/source generation endpoints, dashboard controls, search modes and harness coverage. Lexical retrieval remains the default and fallback. pgvector and real embeddings remain future work.

## Consequences

- CI and harness can validate embedding lifecycle without model access.
- The API has a stable boundary for future local/provider adapters.
- Mock vectors can exercise deterministic ranking and persisted retrieval metadata.
- JSONB vector storage is acceptable only for the narrow mock milestone.
- Runtime `load_context` remains lexical by default.

## Pending Risks

- Mock embeddings are not semantically meaningful.
- JSONB vector scoring is not a scalable production vector search path.
- No redaction policy exists for real embedding providers yet.
- pgvector migration and index design remain open.
- Hybrid scoring may need recalibration once real embeddings exist.
