ALTER TABLE embedding_models
  ADD COLUMN IF NOT EXISTS storage_kind TEXT NOT NULL DEFAULT 'jsonb';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'embedding_models_storage_kind_check'
      AND conrelid = 'embedding_models'::regclass
  ) THEN
    ALTER TABLE embedding_models
      ADD CONSTRAINT embedding_models_storage_kind_check
      CHECK (storage_kind IN ('jsonb', 'pgvector'));
  END IF;
END $$;

UPDATE embedding_models
SET
  storage_kind = COALESCE(storage_kind, 'jsonb'),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'pgvectorAvailableAtMigration',
    EXISTS (
      SELECT 1
      FROM pg_available_extensions
      WHERE name = 'vector'
    )
  )
WHERE storage_kind IS NULL
   OR NOT metadata ? 'pgvectorAvailableAtMigration';
