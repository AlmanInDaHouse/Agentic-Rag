ALTER TABLE context_documents
  ADD COLUMN classification TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN redaction_status TEXT NOT NULL DEFAULT 'not_scanned',
  ADD COLUMN sensitive_findings JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN redacted_content_hash TEXT;

ALTER TABLE context_chunks
  ADD COLUMN redaction_status TEXT NOT NULL DEFAULT 'not_scanned';

CREATE INDEX context_documents_classification_idx
  ON context_documents(classification);

CREATE INDEX context_documents_redaction_status_idx
  ON context_documents(redaction_status);
