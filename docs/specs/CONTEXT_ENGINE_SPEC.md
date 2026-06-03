# Context Engine Spec

## Objective

Define Context Engine v0 for TriForge Agentic Lab: a simple, traceable context ingestion and retrieval layer that can feed the mock agent runtime before real RAG, GraphRAG, code graph or adapter work begins.

## Scope

Milestone 1.4 supports:

- registering context sources for a goal,
- ingesting plain text documents,
- deterministic chunking,
- PostgreSQL persistence for documents, chunks and retrieval traces,
- lexical retrieval with simple ranking,
- `load_context` runtime integration,
- dashboard inspection,
- harness validation.

## Out of Scope

- GraphRAG.
- Code Graph.
- Real Codex, Claude, Gemini or Ollama adapters.
- Required external embeddings.
- pgvector.
- Worker queues.
- Real authentication.
- Web crawlers.
- Filesystem readers.
- GitHub, Gmail or Calendar adapters.
- Reading local files without an explicit future approval/policy design.

## Entities

- `context_sources`: source container attached to a goal.
- `context_documents`: ingested document metadata and stable content hash.
- `context_chunks`: deterministic text chunks used by lexical retrieval.
- `context_retrievals`: persisted retrieval trace containing query and selected results.

## Source Types

Initial allowed source types:

```text
manual_text
project_note
artifact
```

Future source types are intentionally excluded from v0:

```text
web
filesystem
github
gmail
calendar
```

Those future adapters require explicit safe execution policy and approval rules before implementation.

## Storage

Context Engine v0 uses PostgreSQL tables in migration `0006_context_engine.sql`.

- Documents store `content_hash`, not a second full document copy.
- Chunks store the retrievable text.
- Retrievals store selected results as JSONB for traceability.
- The schema keeps source/document/chunk boundaries compatible with future embeddings, but no vector extension is required.

## Chunking v0

Chunking is deterministic:

1. Normalize line endings to `\n`.
2. Trim lines and collapse excessive blank lines.
3. Split by paragraphs first.
4. Use a target size near 1000 characters.
5. Split long paragraphs on word boundaries where practical.
6. Use a small overlap for long paragraph splits.
7. Estimate tokens with `Math.ceil(content.length / 4)`.

Empty chunks are never emitted. `chunk_index` is stable for the same normalized content and chunking options.

## Retrieval v0

Retrieval is lexical:

- normalize the query,
- tokenize simple alphanumeric terms,
- score source name, document title and chunk content by term occurrence,
- weight document title matches slightly higher,
- sort by score descending,
- limit results,
- persist a `context_retrievals` row.

No embeddings or pgvector are used in this milestone.

## Runtime Integration

When an agent run advances through `load_context`:

1. The runtime uses `run.objective` as the query.
2. It searches context attached to `run.goal_id`.
3. It stores retrieval id, query and results in the step output.
4. It records timeline event `context_retrieval_created`.
5. It continues when no chunks match and stores `results: []`.

The runtime remains mock-only and does not read files, call networks or invoke real adapters.

## HTTP API

- `POST /api/goals/:goalId/context/sources`
- `GET /api/goals/:goalId/context/sources`
- `POST /api/context/sources/:sourceId/documents`
- `GET /api/context/sources/:sourceId/documents`
- `GET /api/context/documents/:documentId/chunks`
- `POST /api/goals/:goalId/context/search`
- `GET /api/goals/:goalId/context/retrievals`

Error rules:

- `400` invalid params or payload.
- `404` missing goal, source or document.
- `409` duplicate document for the same source and normalized content hash.

## Contracts

Shared Zod contracts live in `packages/shared/src/index.ts`:

- `ContextSourceTypeSchema`
- `CreateContextSourceSchema`
- `ContextSourceSchema`
- `CreateContextDocumentSchema`
- `ContextDocumentSchema`
- `ContextChunkSchema`
- `ContextSearchSchema`
- `ContextSearchResultSchema`
- `ContextRetrievalSchema`

All input schemas are strict.

## Acceptance Criteria

- A source can be created for a goal.
- Sources can be listed for a goal.
- A plain text document can be added to a source.
- Ingestion creates deterministic chunks.
- Chunks can be listed for a document.
- Context search returns relevant chunks by lexical scoring.
- Every search records a retrieval.
- Duplicate normalized content for the same source returns `409`.
- Runtime `load_context` can retrieve context and continue with no results.
- Dashboard shows sources, documents, chunks, retrievals and `load_context` output.
- Harness validates ingest/search, runtime context loading and duplicate policy.

## Risks

- Lexical ranking is intentionally basic and may miss semantically relevant context.
- There is no retention or redaction policy yet.
- Chunks can grow storage over time.
- Retrieval result JSONB snapshots may become large if limits increase.
- Future external sources need approval and adapter specs before implementation.
