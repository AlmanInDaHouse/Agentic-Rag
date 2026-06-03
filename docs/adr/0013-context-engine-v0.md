# ADR 0013: Context Engine v0

## Date

2026-06-03

## Status

Accepted

## Context

TriForge Agentic Lab has a mock debate system, a persisted mock runtime state machine, safe execution policy and approval gates. The next milestone needs context ingestion and retrieval so `load_context` can become meaningful before real RAG, GraphRAG, code graph or adapter work begins.

## Problem

The runtime currently has a `load_context` step, but there is no persisted context model. Adding real embeddings, filesystem readers or external adapters now would expand infrastructure and safety surface before the core context contract is proven.

## Decision

Implement Context Engine v0 with lexical retrieval:

- `context_sources`, `context_documents`, `context_chunks` and `context_retrievals` tables.
- Allowed source types: `manual_text`, `project_note`, `artifact`.
- Deterministic paragraph-first chunking.
- Stable SHA-256 content hash for duplicate detection.
- Simple lexical scoring over source name, document title and chunk content.
- Retrieval trace persisted as JSONB.
- Runtime `load_context` uses the run objective as query and records `context_retrieval_created`.

No pgvector, external embeddings, filesystem readers, web crawlers or real adapters are introduced.

## Alternatives Considered

### Do not add a context engine yet

Rejected. The runtime has a `load_context` step and needs traceable context behavior before later RAG and adapter milestones.

### Add pgvector from the start

Rejected for now. pgvector may be useful later, but it adds extension management and CI/database setup complexity before lexical retrieval is proven.

### Lexical retrieval v0

Selected. Keyword scoring is simple, deterministic, easy to test and sufficient for the first context milestone.

### Add local embeddings from the start

Rejected. Local embedding models introduce model selection, runtime resource requirements and quality concerns that are not needed for v0.

## Final Decision

Context Engine v0 uses lexical retrieval only. The data model keeps clean source/document/chunk boundaries so embeddings can be added later, but no vector extension or model dependency is required in this milestone.

## Consequences

- Context ingestion and retrieval can run in local dev and CI without external services.
- Harness can validate behavior through HTTP only.
- Runtime `load_context` becomes traceable and useful while staying mock-only.
- Duplicate documents have a clear `409 Conflict` policy per source and normalized content hash.
- Future semantic retrieval can build on the same source/document/chunk model.

## Pending Risks

- Lexical ranking does not capture semantic similarity.
- There is no retention, redaction or quota policy.
- Source types beyond `manual_text`, `project_note` and `artifact` still need adapter specs and approval rules.
- Retrieval snapshots are stored in JSONB and should stay bounded.
- Real RAG and GraphRAG designs remain future milestones.
