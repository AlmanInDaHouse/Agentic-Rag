ALTER TABLE timeline_events
  DROP CONSTRAINT IF EXISTS timeline_events_type_check;

ALTER TABLE timeline_events
  ADD CONSTRAINT timeline_events_type_check
  CHECK (
    type IN (
      'goal_created',
      'debate_round_started',
      'agent_proposal_created',
      'agent_proposal_failed',
      'judge_decision_created',
      'debate_round_completed',
      'debate_round_failed',
      'agent_run_created',
      'agent_run_started',
      'agent_step_started',
      'agent_step_succeeded',
      'agent_step_failed',
      'agent_run_completed',
      'agent_run_failed',
      'agent_run_cancelled',
      'agent_run_stopped',
      'agent_run_waiting_for_approval',
      'approval_gate_created',
      'approval_gate_expired',
      'approval_gate_resolved',
      'context_retrieval_created'
    )
  );

CREATE TABLE IF NOT EXISTS context_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES goals(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  type text NOT NULL CHECK (type IN ('manual_text', 'project_note', 'artifact')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS context_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  content_hash text NOT NULL CHECK (char_length(content_hash) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS context_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES context_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (char_length(content) > 0),
  token_estimate integer NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS context_retrievals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES goals(id) ON DELETE CASCADE,
  query text NOT NULL CHECK (char_length(query) > 0),
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_sources_goal_id ON context_sources(goal_id);
CREATE INDEX IF NOT EXISTS idx_context_documents_source_id ON context_documents(source_id);
CREATE INDEX IF NOT EXISTS idx_context_chunks_document_id ON context_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_context_retrievals_goal_id ON context_retrievals(goal_id);
