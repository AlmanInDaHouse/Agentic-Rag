-- A10-W.8b — integrated runtime persistence.
-- A run + its sequence-numbered event stream are reconstructable from these tables
-- alone (no process memory), which is what enables the UI timeline and restart recovery.

CREATE TABLE IF NOT EXISTS integrated_runs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (
    status IN ('created', 'running', 'completed', 'failed', 'cancelled', 'blocked')
  ),
  spec jsonb NOT NULL,
  owner_provenance jsonb,
  reviewer_provenance jsonb,
  report jsonb,
  terminal_reason text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS integrated_run_events (
  run_id uuid NOT NULL REFERENCES integrated_runs(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  type text NOT NULL,
  provider text,
  provider_version text,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (run_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS integrated_run_events_run_idx
  ON integrated_run_events (run_id, sequence_number);
