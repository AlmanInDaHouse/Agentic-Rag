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
      'approval_gate_resolved'
    )
  );

ALTER TABLE approval_gates
  ADD COLUMN IF NOT EXISTS actor_role text;

ALTER TABLE approval_gates
  DROP CONSTRAINT IF EXISTS approval_gates_status_check,
  ADD CONSTRAINT approval_gates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled'));

ALTER TABLE approval_gates
  DROP CONSTRAINT IF EXISTS approval_gates_decision_check,
  ADD CONSTRAINT approval_gates_decision_check
  CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'expired'));

ALTER TABLE approval_gates
  DROP CONSTRAINT IF EXISTS approval_gates_actor_role_check,
  ADD CONSTRAINT approval_gates_actor_role_check
  CHECK (actor_role IS NULL OR actor_role IN ('human_operator', 'admin', 'system'));
