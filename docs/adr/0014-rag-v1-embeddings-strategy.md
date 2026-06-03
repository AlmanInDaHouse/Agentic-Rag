# ADR 0014: RAG v1 Embeddings Strategy

## Date

2026-06-03

## Status

Accepted

## Context

Context Engine v0 provides manual/project/artifact sources, deterministic chunking, lexical retrieval, persisted retrieval traces and runtime `load_context` integration. The next architectural question is how to move toward semantic and hybrid retrieval without breaking CI reproducibility, expanding safety scope too early or adding database extension friction before interfaces are proven.

## Problem

Semantic retrieval requires embeddings, model/provider selection, vector storage and fallback behavior. Adding pgvector or real embedding models immediately would increase operational complexity before the project has adapter boundaries, deterministic tests or a redaction policy. Staying lexical forever avoids complexity but delays the learning needed for real RAG.

## Decision

Prepare RAG v1 in phases:

1. Milestone 1.5A defines the spec and ADR only.
2. Milestone 1.5B introduces embedding interfaces and deterministic mock embeddings.
3. Milestone 1.5C evaluates pgvector and local embeddings after the interface and harness are stable.
4. Milestone 1.5D implements real hybrid lexical plus vector retrieval.

Lexical retrieval remains the fallback path throughout the rollout.

## Alternatives Considered

### Continue lexical-only

Rejected as the long-term strategy. Lexical retrieval is useful and should remain as fallback, but it does not test semantic retrieval behavior or embedding lifecycle design.

### Mock embeddings first

Selected for the next implementation step. Mock embeddings keep CI deterministic and validate interfaces, storage decisions and fallback behavior before adding model/runtime dependencies.

### pgvector immediately

Rejected for the current milestone. pgvector is the likely production path, but it adds extension setup, dimension choices and CI database implications before adapter boundaries are ready.

### External vector database

Rejected. A separate vector DB adds infrastructure, credentials, operational behavior and dependency surface that is not justified for the current Postgres-backed MVP.

## Final Decision

Do not implement pgvector or real embeddings in Milestone 1.5A. Define the architecture now, then implement deterministic mock embedding interfaces in Milestone 1.5B. Add pgvector and optional local embeddings only after the harness proves the interface and fallback behavior. Keep lexical fallback as a reliability requirement.

## Consequences

- The project gets a clear RAG roadmap without adding dead code.
- CI remains independent from model downloads and vector extensions for now.
- Future implementation can test embedding lifecycle with deterministic vectors first.
- pgvector can be introduced deliberately with a migration and CI plan.
- External embedding providers remain blocked until approval, redaction and data handling policies exist.

## Pending Risks

- Mock embeddings do not validate real semantic quality.
- pgvector dimension choices may force migration design tradeoffs.
- Local embedding models may have resource and reproducibility issues.
- External providers require explicit data policy and approval gates.
- Hybrid scoring must define normalization carefully to remain explainable.
