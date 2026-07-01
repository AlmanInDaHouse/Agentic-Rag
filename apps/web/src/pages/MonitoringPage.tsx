/**
 * Monitorización (A11 redesign) — the live operations console for one run.
 *
 * Layout: run header (status/mode/collab + cancel) → honest progress card → provider
 * provenance strip (+ integrity warnings) → dual Codex/Claude agent panels → tabbed
 * Cronología / Resultado. Everything is derived by `useRunView` from the persisted run +
 * event stream; nothing is invented. When no run is selected it invites the user to pick
 * a recent run or launch a new one.
 */

import React, { useState } from "react";
import { Card, CardBody, CardHead, Button, Badge, Tabs, Alert, EmptyState, Spinner } from "../components/ui/index.js";
import { RunProgress } from "../components/run/RunProgress.js";
import { AgentPanel } from "../components/run/AgentPanel.js";
import { RunTimelineFeed } from "../components/run/RunTimelineFeed.js";
import { RunOutcome } from "../components/run/RunOutcome.js";
import { IconMonitor, IconRocket, IconStop, IconAlert, IconLayers, IconHistory } from "../components/brand/icons.js";
import { useRunView } from "../state/useRunView.js";
import { useRuns } from "../state/runsStore.js";
import { navigate } from "../state/navigation.js";
import { statusLabelEs, statusTone } from "../lib/labels.js";

type MonTab = "timeline" | "outcome";

export function MonitoringPage({ runId }: { runId: string | null }): JSX.Element {
  const { record, view, progress, agents, loading, error, cancel } = useRunView(runId);
  const runs = useRuns();
  const [tab, setTab] = useState<MonTab>("timeline");

  if (!runId) {
    return <NoRunSelected recent={runs.slice(0, 6)} />;
  }

  if (loading && !record) {
    return (
      <Card className="tf-card--pad">
        <div className="tf-row" style={{ justifyContent: "center", padding: "var(--tf-space-8)" }}>
          <Spinner /> <span className="tf-muted">Cargando ejecución…</span>
        </div>
      </Card>
    );
  }

  if (error && !record) {
    return (
      <Alert tone="danger" icon={<IconAlert size={18} />}>
        No se pudo cargar la ejecución <span className="tf-mono">{runId}</span>: {error}
      </Alert>
    );
  }

  if (!record || !view || !progress || !agents) {
    return <EmptyState icon={<IconMonitor size={22} />} title="Ejecución no encontrada" />;
  }

  const live = progress.tone === "running";

  return (
    <div className="tf-stack" style={{ gap: "var(--tf-space-6)" }}>
      {/* Header */}
      <div className="tf-page-head" style={{ marginBottom: 0 }}>
        <div className="tf-run-summary">
          <Badge tone={statusTone(record.status)} dot live={live} data-testid="run-status">
            {statusLabelEs(record.status)}
          </Badge>
          <Badge tone="outline" data-testid="run-mode">modo: {view.mode}</Badge>
          <Badge tone="outline" data-testid="collaboration-mode">colaboración: {view.collaborationMode}</Badge>
          <span className="tf-run-summary__id">{record.id}</span>
        </div>
        <div className="tf-row">
          <Button variant="subtle" size="sm" icon={<IconRocket size={15} />} onClick={() => navigate("new-run")}>
            Nueva
          </Button>
          {!view.isTerminal ? (
            <Button variant="danger" size="sm" icon={<IconStop size={14} />} onClick={() => void cancel()} data-testid="cancel-btn">
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      <p className="tf-secondary" style={{ marginTop: "-8px" }}>{record.spec.objective}</p>

      {/* Progress */}
      <Card accent="cyan">
        <CardHead title="Progreso de la ejecución" icon={<IconMonitor size={18} />} />
        <CardBody>
          <RunProgress progress={progress} />
        </CardBody>
      </Card>

      {/* Integrity warnings (honest) */}
      {view.sequenceGap ? (
        <Alert tone="warning" icon={<IconAlert size={18} />} data-testid="sequence-gap" role="alert">
          Se detectó un salto en la secuencia de eventos — puede que falten eventos.
        </Alert>
      ) : null}
      {view.terminalCount > 1 ? (
        <Alert tone="warning" icon={<IconAlert size={18} />} data-testid="multi-terminal" role="alert">
          Más de un evento terminal detectado ({view.terminalCount}).
        </Alert>
      ) : null}

      {/* Provenance */}
      <Card>
        <CardBody>
          <div className="tf-kv">
            <div className="tf-kv__item">
              <span className="tf-kv__k">Propietario</span>
              <span className="tf-kv__v" data-testid="owner-provenance" data-isreal={String(view.owner.isReal)}>{view.owner.label}</span>
            </div>
            <div className="tf-kv__item">
              <span className="tf-kv__k">Revisor</span>
              <span className="tf-kv__v" data-testid="reviewer-provenance" data-isreal={String(view.reviewer.isReal)}>{view.reviewer.label}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Dual agent panels */}
      <div>
        <div className="tf-row" style={{ gap: 10, marginBottom: "var(--tf-space-4)" }}>
          <IconLayers size={18} />
          <h3 style={{ fontSize: "1.15rem" }}>Monitorización de agentes</h3>
          {agents.sameProvider ? (
            <Badge tone="warning">owner y reviewer usan el mismo proveedor — el reparto por rol es aproximado</Badge>
          ) : null}
        </div>
        <div className="tf-agents">
          <AgentPanel lane={agents.owner} provenance={view.owner} live={live} />
          <AgentPanel lane={agents.reviewer} provenance={view.reviewer} live={live} />
        </div>
      </div>

      {/* Tabs: timeline / outcome */}
      <Card>
        <div style={{ padding: "var(--tf-space-4) var(--tf-space-5) 0" }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "timeline", label: "Cronología", count: view.events.length },
              { key: "outcome", label: "Resultado y cambios", count: view.changedFiles.length }
            ]}
          />
        </div>
        <CardBody>
          {/* Both panels stay mounted (toggled with `hidden`) so the run-outcome E2E
              selectors remain in the DOM regardless of the active tab. */}
          <div hidden={tab !== "timeline"}>
            <RunTimelineFeed events={view.events} />
          </div>
          <div hidden={tab !== "outcome"}>
            <RunOutcome view={view} diffText={record.report?.diffText ?? null} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function NoRunSelected({ recent }: { recent: { id: string; objective: string; status: string; providerMode: string }[] }): JSX.Element {
  return (
    <div className="tf-grid tf-grid--2" style={{ alignItems: "start" }}>
      <Card className="tf-card--pad" accent="cyan">
        <EmptyState icon={<IconMonitor size={22} />} title="No hay ninguna ejecución seleccionada">
          Lanza una nueva ejecución para ver la actividad de Codex y Claude en tiempo real.
        </EmptyState>
        <div className="tf-row" style={{ justifyContent: "center", marginTop: "var(--tf-space-4)" }}>
          <Button variant="primary" icon={<IconRocket size={16} />} onClick={() => navigate("new-run")}>
            Nueva ejecución
          </Button>
        </div>
      </Card>
      <Card>
        <CardHead title="Ejecuciones recientes" icon={<IconHistory size={18} />} />
        <CardBody>
          {recent.length === 0 ? (
            <p className="tf-muted">Aún no has lanzado ninguna ejecución en esta sesión.</p>
          ) : (
            <div className="tf-stack" style={{ gap: 8 }}>
              {recent.map((r) => (
                <button key={r.id} className="tf-runrow" onClick={() => navigate("monitoring", r.id)}>
                  <div className="tf-runrow__obj">
                    <div className="tf-runrow__title">{r.objective}</div>
                    <div className="tf-runrow__meta">{r.id.slice(0, 8)} · {r.providerMode}</div>
                  </div>
                  <Badge tone={statusTone(r.status)} dot>{statusLabelEs(r.status)}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
