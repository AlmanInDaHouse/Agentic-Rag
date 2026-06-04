ALTER TABLE context_sources
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_reason TEXT;

ALTER TABLE context_documents
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_reason TEXT,
  ADD COLUMN content_size INTEGER NOT NULL DEFAULT 0 CHECK (content_size >= 0);

ALTER TABLE context_chunks
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_reason TEXT,
  ADD COLUMN content_size INTEGER NOT NULL DEFAULT 0 CHECK (content_size >= 0);

ALTER TABLE context_retrievals
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE context_chunk_embeddings
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE TABLE context_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  source_id UUID REFERENCES context_sources(id) ON DELETE SET NULL,
  document_id UUID REFERENCES context_documents(id) ON DELETE SET NULL,
  chunk_id UUID REFERENCES context_chunks(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system' CHECK (char_length(actor) > 0),
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT context_audit_events_event_type_check
    CHECK (event_type IN (
      'context_source_deleted',
      'context_document_deleted',
      'context_document_restored',
      'context_quota_rejected',
      'context_retention_pruned',
      'context_hard_deleted'
    ))
);

CREATE INDEX context_sources_deleted_at_idx
  ON context_sources(deleted_at);

CREATE INDEX context_documents_source_deleted_at_idx
  ON context_documents(source_id, deleted_at);

CREATE INDEX context_documents_deleted_at_idx
  ON context_documents(deleted_at);

CREATE INDEX context_chunks_document_deleted_at_idx
  ON context_chunks(document_id, deleted_at);

CREATE INDEX context_retrievals_goal_deleted_at_idx
  ON context_retrievals(goal_id, deleted_at);

CREATE INDEX context_chunk_embeddings_deleted_at_idx
  ON context_chunk_embeddings(deleted_at);

CREATE INDEX context_audit_events_goal_created_at_idx
  ON context_audit_events(goal_id, created_at DESC);

CREATE INDEX context_audit_events_document_created_at_idx
  ON context_audit_events(document_id, created_at DESC);
