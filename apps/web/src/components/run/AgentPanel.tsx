/**
 * Agent panel (A11 redesign) — one lane of the dual Codex/Claude monitoring console.
 *
 * Shows an agent's identity + honest provenance (real vs mock + version), a live activity
 * feed (messages, file changes, decisions, findings, tool use, warnings) and per-lane
 * counters. Every item comes from `deriveAgentActivity`, which attributes events by the
 * provider tag the backend persisted; if a lane is empty, it says so honestly instead of
 * inventing activity.
 */

import React from "react";
import { Badge, EmptyState } from "../ui/index.js";
import {
  IconMessage,
  IconFile,
  IconGavel,
  IconSearch,
  IconTool,
  IconAlert,
  IconClock,
  IconSparkle
} from "../brand/icons.js";
import { ProviderMark } from "../brand/providerLogos.js";
import type { AgentLane, ActivityItem } from "../../lib/agentActivity.js";
import type { ProviderIdentityView } from "../../lib/integratedRun.js";
import { providerDisplayName } from "../../lib/labels.js";
import type { ActivityKind } from "../../lib/labels.js";

function kindIcon(kind: ActivityKind): JSX.Element {
  switch (kind) {
    case "change":
      return <IconFile size={14} />;
    case "decision":
      return <IconGavel size={14} />;
    case "finding":
      return <IconSearch size={14} />;
    case "tool":
      return <IconTool size={14} />;
    case "warning":
      return <IconAlert size={14} />;
    case "quota":
      return <IconClock size={14} />;
    case "stage":
      return <IconSparkle size={14} />;
    default:
      return <IconMessage size={14} />;
  }
}

function Activity({ item }: { item: ActivityItem }): JSX.Element {
  return (
    <div className="tf-act">
      <span className="tf-act__icon" data-kind={item.kind}>
        {kindIcon(item.kind)}
      </span>
      <div className="tf-act__main">
        <div className="tf-act__title">
          {item.title}
          <span className="tf-act__kind">#{item.sequenceNumber}</span>
        </div>
        {item.detail ? (
          <div className={item.kind === "change" || item.kind === "tool" ? "tf-act__detail tf-act__detail--mono" : "tf-act__detail"}>
            {item.detail}
            {item.detailTruncated ? " …[truncado]" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AgentPanel({
  lane,
  provenance,
  live
}: {
  lane: AgentLane;
  provenance: ProviderIdentityView;
  live: boolean;
}): JSX.Element {
  const provider = lane.provider;
  const accent = provider === "claude" ? "claude" : "codex";
  const roleLabel = lane.role === "owner" ? "Propietario · implementa" : "Revisor · solo lectura";
  const isReal = provenance.isReal;

  return (
    <section className={`tf-card tf-agent tf-agent--${accent}`} aria-label={`Actividad de ${providerDisplayName(provider)}`} data-provider={provider} data-role={lane.role}>
      <div className="tf-agent__head">
        <div className="tf-agent__avatar"><ProviderMark provider={provider} size={22} /></div>
        <div className="tf-agent__meta">
          <div className="tf-agent__name">
            {providerDisplayName(provider)}
            {live ? (
              <span className="tf-badge tf-badge--running tf-badge--live" style={{ marginLeft: 8 }}>
                <span className="tf-badge__dot" /> en vivo
              </span>
            ) : null}
          </div>
          <div className="tf-agent__role">{roleLabel}</div>
        </div>
        <Badge tone={isReal === true ? "success" : isReal === false ? "info" : "neutral"} dot>
          {isReal === true ? "real" : isReal === false ? "mock" : "desconocido"}
          {provenance.version && provenance.version !== "unknown" ? ` · ${provenance.version}` : ""}
        </Badge>
      </div>

      <div className="tf-agent__body">
        {lane.items.length === 0 ? (
          <EmptyState icon={<IconClock size={20} />} title="Sin actividad todavía">
            Los eventos de {providerDisplayName(provider)} aparecerán aquí en cuanto el backend los emita.
          </EmptyState>
        ) : (
          lane.items.map((item) => <Activity key={item.sequenceNumber} item={item} />)
        )}
      </div>

      <div className="tf-agent__stats">
        {lane.role === "owner" ? (
          <>
            <div className="tf-agent__stat"><b>{lane.counts.changes}</b><span>Cambios</span></div>
            <div className="tf-agent__stat"><b>{lane.counts.messages}</b><span>Mensajes</span></div>
            <div className="tf-agent__stat"><b>{lane.counts.tools}</b><span>Herramientas</span></div>
            <div className="tf-agent__stat"><b>{lane.counts.warnings}</b><span>Avisos</span></div>
          </>
        ) : (
          <>
            <div className="tf-agent__stat"><b>{lane.counts.findings}</b><span>Hallazgos</span></div>
            <div className="tf-agent__stat"><b>{lane.counts.messages}</b><span>Mensajes</span></div>
            <div className="tf-agent__stat"><b>{lane.counts.warnings}</b><span>Avisos</span></div>
          </>
        )}
      </div>
    </section>
  );
}
