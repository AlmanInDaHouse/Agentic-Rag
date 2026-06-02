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
      'approval_gate_resolved'
    )
  );

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS requested_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE approval_gates
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'run_command',
  ADD COLUMN IF NOT EXISTS action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE approval_gates
  DROP CONSTRAINT IF EXISTS approval_gates_risk_level_check,
  ADD CONSTRAINT approval_gates_risk_level_check
  CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE approval_gates
  DROP CONSTRAINT IF EXISTS approval_gates_action_type_check,
  ADD CONSTRAINT approval_gates_action_type_check
  CHECK (
    action_type IN (
      'read_context',
      'plan',
      'debate',
      'judge',
      'write_artifact',
      'modify_code',
      'run_command',
      'install_dependency',
      'db_migration',
      'network_request',
      'external_adapter_call',
      'delete_file',
      'git_operation'
    )
  );

CREATE TABLE IF NOT EXISTS execution_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL UNIQUE,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requires_approval boolean NOT NULL,
  blocked_by_default boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO execution_policies (
  action_type,
  risk_level,
  requires_approval,
  blocked_by_default
)
VALUES
  ('read_context', 'low', false, false),
  ('plan', 'low', false, false),
  ('debate', 'low', false, false),
  ('judge', 'low', false, false),
  ('write_artifact', 'medium', false, false),
  ('modify_code', 'high', true, false),
  ('run_command', 'high', true, false),
  ('install_dependency', 'high', true, false),
  ('db_migration', 'high', true, false),
  ('network_request', 'critical', false, true),
  ('external_adapter_call', 'high', true, false),
  ('delete_file', 'critical', false, true),
  ('git_operation', 'high', true, false)
ON CONFLICT (action_type) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action_type ON approval_gates(action_type);
