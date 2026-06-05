# Context Retention Policy Spec

## Objective

Prevent unbounded accumulation of context sources, documents, chunks, mock embeddings and retrieval logs before pgvector, real embeddings or external context sources are introduced.

Milestone 1.5C-B adds basic quota, deletion and audit controls around the existing Context Engine and RAG mock embedding boundary.

## Scope

- Context documents and chunks created from `manual_text`, `project_note` and `artifact` sources.
- Basic quota validation at API/service ingestion time.
- Soft delete and restore for context documents.
- Deleted documents/chunks excluded from active search and embedding generation.
- Audit events for quota rejection, deletion, restore and hard delete.
- Dashboard visibility for quota, deleted status and audit events.

## Out of Scope

- pgvector.
- Real embedding models.
- Ollama.
- External providers.
- GraphRAG.
- Code Graph.
- External context sources.
- Real authentication.
- Tenant-specific quota configuration.
- Background retention workers.

## Initial Policy

```ts
{
  maxDocumentsPerGoal: 100,
  maxDocumentCharacters: 200000,
  maxChunksPerDocument: 500,
  maxChunkCharacters: 2000,
  maxRetrievalsPerGoal: 1000,
  maxEmbeddingRowsPerDocument: 500,
  hardDeleteAllowed: true only outside production,
  softDeleteDefault: true
}
```

Active document quota excludes soft-deleted documents. Duplicate detection can still see deleted rows because original content hashes remain part of auditability and idempotency.

## Retention Rules

- Document ingestion validates normalized content length before redaction and persistence.
- A document over `maxDocumentCharacters` returns `413 Payload Too Large`.
- A goal at `maxDocumentsPerGoal` active documents returns `409 Conflict`.
- Chunk drafts are validated before chunk rows are persisted.
- A document that would exceed `maxChunksPerDocument` returns `409 Conflict`.
- A chunk over `maxChunkCharacters` returns `409 Conflict`.
- Quota rejections always write `context_quota_rejected`.
- Retrievals are counted for quota status, but this milestone does not prune them automatically.

## Deletion Rules

Soft delete is the default:

- mark `context_documents.deleted_at/deleted_reason`,
- mark attached `context_chunks.deleted_at/deleted_reason`,
- mark attached `context_chunk_embeddings.deleted_at`,
- write `context_document_deleted`.

Restore:

- clears document and chunk delete markers,
- restores attached mock embedding rows by clearing `deleted_at`,
- writes `context_document_restored`.

Hard delete:

- allowed only when the active policy allows it, intended for local dev/test,
- writes `context_hard_deleted` before deleting the document,
- relies on existing database cascades for chunks and embeddings.

No document deletion is valid without a matching audit event.

## Search Rules

Active lexical, mock-vector and hybrid search must ignore:

- deleted sources,
- deleted documents,
- deleted chunks.

Existing retrieval logs may remain as historical snapshots. New retrievals must not include deleted chunks.

## Embedding Rules

- Deleted documents return `409 Conflict` for document embedding generation and coverage/list operations.
- Deleted sources return `409 Conflict` for source embedding generation.
- Deleted chunks are skipped.
- Restored mock embedding rows are considered reusable because this milestone uses deterministic local mock embeddings over already persisted chunk text.

## HTTP API

```text
GET /api/goals/:goalId/context/quota
GET /api/goals/:goalId/context/audit-events
DELETE /api/context/documents/:documentId
POST /api/context/documents/:documentId/restore
```

Delete payload:

```json
{
  "actor": "human_operator",
  "reason": "cleanup",
  "hardDelete": false
}
```

Restore payload:

```json
{
  "actor": "human_operator",
  "reason": "restore for test"
}
```

Payloads are strict. `actor` is required and non-empty. `reason` is optional but recommended.

## Audit Events

Minimum event types:

```text
context_source_deleted
context_document_deleted
context_document_restored
context_quota_rejected
context_retention_pruned
context_hard_deleted
```

Audit rows must not store raw document content or secrets.

## Acceptance Criteria

- Retention policy contracts exist in shared Zod schemas.
- Migration adds delete markers, content sizes and audit events.
- Oversized document ingestion returns `413` and writes an audit event.
- Goal document quota returns `409` and writes an audit event.
- Soft delete marks documents/chunks/embeddings deleted.
- Deleted documents/chunks are excluded from search.
- Deleted documents cannot generate embeddings.
- Restore makes the document searchable again.
- Audit events are listable by goal.
- Dashboard shows quota, deleted status and audit events.
- Harness covers quota rejection, soft delete, restore, search exclusion and audit events.

## Risks

- No background retention worker yet.
- Hard delete audit is best-effort before database cascade clears document references.
- No tenant-specific quota configuration yet.
- Existing retrieval snapshots can still reference content that was later deleted.
