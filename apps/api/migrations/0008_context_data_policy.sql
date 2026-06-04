ALTER TABLE context_documents
  ADD COLUMN classification TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN redaction_status TEXT NOT NULL DEFAULT 'not_scanned',
  ADD COLUMN sensitive_findings JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN redacted_content_hash TEXT;

ALTER TABLE context_documents
  ADD CONSTRAINT context_documents_classification_check
    CHECK (classification IN ('public', 'internal', 'confidential', 'secret', 'restricted')),
  ADD CONSTRAINT context_documents_redaction_status_check
    CHECK (redaction_status IN ('not_scanned', 'clean', 'redacted', 'blocked'));

ALTER TABLE context_chunks
  ADD COLUMN redaction_status TEXT NOT NULL DEFAULT 'not_scanned';

ALTER TABLE context_chunks
  ADD CONSTRAINT context_chunks_redaction_status_check
    CHECK (redaction_status IN ('not_scanned', 'clean', 'redacted', 'blocked'));

CREATE INDEX context_documents_classification_idx
  ON context_documents(classification);

CREATE INDEX context_documents_redaction_status_idx
  ON context_documents(redaction_status);
