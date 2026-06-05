import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunWithDetails,
  ContextAuditEvent,
  ContextChunk,
  ContextDocument,
  ContextQuotaStatus,
  ContextRetrieval,
  ContextSource,
  ContextSourceType,
  DebateRoundWithProposals,
  EmbeddingModel,
  Goal,
  RagSearchMode,
  RedactionResult,
  TimelineEvent
} from "@triforge/shared";
import {
  advanceRun,
  addContextDocument,
  approveGate,
  createContextSource,
  cancelRun,
  createGoal,
  createRun,
  deleteContextDocument,
  generateDocumentMockEmbeddings,
  generateSourceMockEmbeddings,
  getContextQuota,
  getDocumentEmbeddingCoverage,
  getLatestDebate,
  getRun,
  getTimeline,
  listEmbeddingModels,
  listContextChunks,
  listContextAuditEvents,
  listContextDocuments,
  listContextRetrievals,
  listContextSources,
  listGoals,
  listRuns,
  previewContextRedaction,
  rejectGate,
  restoreContextDocument,
  runDebate,
  searchContext,
  startRun,
  type DocumentEmbeddingCoverageResponse
} from "./api.js";

type DebateByGoal = Record<string, DebateRoundWithProposals>;
type TimelineByGoal = Record<string, TimelineEvent[]>;
type RunsByGoal = Record<string, AgentRun[]>;
type RunDetailsById = Record<string, AgentRunWithDetails>;
type ContextSourcesByGoal = Record<string, ContextSource[]>;
type ContextDocumentsBySource = Record<string, ContextDocument[]>;
type ContextChunksByDocument = Record<string, ContextChunk[]>;
type ContextRetrievalsByGoal = Record<string, ContextRetrieval[]>;
type ContextAuditEventsByGoal = Record<string, ContextAuditEvent[]>;
type ContextQuotaByGoal = Record<string, ContextQuotaStatus>;
type EmbeddingCoverageByDocument = Record<string, DocumentEmbeddingCoverageResponse>;
type ApprovalActorRole = "human_operator" | "admin" | "system";

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
  const [contextSources, setContextSources] = useState<ContextSourcesByGoal>({});
  const [contextDocuments, setContextDocuments] = useState<ContextDocumentsBySource>({});
  const [contextChunks, setContextChunks] = useState<ContextChunksByDocument>({});
  const [contextRetrievals, setContextRetrievals] = useState<ContextRetrievalsByGoal>({});
  const [contextAuditEvents, setContextAuditEvents] = useState<ContextAuditEventsByGoal>({});
  const [contextQuota, setContextQuota] = useState<ContextQuotaByGoal>({});
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModel[]>([]);
  const [embeddingCoverage, setEmbeddingCoverage] = useState<EmbeddingCoverageByDocument>({});
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contextSourceName, setContextSourceName] = useState("");
  const [contextSourceType, setContextSourceType] =
    useState<ContextSourceType>("manual_text");
  const [contextDocumentTitle, setContextDocumentTitle] = useState("");
  const [contextDocumentContent, setContextDocumentContent] = useState("");
  const [redactionPreview, setRedactionPreview] = useState<RedactionResult | null>(null);
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [contextSearchMode, setContextSearchMode] = useState<RagSearchMode>("lexical");
  const [approvalActorRole, setApprovalActorRole] =
    useState<ApprovalActorRole>("human_operator");
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
  const selectedContextSources = selectedGoal ? contextSources[selectedGoal.id] ?? [] : [];
  const selectedSource =
    selectedContextSources.find((source) => source.id === selectedSourceId) ??
    selectedContextSources[0] ??
    null;
  const selectedDocuments = selectedSource ? contextDocuments[selectedSource.id] ?? [] : [];
  const selectedDocument =
    selectedDocuments.find((document) => document.id === selectedDocumentId) ??
    selectedDocuments[0] ??
    null;
  const selectedChunks = selectedDocument ? contextChunks[selectedDocument.id] ?? [] : [];
  const selectedRetrievals = selectedGoal ? contextRetrievals[selectedGoal.id] ?? [] : [];
  const selectedAuditEvents = selectedGoal ? contextAuditEvents[selectedGoal.id] ?? [] : [];
  const selectedQuota = selectedGoal ? contextQuota[selectedGoal.id] : null;
  const selectedEmbeddingCoverage = selectedDocument ? embeddingCoverage[selectedDocument.id] : null;
  const selectedRunHasPendingGate =
    selectedRun?.approvalGates.some((gate) => gate.status === "pending") ?? false;

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

  async function refreshGoalContext(goalId: string) {
    const [sources, retrievals, quota, auditEvents] = await Promise.all([
      listContextSources(goalId),
      listContextRetrievals(goalId),
      getContextQuota(goalId),
      listContextAuditEvents(goalId)
    ]);
    setContextSources((current) => ({ ...current, [goalId]: sources }));
    setContextRetrievals((current) => ({ ...current, [goalId]: retrievals }));
    setContextQuota((current) => ({ ...current, [goalId]: quota }));
    setContextAuditEvents((current) => ({ ...current, [goalId]: auditEvents }));
    setSelectedSourceId((current) => {
      if (current && sources.some((source) => source.id === current)) {
        return current;
      }
      return sources[0]?.id ?? null;
    });
  }

  async function refreshSourceDocuments(sourceId: string) {
    const documents = await listContextDocuments(sourceId);
    setContextDocuments((current) => ({ ...current, [sourceId]: documents }));
    setSelectedDocumentId((current) => {
      if (current && documents.some((document) => document.id === current)) {
        return current;
      }
      return documents[0]?.id ?? null;
    });
  }

  async function refreshDocumentChunks(documentId: string) {
    const chunks = await listContextChunks(documentId);
    setContextChunks((current) => ({ ...current, [documentId]: chunks }));
  }

  async function refreshEmbeddingModels() {
    const models = await listEmbeddingModels();
    setEmbeddingModels(models);
  }

  async function refreshDocumentEmbeddingCoverage(documentId: string) {
    const coverage = await getDocumentEmbeddingCoverage(documentId);
    setEmbeddingCoverage((current) => ({ ...current, [documentId]: coverage }));
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
    refreshEmbeddingModels().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load embedding models");
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
    refreshGoalContext(selectedGoal.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load context");
    });
  }, [selectedGoal]);

  useEffect(() => {
    if (!selectedSource || contextDocuments[selectedSource.id]) {
      return;
    }

    refreshSourceDocuments(selectedSource.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load context documents");
    });
  }, [contextDocuments, selectedSource]);

  useEffect(() => {
    if (!selectedDocument || contextChunks[selectedDocument.id]) {
      return;
    }

    refreshDocumentChunks(selectedDocument.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load context chunks");
    });
  }, [contextChunks, selectedDocument]);

  useEffect(() => {
    if (!selectedDocument || embeddingCoverage[selectedDocument.id]) {
      return;
    }

    refreshDocumentEmbeddingCoverage(selectedDocument.id).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load embedding coverage");
    });
  }, [embeddingCoverage, selectedDocument]);

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
      await refreshGoalContext(goal.id);
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
        requestedActions: [],
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

  async function handleGateAction(
    gateId: string,
    action: (
      gateId: string,
      input: { resolvedBy: string; actorRole: ApprovalActorRole; reason: string }
    ) => Promise<AgentRunWithDetails>,
    reason: string
  ) {
    setIsLoading(true);
    setError(null);
    try {
      const run = await action(gateId, {
        resolvedBy: "human",
        actorRole: approvalActorRole,
        reason
      });
      storeRun(run);
      await refreshGoalRuntime(run.goalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve approval gate");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateContextSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGoal) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const source = await createContextSource(selectedGoal.id, {
        name: contextSourceName,
        type: contextSourceType,
        metadata: {}
      });
      setContextSourceName("");
      setSelectedSourceId(source.id);
      await refreshGoalContext(selectedGoal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create context source");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddContextDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGoal || !selectedSource) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await addContextDocument(selectedSource.id, {
        title: contextDocumentTitle,
        content: contextDocumentContent,
        metadata: {}
      });
      setContextDocumentTitle("");
      setContextDocumentContent("");
      setRedactionPreview(null);
      setSelectedDocumentId(result.document.id);
      await refreshSourceDocuments(selectedSource.id);
      await refreshDocumentChunks(result.document.id);
      await refreshGoalContext(selectedGoal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add context document");
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePreviewRedaction() {
    if (contextDocumentContent.trim().length === 0) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const preview = await previewContextRedaction({ content: contextDocumentContent });
      setRedactionPreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview redaction");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSearchContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGoal) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await searchContext(selectedGoal.id, {
        query: contextSearchQuery,
        limit: 5,
        mode: contextSearchMode
      });
      await refreshGoalContext(selectedGoal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search context");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteContextDocument() {
    if (!selectedGoal || !selectedSource || !selectedDocument) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await deleteContextDocument(selectedDocument.id, {
        actor: "human_operator",
        reason: "dashboard cleanup",
        hardDelete: false
      });
      await refreshSourceDocuments(selectedSource.id);
      await refreshDocumentChunks(selectedDocument.id);
      await refreshGoalContext(selectedGoal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete context document");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRestoreContextDocument() {
    if (!selectedGoal || !selectedSource || !selectedDocument) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await restoreContextDocument(selectedDocument.id, {
        actor: "human_operator",
        reason: "dashboard restore"
      });
      await refreshSourceDocuments(selectedSource.id);
      await refreshDocumentChunks(selectedDocument.id);
      await refreshGoalContext(selectedGoal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore context document");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateDocumentEmbeddings() {
    if (!selectedDocument) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await generateDocumentMockEmbeddings(selectedDocument.id);
      await refreshEmbeddingModels();
      await refreshDocumentEmbeddingCoverage(selectedDocument.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate document embeddings");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateSourceEmbeddings() {
    if (!selectedSource || !selectedDocument) {
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await generateSourceMockEmbeddings(selectedSource.id);
      await refreshEmbeddingModels();
      await refreshDocumentEmbeddingCoverage(selectedDocument.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate source embeddings");
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
                        {run.status} - step {run.currentStepIndex}
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
                        disabled={
                          isLoading ||
                          selectedRun.status !== "running" ||
                          selectedRunHasPendingGate
                        }
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
                    <div className="gate-list">
                      <label className="gate-role">
                        Approval role
                        <select
                          value={approvalActorRole}
                          onChange={(event) =>
                            setApprovalActorRole(event.target.value as ApprovalActorRole)
                          }
                        >
                          <option value="human_operator">human_operator</option>
                          <option value="admin">admin</option>
                          <option value="system">system</option>
                        </select>
                      </label>
                      {selectedRun.approvalGates.length === 0 ? (
                        <p className="muted">No approval gates for this run.</p>
                      ) : null}
                      {selectedRun.approvalGates.map((gate) => (
                        <div key={gate.id} className="gate-item">
                          <div>
                            <span>{gate.actionType}</span>
                            <small>
                              {gate.riskLevel} / {gate.status}
                            </small>
                            <small>
                              {gate.expiresAt
                                ? `expires ${new Date(gate.expiresAt).toLocaleString()}`
                                : "no expiry"}
                            </small>
                            {gate.actorRole ? <small>resolved by {gate.actorRole}</small> : null}
                          </div>
                          {gate.status === "pending" ? (
                            <div className="button-row">
                              <button
                                className="secondary"
                                onClick={() =>
                                  handleGateAction(
                                    gate.id,
                                    approveGate,
                                    "Approved for mock execution"
                                  )
                                }
                                disabled={isLoading}
                              >
                                Approve
                              </button>
                              <button
                                className="secondary danger"
                                onClick={() =>
                                  handleGateAction(
                                    gate.id,
                                    rejectGate,
                                    "Rejected from dashboard"
                                  )
                                }
                                disabled={isLoading}
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <ol className="step-list">
                      {selectedRun.steps.map((step) => (
                        <li key={step.id}>
                          <div>
                            <span>{step.type}</span>
                            {step.type === "load_context" && step.output ? (
                              <small>
                                {Array.isArray(step.output.results)
                                  ? `${step.output.results.length} context result(s)`
                                  : "context loaded"}
                              </small>
                            ) : null}
                          </div>
                          <small>{step.status}</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>

              <div className="context-panel">
                <div className="section-heading">
                  <p className="eyebrow">Context</p>
                  <h3>Sources and retrievals</h3>
                </div>
                {selectedQuota ? (
                  <div className="quota-panel">
                    <div>
                      <strong>Quota</strong>
                      <small>
                        {selectedQuota.activeDocuments}/{selectedQuota.maxDocumentsPerGoal} active documents
                      </small>
                    </div>
                    <div>
                      <strong>Retrieval history</strong>
                      <small>
                        {selectedQuota.retrievals}/{selectedQuota.maxRetrievalsPerGoal}
                        {selectedQuota.shouldPruneRetrievals ? " / prune recommended" : ""}
                      </small>
                    </div>
                    <div>
                      <strong>Document size</strong>
                      <small>{selectedQuota.policy.maxDocumentCharacters} characters max</small>
                    </div>
                  </div>
                ) : null}
                <div className="context-grid">
                  <form onSubmit={handleCreateContextSource} className="context-form">
                    <label>
                      Source name
                      <input
                        value={contextSourceName}
                        onChange={(event) => setContextSourceName(event.target.value)}
                      />
                    </label>
                    <label>
                      Source type
                      <select
                        value={contextSourceType}
                        onChange={(event) =>
                          setContextSourceType(event.target.value as ContextSourceType)
                        }
                      >
                        <option value="manual_text">manual_text</option>
                        <option value="project_note">project_note</option>
                        <option value="artifact">artifact</option>
                      </select>
                    </label>
                    <button disabled={isLoading || contextSourceName.trim().length === 0}>
                      Create source
                    </button>
                  </form>

                  <form onSubmit={handleAddContextDocument} className="context-form">
                    <label>
                      Document title
                      <input
                        value={contextDocumentTitle}
                        onChange={(event) => setContextDocumentTitle(event.target.value)}
                        disabled={!selectedSource}
                      />
                    </label>
                    <label>
                      Plain text
                      <textarea
                        value={contextDocumentContent}
                        onChange={(event) => setContextDocumentContent(event.target.value)}
                        rows={5}
                        disabled={!selectedSource}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={handlePreviewRedaction}
                        disabled={isLoading || contextDocumentContent.trim().length === 0}
                      >
                        Preview redaction
                      </button>
                    </div>
                    {redactionPreview ? (
                      <div className="policy-preview">
                        <small>
                          {redactionPreview.classification} / {redactionPreview.redactionStatus} / {redactionPreview.findings.length} finding(s)
                        </small>
                        {redactionPreview.redactionStatus === "redacted" || redactionPreview.redactionStatus === "blocked" ? (
                          <p>{redactionPreview.redactedContent}</p>
                        ) : null}
                      </div>
                    ) : null}
                    <button
                      disabled={
                        isLoading ||
                        !selectedSource ||
                        contextDocumentTitle.trim().length === 0 ||
                        contextDocumentContent.trim().length === 0
                      }
                    >
                      Add document
                    </button>
                  </form>

                  <form onSubmit={handleSearchContext} className="context-form">
                    <label>
                      Search query
                      <input
                        value={contextSearchQuery}
                        onChange={(event) => setContextSearchQuery(event.target.value)}
                      />
                    </label>
                    <label>
                      Mode
                      <select
                        value={contextSearchMode}
                        onChange={(event) =>
                          setContextSearchMode(event.target.value as RagSearchMode)
                        }
                      >
                        <option value="lexical">lexical</option>
                        <option value="mock_vector">mock_vector</option>
                        <option value="hybrid">hybrid</option>
                      </select>
                    </label>
                    <button disabled={isLoading || contextSearchQuery.trim().length === 0}>
                      Search context
                    </button>
                  </form>
                </div>

                <div className="embedding-panel">
                  <div>
                    <h4>Embedding models</h4>
                    {embeddingModels.length === 0 ? (
                      <p className="muted">No embedding models registered.</p>
                    ) : null}
                    {embeddingModels.map((model) => (
                      <div key={model.id} className="embedding-item">
                        <span>{model.name}</span>
                        <small>
                          {model.provider} / {model.dimension}d / {model.isActive ? "active" : "inactive"}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4>Mock embeddings</h4>
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={handleGenerateDocumentEmbeddings}
                        disabled={isLoading || !selectedDocument || Boolean(selectedDocument.deletedAt)}
                      >
                        Generate document
                      </button>
                      <button
                        className="secondary"
                        onClick={handleGenerateSourceEmbeddings}
                        disabled={isLoading || !selectedSource}
                      >
                        Generate source
                      </button>
                    </div>
                    {selectedEmbeddingCoverage ? (
                      <p className="muted">
                        {selectedEmbeddingCoverage.embeddedChunkCount}/{selectedEmbeddingCoverage.chunkCount} chunks embedded
                      </p>
                    ) : (
                      <p className="muted">Select a document to view coverage.</p>
                    )}
                  </div>
                </div>

                <div className="context-lists">
                  <div>
                    <h4>Sources</h4>
                    {selectedContextSources.length === 0 ? (
                      <p className="muted">No context sources.</p>
                    ) : null}
                    {selectedContextSources.map((source) => (
                      <button
                        key={source.id}
                        className={source.id === selectedSource?.id ? "context-item active" : "context-item"}
                        onClick={() => setSelectedSourceId(source.id)}
                      >
                        <span>{source.name}</span>
                        <small>{source.type}</small>
                      </button>
                    ))}
                  </div>
                  <div>
                    <h4>Documents</h4>
                    {selectedDocuments.length === 0 ? (
                      <p className="muted">No documents for this source.</p>
                    ) : null}
                    {selectedDocuments.map((document) => (
                      <button
                        key={document.id}
                        className={
                          document.id === selectedDocument?.id ? "context-item active" : "context-item"
                        }
                        onClick={() => setSelectedDocumentId(document.id)}
                      >
                        <span>{document.title}</span>
                        <small>
                          {document.classification} / {document.redactionStatus} / {document.sensitiveFindings.length} finding(s)
                        </small>
                        {document.deletedAt ? <small>deleted / {document.deletedReason ?? "no reason"}</small> : null}
                        <small>{document.contentSize} characters</small>
                        <small>{document.contentHash.slice(0, 12)}</small>
                      </button>
                    ))}
                  </div>
                  <div>
                    <h4>Chunks</h4>
                    {selectedDocument ? (
                      <div className="document-actions">
                        <div>
                          <strong>{selectedDocument.deletedAt ? "Deleted" : "Active"}</strong>
                          <small>
                            {selectedDocument.deletedAt
                              ? new Date(selectedDocument.deletedAt).toLocaleString()
                              : `${selectedDocument.contentSize} characters`}
                          </small>
                        </div>
                        {selectedDocument.deletedAt ? (
                          <button
                            className="secondary"
                            onClick={handleRestoreContextDocument}
                            disabled={isLoading}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            className="secondary danger"
                            onClick={handleDeleteContextDocument}
                            disabled={isLoading}
                          >
                            Soft delete
                          </button>
                        )}
                      </div>
                    ) : null}
                    {selectedChunks.length === 0 ? <p className="muted">No chunks selected.</p> : null}
                    {selectedChunks.map((chunk) => (
                      <div key={chunk.id} className="chunk-item">
                        <strong>#{chunk.chunkIndex}</strong>
                        <p>{chunk.content}</p>
                        <small>
                          {chunk.tokenEstimate} estimated tokens / {chunk.redactionStatus} / {chunk.contentSize} chars
                          {chunk.deletedAt ? ` / deleted ${chunk.deletedReason ?? ""}` : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="retrieval-list">
                  <h4>Retrievals</h4>
                  {selectedRetrievals.length === 0 ? (
                    <p className="muted">No retrievals recorded.</p>
                  ) : null}
                  {selectedRetrievals.map((retrieval) => (
                    <div key={retrieval.id} className="retrieval-item">
                      <strong>{retrieval.query}</strong>
                      <small>{new Date(retrieval.createdAt).toLocaleString()}</small>
                      {retrieval.results.map((result) => (
                        <div key={result.chunk.id} className="retrieval-result">
                          <p>{result.document.title}: {result.chunk.content}</p>
                          <small>
                            {result.mode} score {result.score.toFixed(3)}
                            {result.vectorScore !== null ? ` / vector ${result.vectorScore.toFixed(3)}` : ""}
                            {result.fallbackReason ? ` / fallback ${result.fallbackReason}` : ""}
                          </small>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="audit-list">
                  <h4>Audit events</h4>
                  {selectedAuditEvents.length === 0 ? (
                    <p className="muted">No context audit events.</p>
                  ) : null}
                  {selectedAuditEvents.map((event) => (
                    <div key={event.id} className="audit-item">
                      <strong>{event.eventType}</strong>
                      <small>
                        {event.actor} / {event.reason ?? "no reason"} / {new Date(event.createdAt).toLocaleString()}
                      </small>
                    </div>
                  ))}
                </div>
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
