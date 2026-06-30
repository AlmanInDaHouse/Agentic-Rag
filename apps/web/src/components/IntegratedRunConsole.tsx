/**
 * Integrated Run Console (A10-W.8b) — the product UI for a real integrated run.
 *
 * Submit a task (provider, collaboration mode, fixture repo, paths, budget), start it,
 * and watch the live, sequence-ordered timeline with honest provider provenance,
 * mutations, findings, repair, quota, governance, diff and cleanup. Cancel mid-run.
 * All display state comes from `deriveIntegratedRunView` (honest-by-construction).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createIntegratedRun,
  startIntegratedRun,
  getIntegratedRun,
  getIntegratedTimeline,
  cancelIntegratedRun,
  type CreateIntegratedRunInput
} from "../integratedApi.js";
import {
  deriveIntegratedRunView,
  type IntegratedRunRecordDTO,
  type IntegratedRunEventDTO,
  type IntegratedRunView
} from "../lib/integratedRun.js";

const PROVIDERS = ["codex", "claude"] as const;

export function IntegratedRunConsole(): JSX.Element {
  const [objective, setObjective] = useState("Add a slugify helper under src/ with a passing test");
  const [owner, setOwner] = useState<string>("codex");
  const [reviewer, setReviewer] = useState<string>("claude");
  const [collaborationMode, setCollaborationMode] = useState<"specialist" | "pair">("specialist");
  const [providerMode, setProviderMode] = useState<"mock" | "real">("mock");
  const [fixtureRepoPath, setFixtureRepoPath] = useState("");
  const [writePaths, setWritePaths] = useState("src");
  const [maxRepairRounds, setMaxRepairRounds] = useState(2);

  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<IntegratedRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const [record, timeline] = await Promise.all([
        getIntegratedRun(id) as Promise<IntegratedRunRecordDTO>,
        getIntegratedTimeline(id) as Promise<{ events: IntegratedRunEventDTO[] }>
      ]);
      setView(deriveIntegratedRunView(record, timeline.events));
      if (["completed", "failed", "cancelled", "blocked"].includes(record.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const onCreateAndStart = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const input: CreateIntegratedRunInput = {
        objective,
        owner,
        reviewer,
        providerMode,
        collaborationMode,
        fixtureRepoPath,
        writePaths: writePaths.split(",").map((s) => s.trim()).filter(Boolean),
        gates: [{ name: "unit", command: { bin: "npm", args: ["test"] } }],
        budget: { maxRepairRounds, perRunTimeoutMs: 240_000 }
      };
      const created = await createIntegratedRun(input);
      setRunId(created.id);
      await startIntegratedRun(created.id);
      await refresh(created.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => void refresh(created.id), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [objective, owner, reviewer, providerMode, collaborationMode, fixtureRepoPath, writePaths, maxRepairRounds, refresh]);

  const onCancel = useCallback(async () => {
    if (!runId) return;
    try {
      await cancelIntegratedRun(runId);
      await refresh(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, refresh]);

  return (
    <section aria-label="Integrated run console" className="integrated-run-console">
      <h2>Integrated Run</h2>

      <form
        className="run-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onCreateAndStart();
        }}
      >
        <label>
          Objective
          <textarea data-testid="objective-input" value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} />
        </label>
        <label>
          Owner
          <select data-testid="owner-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Reviewer
          <select data-testid="reviewer-select" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Collaboration mode
          <select data-testid="mode-select" value={collaborationMode} onChange={(e) => setCollaborationMode(e.target.value as "specialist" | "pair")}>
            <option value="specialist">Specialist</option>
            <option value="pair">Pair</option>
          </select>
        </label>
        <label>
          Provider mode
          <select data-testid="provider-mode-select" value={providerMode} onChange={(e) => setProviderMode(e.target.value as "mock" | "real")}>
            <option value="mock">mock</option>
            <option value="real">real</option>
          </select>
        </label>
        <label>
          Fixture repo (absolute path, outside TriForge)
          <input data-testid="fixture-input" value={fixtureRepoPath} onChange={(e) => setFixtureRepoPath(e.target.value)} placeholder="C:\\tmp\\triforge-fixture" />
        </label>
        <label>
          Write paths (comma-separated)
          <input data-testid="writepaths-input" value={writePaths} onChange={(e) => setWritePaths(e.target.value)} />
        </label>
        <label>
          Max repair rounds
          <input data-testid="repair-input" type="number" min={0} max={5} value={maxRepairRounds} onChange={(e) => setMaxRepairRounds(Number(e.target.value))} />
        </label>
        <button data-testid="start-btn" type="submit" disabled={busy || !fixtureRepoPath}>
          {busy ? "Starting…" : "Create & start run"}
        </button>
      </form>

      {error ? (
        <p className="error" role="alert" data-testid="error">
          {error}
        </p>
      ) : null}

      {view ? <RunView view={view} onCancel={onCancel} /> : null}
    </section>
  );
}

function RunView({ view, onCancel }: { view: IntegratedRunView; onCancel: () => void }): JSX.Element {
  return (
    <div className="run-view" data-run-id={view.id}>
      <header className="run-header">
        <span data-testid="run-status" data-terminal={view.isTerminal}>status: {view.statusLabel}</span>
        <span data-testid="run-mode">mode: {view.mode}</span>
        <span data-testid="collaboration-mode">collab: {view.collaborationMode}</span>
        {!view.isTerminal ? (
          <button data-testid="cancel-btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </header>

      <dl className="provenance" aria-label="Provider provenance">
        <dt>Owner</dt>
        <dd data-testid="owner-provenance" data-isreal={String(view.owner.isReal)}>{view.owner.label}</dd>
        <dt>Reviewer</dt>
        <dd data-testid="reviewer-provenance" data-isreal={String(view.reviewer.isReal)}>{view.reviewer.label}</dd>
      </dl>

      {view.sequenceGap ? (
        <p className="warn" role="alert" data-testid="sequence-gap">
          sequence gap detected — events may be missing
        </p>
      ) : null}
      {view.terminalCount > 1 ? (
        <p className="warn" role="alert" data-testid="multi-terminal">
          more than one terminal event ({view.terminalCount})
        </p>
      ) : null}

      <section aria-label="Integrated run timeline" className="timeline">
        <ol>
          {view.events.map((e) => (
            <li key={e.sequenceNumber} data-seq={e.sequenceNumber} data-type={e.type}>
              <span className="seq">#{e.sequenceNumber}</span>
              <span className="type">{e.type}</span>
              {e.provider ? (
                <span className="provider" data-provider={e.provider}>
                  {e.provider}
                  {e.providerVersion ? ` (${e.providerVersion})` : ""}
                </span>
              ) : null}
              {e.detail ? (
                <span className="detail">
                  {e.detail}
                  {e.detailTruncated ? " …[truncated]" : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Run outcome" className="outcome">
        <p data-testid="governance-verdict">governance: {view.governanceVerdict}</p>
        <p data-testid="merged">merged: {String(view.merged)}</p>
        <p data-testid="cleanup">cleanup: {String(view.cleanup)}</p>
        {view.terminalReason ? <p data-testid="terminal-reason">reason: {view.terminalReason}</p> : null}
      </section>

      <section aria-label="Changed files" className="changed-files" data-testid="changed-files">
        <h3>Changed files ({view.changedFiles.length})</h3>
        <ul>
          {view.changedFiles.map((f) => (
            <li key={f.path} data-status={f.status}>
              <span className="status">{f.status}</span>
              <span className="path">{f.path}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Diff" className="diff" data-testid="diff">
        <p>
          diff: {view.diff.present ? `${String(view.diff.lineCount)} lines` : "unknown"}
          {view.diff.truncated ? " …[diff truncated]" : ""}
        </p>
      </section>
    </div>
  );
}
