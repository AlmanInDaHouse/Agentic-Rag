-- Opt-in local pgvector setup. Run this manually only against a database/schema
-- intended for pgvector experiments; standard CI and harness do not require it.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS context_chunk_vector_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_embedding_id uuid NOT NULL REFERENCES context_chunk_embeddings(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES context_chunks(id) ON DELETE CASCADE,
  embedding vector(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_context_chunk_vector_embeddings_model_chunk
  ON context_chunk_vector_embeddings(model_id, chunk_id);
