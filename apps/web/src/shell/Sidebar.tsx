/**
 * Left sidebar (A11 redesign) — brand mark + grouped navigation + a live system-status
 * footer. Purely presentational: the active view + navigate handler come from props.
 */

import React from "react";
import { TriquetraLogo } from "../components/brand/TriquetraLogo.js";
import {
  IconDashboard,
  IconRocket,
  IconMonitor,
  IconHistory,
  IconAgents,
  IconSettings
} from "../components/brand/icons.js";
import type { ViewId } from "../state/navigation.js";
import type { SystemStatus } from "../state/config.js";

interface NavDef {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: { title: string; items: NavDef[] }[] = [
  {
    title: "Operación",
    items: [
      { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
      { id: "new-run", label: "Nueva ejecución", icon: <IconRocket /> },
      { id: "monitoring", label: "Monitorización", icon: <IconMonitor /> },
      { id: "history", label: "Historial", icon: <IconHistory /> }
    ]
  },
  {
    title: "Plataforma",
    items: [
      { id: "agents", label: "Agentes", icon: <IconAgents /> },
      { id: "settings", label: "Configuración", icon: <IconSettings /> }
    ]
  }
];

const STATUS_LABEL: Record<SystemStatus, string> = {
  checking: "Comprobando…",
  online: "Sistema en línea",
  offline: "Backend sin conexión"
};

export function Sidebar({
  active,
  onNavigate,
  systemStatus
}: {
  active: ViewId;
  onNavigate: (view: ViewId) => void;
  systemStatus: SystemStatus;
}): JSX.Element {
  return (
    <aside className="tf-sidebar">
      <div className="tf-brand">
        <TriquetraLogo size={34} className="tf-brand__mark" idSuffix="sidebar" />
        <div className="tf-brand__text">
          <div className="tf-brand__name">TriForge</div>
          <div className="tf-brand__tag">Agentic Lab</div>
        </div>
      </div>

      <nav className="tf-nav" aria-label="Navegación principal">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="tf-nav__section">{section.title}</div>
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tf-navitem"
                data-active={active === item.id}
                aria-current={active === item.id ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => onNavigate(item.id)}
              >
                <span className="tf-navitem__ico">{item.icon}</span>
                <span className="tf-navitem__label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="tf-sidebar__footer">
        <div className="tf-sidebar__footer-row">
          <span className={`tf-dot tf-dot--${systemStatus === "online" ? "success" : systemStatus === "offline" ? "danger" : "running"}`} />
          <span className="tf-sidebar__footer-text">{STATUS_LABEL[systemStatus]}</span>
        </div>
        <div className="tf-sidebar__footer-text tf-muted" style={{ fontSize: "0.7rem", fontFamily: "var(--tf-font-mono)" }}>
          TriForge v1.0 · Windows nativo
        </div>
      </div>
    </aside>
  );
}
