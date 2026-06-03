CREATE TABLE embedding_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, provider)
);

CREATE TABLE context_chunk_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES context_chunks(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
  embedding JSONB NOT NULL,
  embedding_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chunk_id, model_id)
);

CREATE INDEX context_chunk_embeddings_chunk_id_idx
  ON context_chunk_embeddings(chunk_id);

CREATE INDEX context_chunk_embeddings_model_id_idx
  ON context_chunk_embeddings(model_id);

CREATE INDEX embedding_models_provider_name_idx
  ON embedding_models(provider, name);

INSERT INTO embedding_models (name, provider, dimension, metadata)
VALUES (
  'mock_embedding_v1',
  'mock',
  32,
  '{"deterministic": true, "semantic": false}'::jsonb
)
ON CONFLICT (name, provider) DO NOTHING;
