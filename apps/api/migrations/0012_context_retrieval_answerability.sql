ALTER TABLE context_retrievals
  ADD COLUMN IF NOT EXISTS answerability JSONB;
