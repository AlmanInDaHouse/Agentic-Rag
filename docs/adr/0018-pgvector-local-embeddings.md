# ADR 0018: Optional pgvector and Local Embeddings

## Date

2026-06-05

## Status

Accepted

## Context

TriForge Agentic Lab already has Context Engine v0, deterministic redaction, retention/quota/delete controls, mock embeddings, `lexical`, `mock_vector` and `hybrid` search modes, and CI/harness coverage without real model dependencies. The next RAG step is preparing semantic storage and local embedding adapters without making either operationally mandatory.

## Problem

Real semantic retrieval needs vector storage and a trained embedding model. Making pgvector or a local model mandatory now would break standard PostgreSQL CI/dev setups and introduce runtime dependencies before search quality, redaction and operations are ready. Continuing with JSONB mock embeddings only keeps CI stable but does not prepare the implementation boundary for the next phase.

## Decision

Add optional pgvector and local embedding support:

- pgvector is optional and never required by default.
- JSONB mock embedding storage remains the standard CI/harness path.
- local embeddings are opt-in through localhost/loopback environment configuration.
- no context is sent to external APIs or non-local providers.
- if pgvector is unavailable, the system reports fallback to JSONB/mock/lexical paths.
- if the local model endpoint is unavailable, the system reports fallback to mock/lexical paths.
- lexical fallback remains mandatory.

## Alternatives Considered

### Continue with JSONB mock embeddings only

Rejected as the whole strategy. It is stable, but it delays proving pgvector/local adapter configuration boundaries.

### Make pgvector mandatory

Rejected. It would break standard PostgreSQL environments and make CI depend on an extension before the project needs production-grade vector search.

### Make pgvector optional

Selected. It lets local experiments use a pgvector image while the default stack continues to run with `postgres:16`.

### External vector database

Rejected. A vector DB adds infrastructure, credentials and operational surface that are not justified for the current Postgres-backed MVP.

### Make local embedding model mandatory

Rejected. Model availability, latency, resource use and dimension choices vary too much for CI and default local dev.

### Make local embedding model optional

Selected. A localhost/loopback-only adapter can be configured explicitly without changing default behavior or approving external providers.

## Final Decision

Milestone 1.5C adds a RAG status endpoint, optional pgvector Docker service, safe no-op pgvector migration metadata, embedding storage abstraction and local embedding adapter boundary. Default behavior remains mock provider plus JSONB storage. CI continues to validate mock/jsonb/lexical behavior. No external providers are enabled.

## Consequences

- Existing CI and harness remain independent from pgvector and model endpoints.
- Operators can see whether pgvector/local embeddings are configured and available.
- Future pgvector migrations have a storage-kind marker to build from.
- The local adapter can be tested without adding dependencies.
- Search quality remains mock/lexical unless a future milestone wires real semantic search.

## Pending Risks

- pgvector schema/index design is still future work.
- The local endpoint contract is minimal and not production hardened.
- Local model quality, latency and dimensions are operator-dependent.
- JSONB vector search remains non-production and only useful for deterministic mock behavior.
- External providers remain prohibited until stronger policy, approval and audit controls exist.
