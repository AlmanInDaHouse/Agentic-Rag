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
      'approval_gate_created',
      'approval_gate_resolved'
    )
  );

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'created' CHECK (
    status IN (
      'created',
      'queued',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled',
      'stopped'
    )
  ),
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 3 AND 5000),
  definition_of_done jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step_index integer NOT NULL DEFAULT 0 CHECK (current_step_index >= 0),
  max_steps integer NOT NULL DEFAULT 12 CHECK (max_steps > 0),
  max_failures integer NOT NULL DEFAULT 3 CHECK (max_failures >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index integer NOT NULL CHECK (step_index >= 0),
  type text NOT NULL CHECK (
    type IN (
      'load_context',
      'plan',
      'debate',
      'judge',
      'execute_mock_task',
      'validate',
      'summarize'
    )
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'running',
      'succeeded',
      'failed',
      'skipped',
      'waiting_for_approval',
      'cancelled'
    )
  ),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_steps(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'cancelled')
  ),
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  decision text
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_goal_id ON agent_runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_approval_gates_run_id ON approval_gates(run_id);
