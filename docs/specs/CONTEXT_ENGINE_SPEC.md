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

Milestone 1.5B extends the context layer with deterministic mock embeddings and search mode selection while preserving lexical retrieval as the default.

Milestone 1.5C-A adds a basic deterministic context data policy and regex redaction layer before future pgvector or real embedding work. Milestone 1.5C-B adds retention quotas, soft delete/restore and context audit events.

Milestone 1.5C adds optional pgvector capability reporting and a local-only embedding adapter boundary without making either required.

## Out of Scope

- GraphRAG.
- Code Graph.
- Real Codex, Claude, Gemini or Ollama adapters.
- Required external embeddings.
- Required pgvector.
- Required real semantic embeddings.
- External embedding providers.
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
- `embedding_models`: registered embedding model/provider metadata.
- `context_chunk_embeddings`: deterministic mock vectors per chunk/model.
- `classification`: document data classification.
- `redaction_status`: document/chunk scan state.
- `sensitive_findings`: metadata-only sensitive finding list without matched values.
- `deleted_at` / `deleted_reason`: soft-delete markers for context sources, documents and chunks.
- `content_size`: stored character size for documents and chunks.
- `context_audit_events`: quota, deletion, restore and hard-delete audit log.

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
- When sensitive findings exist, chunks store redacted text.
- Retrievals store selected results as JSONB for traceability.
- The schema keeps source/document/chunk boundaries compatible with future embeddings, but no vector extension is required for default operation.

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

## Data Policy and Redaction

Context ingestion runs deterministic local regex scanning before document persistence. Clean text is classified as `internal`. Sensitive findings can classify content as `confidential` or `secret`; such content is allowed locally with metadata and chunks are created from redacted content. `restricted` content is blocked by default.

Duplicate detection remains based on the original normalized content hash. `redacted_content_hash` is stored when redaction changes the chunking input.

Initial finding types and rules are defined in `docs/specs/CONTEXT_DATA_POLICY_SPEC.md`. The policy is not full DLP and does not allow external providers.

Retention validates document size and active document quota before persistence. Chunk count and chunk size are validated after deterministic chunking and before chunk rows are created. Soft-deleted documents and chunks are excluded from active search and embedding generation.

## Retrieval

Default retrieval is lexical:

- normalize the query,
- tokenize simple alphanumeric terms,
- score source name, document title and chunk content by term occurrence,
- weight document title matches slightly higher,
- sort by score descending,
- limit results,
- persist a `context_retrievals` row.

Milestone 1.5B adds optional modes:

```text
lexical
mock_vector
hybrid
```

`mock_vector` ranks chunks with normalized cosine similarity between the mock query embedding and stored mock chunk embeddings.

`hybrid` combines normalized lexical score and mock vector score:

```text
0.4 * lexical_score + 0.6 * vector_score
```

If mock embeddings are unavailable, `mock_vector` and `hybrid` fall back to lexical retrieval and record `fallbackUsed` plus `fallbackReason` in result snapshots. This is not real semantic retrieval; mock vectors are deterministic hashes used to prove adapter boundaries, persistence and ranking behavior.

## Mock Embeddings

`EmbeddingAdapter` is the service boundary for embedding providers:

```ts
interface EmbeddingAdapter {
  name: string;
  provider: string;
  dimension: number;
  embedText(input: string): Promise<number[]>;
  embedBatch(inputs: string[]): Promise<number[][]>;
}
```

The initial adapter is `mock_embedding_v1`:

- provider `mock`,
- fixed dimension `32`,
- normalized input,
- SHA-256 based deterministic vector values,
- no external dependencies, network calls or random values.

Embeddings are stored in `context_chunk_embeddings.embedding` as JSONB for this narrow milestone. Recalculation uses upsert on `(chunk_id, model_id)`, so repeated generation is idempotent and cannot duplicate embeddings.

## Optional pgvector and Local Embeddings

Default context retrieval and embeddings continue to use:

```text
provider: mock
storage: jsonb
```

Optional configuration can request:

```text
provider: local
storage: pgvector
```

Those settings are capability flags, not mandatory runtime requirements. If pgvector is not available, active storage remains JSONB. If the local endpoint is not configured or not reachable, active provider remains mock. Search modes remain API-compatible:

```text
lexical
mock_vector
hybrid
```

The Context Engine does not send text to external providers. Local endpoint use is opt-in, local-only and reported through `/api/rag/status`.

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
- `GET /api/goals/:goalId/context/quota`
- `GET /api/goals/:goalId/context/audit-events`
- `POST /api/context/sources/:sourceId/documents`
- `GET /api/context/sources/:sourceId/documents`
- `DELETE /api/context/documents/:documentId`
- `POST /api/context/documents/:documentId/restore`
- `GET /api/context/documents/:documentId/chunks`
- `POST /api/goals/:goalId/context/search`
- `GET /api/goals/:goalId/context/retrievals`
- `POST /api/context/redact/preview`
- `GET /api/embedding-models`
- `POST /api/context/documents/:documentId/embeddings/mock`
- `GET /api/context/documents/:documentId/embeddings`
- `POST /api/context/sources/:sourceId/embeddings/mock`
- `GET /api/rag/status`

Error rules:

- `400` invalid params or payload.
- `413` document content exceeds retention policy size.
- `404` missing goal, source or document.
- `409` duplicate document for the same source and normalized content hash, quota conflict, deleted document/source or invalid delete/restore state.

## Contracts

Shared Zod contracts live in `packages/shared/src/index.ts`:

- `ContextSourceTypeSchema`
- `CreateContextSourceSchema`
- `ContextSourceSchema`
- `CreateContextDocumentSchema`
- `ContextDocumentSchema`
- `ContextChunkSchema`
- `DataClassificationSchema`
- `RedactionStatusSchema`
- `SensitiveFindingTypeSchema`
- `SensitiveFindingSchema`
- `RedactionResultSchema`
- `ContextDataPolicySchema`
- `ContextRetentionPolicySchema`
- `ContextAuditEventSchema`
- `DeleteContextDocumentSchema`
- `RestoreContextDocumentSchema`
- `ContextQuotaStatusSchema`
- `RedactionPreviewRequestSchema`
- `ContextSearchSchema`
- `ContextSearchResultSchema`
- `ContextRetrievalSchema`
- `EmbeddingProviderSchema`
- `EmbeddingModelSchema`
- `EmbeddingVectorSchema`
- `ChunkEmbeddingSchema`
- `EmbeddingRequestSchema`
- `EmbeddingResultSchema`
- `GenerateEmbeddingsRequestSchema`
- `RagSearchModeSchema`

All input schemas are strict.

## Acceptance Criteria

- A source can be created for a goal.
- Sources can be listed for a goal.
- A plain text document can be added to a source.
- Document ingestion scans and redacts sensitive data before chunk persistence.
- Restricted content is blocked by policy.
- Oversized documents and quota overages are rejected and audited.
- Ingestion creates deterministic chunks.
- Sensitive chunks do not expose original detected values.
- Chunks can be listed for a document.
- Context search returns relevant chunks by lexical scoring.
- Soft-deleted documents and chunks are excluded from active search.
- Soft-deleted documents can be restored.
- Context audit events are listable per goal.
- Context search accepts `lexical`, `mock_vector` and `hybrid` modes.
- Mock embeddings can be generated for a document or a source.
- Embedding generation is deterministic and idempotent.
- Missing document/source returns `404`.
- Hybrid/mock vector search falls back to lexical when embeddings are unavailable.
- RAG status reports pgvector/local availability without requiring either capability.
- Standard harness does not require pgvector or a local model.
- Every search records a retrieval.
- Duplicate normalized content for the same source returns `409`.
- Runtime `load_context` can retrieve context and continue with no results.
- Dashboard shows sources, documents, chunks, retrievals and `load_context` output.
- Harness validates ingest/search, runtime context loading and duplicate policy.
- Harness validates mock embedding generation, idempotency, fallback and hybrid search.

## Risks

- Lexical ranking is intentionally basic and may miss semantically relevant context.
- Regex redaction is basic and not complete DLP.
- There is no background retention worker yet.
- There is no tenant-level quota customization yet.
- Existing retrieval logs can remain as historical snapshots after later deletion.
- Chunks can grow storage over time.
- Retrieval result JSONB snapshots may become large if limits increase.
- Future external sources need approval and adapter specs before implementation.
