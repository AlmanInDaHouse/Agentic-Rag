CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'debating', 'decided')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS debate_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  winning_proposal_id uuid,
  judge_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (goal_id, round_number)
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debate_round_id uuid NOT NULL REFERENCES debate_rounds(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (agent_id IN ('codex_architect', 'claude_critic', 'gemini_researcher')),
  proposal text NOT NULL CHECK (char_length(proposal) > 0),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (debate_round_id, agent_id)
);

ALTER TABLE debate_rounds
  ADD CONSTRAINT debate_rounds_winning_proposal_id_fkey
  FOREIGN KEY (winning_proposal_id) REFERENCES agent_proposals(id);

CREATE INDEX IF NOT EXISTS idx_goals_created_at ON goals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debate_rounds_goal_id ON debate_rounds(goal_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_round_id ON agent_proposals(debate_round_id);

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
