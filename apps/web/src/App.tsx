import { FormEvent, useEffect, useMemo, useState } from "react";
import type { DebateRoundWithProposals, Goal, TimelineEvent } from "@triforge/shared";
import { createGoal, getLatestDebate, getTimeline, listGoals, runDebate } from "./api.js";

type DebateByGoal = Record<string, DebateRoundWithProposals>;
type TimelineByGoal = Record<string, TimelineEvent[]>;

const agentLabels: Record<string, string> = {
  codex_architect: "Codex Architect",
  claude_critic: "Claude Critic",
  gemini_researcher: "Gemini Researcher"
};

export function App() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [debates, setDebates] = useState<DebateByGoal>({});
  const [timelines, setTimelines] = useState<TimelineByGoal>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGoal = useMemo(
    () => goals.find((goal) => goal.id === selectedGoalId) ?? goals[0] ?? null,
    [goals, selectedGoalId]
  );
  const selectedDebate = selectedGoal ? debates[selectedGoal.id] : null;
  const selectedTimeline = selectedGoal ? timelines[selectedGoal.id] ?? [] : [];

  async function refreshGoals() {
    const nextGoals = await listGoals();
    setGoals(nextGoals);
    setSelectedGoalId((current) => current ?? nextGoals[0]?.id ?? null);
  }

  useEffect(() => {
    refreshGoals().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load goals");
    });
  }, []);

  useEffect(() => {
    if (!selectedGoal || debates[selectedGoal.id]) {
      return;
    }

    getLatestDebate(selectedGoal.id)
      .then((debate) => {
        if (debate) {
          setDebates((current) => ({ ...current, [selectedGoal.id]: debate }));
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load debate");
      });
  }, [debates, selectedGoal]);

  useEffect(() => {
    if (!selectedGoal) {
      return;
    }

    getTimeline(selectedGoal.id)
      .then((events) => {
        setTimelines((current) => ({ ...current, [selectedGoal.id]: events }));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load timeline");
      });
  }, [selectedGoal]);

  async function handleCreateGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const goal = await createGoal({ title, description });
      setGoals((current) => [goal, ...current]);
      setSelectedGoalId(goal.id);
      setTitle("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goal");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRunDebate(goalId: string) {
    setIsLoading(true);
    setError(null);
    try {
      const debate = await runDebate(goalId);
      setDebates((current) => ({ ...current, [goalId]: debate }));
      const events = await getTimeline(goalId);
      setTimelines((current) => ({ ...current, [goalId]: events }));
      await refreshGoals();
      setSelectedGoalId(goalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run debate");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">TriForge Agentic Lab</p>
          <h1>Agent debate dashboard</h1>
        </div>
        <button className="secondary" onClick={() => refreshGoals()} disabled={isLoading}>
          Refresh
        </button>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <section className="layout">
        <aside className="panel">
          <h2>Create goal</h2>
          <form onSubmit={handleCreateGoal} className="goal-form">
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
              />
            </label>
            <button disabled={isLoading || title.trim().length < 3 || description.trim().length < 10}>
              Create goal
            </button>
          </form>

          <h2>Goals</h2>
          <div className="goal-list">
            {goals.length === 0 ? <p className="muted">No goals yet.</p> : null}
            {goals.map((goal) => (
              <button
                key={goal.id}
                className={goal.id === selectedGoal?.id ? "goal-item active" : "goal-item"}
                onClick={() => setSelectedGoalId(goal.id)}
              >
                <span>{goal.title}</span>
                <small>{goal.status}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="workspace">
          {selectedGoal ? (
            <>
              <div className="goal-header">
                <div>
                  <p className="eyebrow">{selectedGoal.status}</p>
                  <h2>{selectedGoal.title}</h2>
                  <p>{selectedGoal.description}</p>
                </div>
                <button onClick={() => handleRunDebate(selectedGoal.id)} disabled={isLoading}>
                  Launch debate
                </button>
              </div>

              {selectedDebate ? (
                <div className="debate">
                  <div className="decision">
                    <p className="eyebrow">Final decision</p>
                    <h3>Round {selectedDebate.roundNumber}</h3>
                    <p>{selectedDebate.judgeRationale}</p>
                  </div>

                  <div className="proposal-grid">
                    {selectedDebate.proposals.map((proposal) => (
                      <article
                        key={proposal.id}
                        className={
                          proposal.id === selectedDebate.winningProposalId
                            ? "proposal winner"
                            : "proposal"
                        }
                      >
                        <div className="proposal-title">
                          <h3>{agentLabels[proposal.agentId]}</h3>
                          <span>{proposal.confidence.toFixed(3)}</span>
                        </div>
                        <p>{proposal.proposal}</p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-state">Launch a debate to see proposals and a judge decision.</div>
              )}

              <div className="timeline">
                <div className="section-heading">
                  <p className="eyebrow">Timeline</p>
                  <h3>Goal events</h3>
                </div>
                {selectedTimeline.length === 0 ? (
                  <p className="muted">No events recorded.</p>
                ) : (
                  <ol>
                    {selectedTimeline.map((event) => (
                      <li key={event.id}>
                        <span>{event.type}</span>
                        <p>{event.message}</p>
                        <small>{new Date(event.createdAt).toLocaleString()}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Create a goal to start.</div>
          )}
        </section>
      </section>
    </main>
  );
}
