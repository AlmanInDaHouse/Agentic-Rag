ALTER TABLE debate_rounds
  DROP CONSTRAINT IF EXISTS debate_rounds_status_check;

ALTER TABLE debate_rounds
  ADD CONSTRAINT debate_rounds_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

CREATE TABLE IF NOT EXISTS timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN (
      'goal_created',
      'debate_round_started',
      'agent_proposal_created',
      'agent_proposal_failed',
      'judge_decision_created',
      'debate_round_completed',
      'debate_round_failed'
    )
  ),
  message text NOT NULL CHECK (char_length(message) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_events_goal_created_at
  ON timeline_events(goal_id, created_at ASC);
