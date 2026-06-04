# ADR 0017: Context Retention, Quota and Deletion Policy

## Status

Accepted

## Context

Context Engine v0 persists sources, documents, chunks and retrieval traces. RAG v1 mock embeddings persist deterministic vectors for chunks. Milestone 1.5C-A added redaction and restricted-content blocking, but storage can still grow indefinitely.

Before pgvector, real local embeddings, external providers or additional context sources are introduced, the platform needs a small data lifecycle policy that limits ingestion, supports deletion and keeps an audit trail.

## Problem

Without retention and quota controls:

- one goal can accumulate unbounded documents and chunks,
- mock embedding rows can grow with chunk count,
- retrieval logs can grow indefinitely,
- users cannot remove stale context from active search,
- deletion has no auditability.

## Decision

Use simple quotas in the API/service layer:

- `maxDocumentsPerGoal`,
- `maxDocumentCharacters`,
- `maxChunksPerDocument`,
- `maxChunkCharacters`,
- `maxRetrievalsPerGoal`,
- `maxEmbeddingRowsPerDocument`.

Use soft delete by default for context documents:

- document, chunk and mock embedding rows receive delete markers,
- active search ignores deleted sources/documents/chunks,
- embedding generation rejects deleted documents and sources.

Allow hard delete only when the active policy allows it, intended for local dev/test. Hard delete writes a best-effort audit event before deleting the document and allowing existing cascades to remove child rows.

Audit events are mandatory for quota rejection, soft delete, restore and hard delete.

No background retention worker is introduced in this milestone.

## Alternatives Considered

### No Limits

Rejected. It would preserve implementation simplicity but allow storage and retrieval traces to grow without bound before the project has production data governance controls.

### Only Hard Delete

Rejected. Hard delete removes operational context but weakens traceability and makes accidental deletion harder to recover from.

### Soft Delete and Audit

Accepted as the default. It preserves traceability, supports restore and lets active search/embedding behavior exclude deleted content without immediate physical removal.

### Automatic Cleanup Worker

Deferred. A worker would require scheduling, retry and operational semantics that are outside this milestone.

## Consequences

- The Context Engine now has basic lifecycle controls.
- Active quotas count non-deleted documents only.
- Deleted documents can be restored, including deterministic mock embedding rows.
- Existing retrieval logs remain historical snapshots and can still mention chunks selected before deletion.
- Service-layer quotas are easy to test but are not yet tenant-configurable.

## Risks Pending

- No background retention worker yet.
- No tenant-specific quota config yet.
- Hard delete audit is best-effort before cascade clears references.
- Existing retrieval snapshots may include content that was later deleted.
- Soft-deleted data remains in the database until hard deleted or future retention pruning is implemented.
