# ADR 0019: pgvector Active Retrieval

## Date

2026-06-05

## Status

Accepted

## Context

TriForge Agentic Lab already has Context Engine v0, deterministic mock embeddings, JSONB embedding persistence, optional pgvector capability reporting, a localhost-only local embedding boundary and lexical fallback. ADR 0018 kept pgvector optional and did not wire it into active retrieval.

## Problem

The project needs a real pgvector-backed retrieval path for environments that explicitly provide the extension and vector table, while preserving standard PostgreSQL compatibility for CI, harness and local development. Making pgvector mandatory would break default setups; staying JSONB-only would leave the vector storage boundary unproven.

## Decision

Activate pgvector retrieval only when `TRIFORGE_EMBEDDING_STORAGE=pgvector` and the database has both:

- the installed `vector` extension,
- the optional `context_chunk_vector_embeddings` table.

Embedding generation keeps the JSONB row as the compatibility source of truth and also upserts the pgvector row when the optional table is available. Vector search prefers pgvector only in that configured and available state. If pgvector is unavailable or has no rows for the candidate chunks, search falls back to JSONB mock-vector scoring and then lexical retrieval.

Standard CI and standard harness do not require pgvector. pgvector-specific tests are limited to unit fakes and no-extension fallback harness scenarios unless an opt-in vector profile is run locally.

## Alternatives Considered

### Continue with JSONB only

Rejected as the active retrieval strategy. JSONB remains the fallback and CI path, but it does not exercise the intended Postgres vector retrieval path.

### Make pgvector mandatory

Rejected. It would make ordinary PostgreSQL environments, standard harness and CI depend on an extension that is still optional for this project.

### Enable pgvector active retrieval only by config

Selected. It gives operators an explicit opt-in and keeps default behavior stable.

### External vector database

Rejected. A separate vector database adds credentials, infrastructure, network behavior and operational policy outside the current Postgres-backed MVP.

## Final Decision

`TRIFORGE_EMBEDDING_STORAGE=pgvector` requests pgvector active retrieval. The request is honored only when the extension and optional table exist. Lexical fallback is mandatory. Standard CI remains pgvector-free. pgvector tests may be opt-in or isolated from the default harness.

## Consequences

- JSONB/mock/lexical remains the reliable baseline.
- `/api/rag/status` reports configured storage, effective storage, extension availability, table availability, fallback reason and whether vector search is enabled.
- Search result snapshots report `searchMode`, `vectorStorageUsed`, `fallbackUsed`, `fallbackReason`, `lexicalScore`, `vectorScore` and `finalScore`.
- The standard migration is safe in databases without pgvector.
- Local vector experiments require explicit database setup.

## Pending Risks

- The vector dimension is fixed at 32 for the current mock/local boundary.
- No approximate pgvector index is configured yet.
- No production retrieval tuning, evaluation set or model-quality benchmark exists yet.
- Local embedding model quality and dimensions remain operator-dependent.
- External embedding providers remain out of scope.
