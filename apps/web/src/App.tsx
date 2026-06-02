import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunWithDetails,
  DebateRoundWithProposals,
  Goal,
  TimelineEvent
} from "@triforge/shared";
import {
  advanceRun,
  cancelRun,
  createGoal,
  createRun,
  getLatestDebate,
  getRun,
  getTimeline,
  listGoals,
  listRuns,
  runDebate,
  startRun
} from "./api.js";

type DebateByGoal = Record<string, DebateRoundWithProposals>;
type TimelineByGoal = Record<string, TimelineEvent[]>;
type RunsByGoal = Record<string, AgentRun[]>;
type RunDetailsById = Record<string, AgentRunWithDetails>;

const agentLabels: Record<string, string> = {
  codex_architect: "Codex Architect",
  claude_critic: "Claude Critic",
  gemini_researcher: "Gemini Researcher"
};

const terminalRunStatuses = new Set<AgentRunStatus>([
  "completed",
  "failed",
  "cancelled",
  "stopped"
]);

export function App() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [debates, setDebates] = useState<DebateByGoal>({});
  const [timelines, setTimelines] = useState<TimelineByGoal>({});
  const [runsByGoal, setRunsByGoal] = useState<RunsByGoal>({});
  const [runDetails, setRunDetails] = useState<RunDetailsById>({});
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
  const selectedRuns = selectedGoal ? runsByGoal[selectedGoal.id] ?? [] : [];
  const selectedRun = selectedRunId ? runDetails[selectedRunId] : null;

  async function refreshGoals() {
    const nextGoals = await listGoals();
    setGoals(nextGoals);
    setSelectedGoalId((current) => current ?? nextGoals[0]?.id ?? null);
  }

  async function refreshGoalRuntime(goalId: string) {
    const [events, runs] = await Promise.all([getTimeline(goalId), listRuns(goalId)]);
    setTimelines((current) => ({ ...current, [goalId]: events }));
    setRunsByGoal((current) => ({ ...current, [goalId]: runs }));
    setSelectedRunId((current) => {
      if (current && runs.some((run) => run.id === current)) {
        return current;
      }
      return runs[0]?.id ?? null;
    });
  }

  function storeRun(run: AgentRunWithDetails) {
    setRunDetails((current) => ({ ...current, [run.id]: run }));
    setRunsByGoal((current) => {
      const existing = current[run.goalId] ?? [];
      const next = existing.some((item) => item.id === run.id)
        ? existing.map((item) => (item.id === run.id ? run : item))
        : [run, ...existing];
      return { ...current, [run.goalId]: next };
    });
    setSelectedRunId(run.id);
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

    refreshGoalRuntime(selectedGoal.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load runtime state");
    });
  }, [selectedGoal]);

  useEffect(() => {
    if (!selectedRunId || runDetails[selectedRunId]) {
      return;
    }

    getRun(selectedRunId)
      .then(storeRun)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load run");
      });
  }, [runDetails, selectedRunId]);

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
      await refreshGoalRuntime(goal.id);
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
      await refreshGoalRuntime(goalId);
      await refreshGoals();
      setSelectedGoalId(goalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run debate");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateRun(goal: Goal) {
    setIsLoading(true);
    setError(null);
    try {
      const run = await createRun(goal.id, {
        objective: `Advance goal: ${goal.title}`,
        definitionOfDone: ["Mock runtime reaches summarize step."],
        budget: { maxSteps: 12, maxFailures: 3 }
      });
      storeRun(run);
      await refreshGoalRuntime(goal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRunAction(action: (runId: string) => Promise<AgentRunWithDetails>) {
    if (!selectedRun) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const run = await action(selectedRun.id);
      storeRun(run);
      await refreshGoalRuntime(run.goalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update run");
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
                <div className="button-row">
                  <button onClick={() => handleCreateRun(selectedGoal)} disabled={isLoading}>
                    Create run
                  </button>
                  <button onClick={() => handleRunDebate(selectedGoal.id)} disabled={isLoading}>
                    Launch debate
                  </button>
                </div>
              </div>

              <div className="runtime">
                <div className="section-heading">
                  <p className="eyebrow">Runtime</p>
                  <h3>Agent runs</h3>
                </div>
                {selectedRuns.length === 0 ? <p className="muted">No runs for this goal.</p> : null}
                <div className="run-list">
                  {selectedRuns.map((run) => (
                    <button
                      key={run.id}
                      className={run.id === selectedRunId ? "run-item active" : "run-item"}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span>{run.objective}</span>
                      <small>
                        {run.status} · step {run.currentStepIndex}
                      </small>
                    </button>
                  ))}
                </div>

                {selectedRun ? (
                  <div className="run-detail">
                    <div className="run-actions">
                      <strong>{selectedRun.status}</strong>
                      <button
                        className="secondary"
                        onClick={() => handleRunAction(startRun)}
                        disabled={
                          isLoading ||
                          (selectedRun.status !== "created" && selectedRun.status !== "queued")
                        }
                      >
                        Start run
                      </button>
                      <button
                        className="secondary"
                        onClick={() => handleRunAction(advanceRun)}
                        disabled={isLoading || selectedRun.status !== "running"}
                      >
                        Advance one step
                      </button>
                      <button
                        className="secondary"
                        onClick={() => handleRunAction(cancelRun)}
                        disabled={isLoading || terminalRunStatuses.has(selectedRun.status)}
                      >
                        Cancel run
                      </button>
                    </div>
                    <ol className="step-list">
                      {selectedRun.steps.map((step) => (
                        <li key={step.id}>
                          <span>{step.type}</span>
                          <small>{step.status}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
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
