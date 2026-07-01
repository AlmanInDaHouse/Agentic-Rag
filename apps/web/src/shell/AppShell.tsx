/**
 * App shell (A11 redesign) — composes the sidebar + topbar around the routed page.
 * Owns the sidebar collapse state and the per-view topbar title/subtitle.
 */

import React, { useState } from "react";
import { Sidebar } from "./Sidebar.js";
import { Topbar } from "./Topbar.js";
import type { ViewId } from "../state/navigation.js";
import type { SystemStatus } from "../state/config.js";

const TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Estado general de la plataforma" },
  "new-run": { title: "Nueva ejecución", subtitle: "Configura y lanza una tarea gobernada" },
  monitoring: { title: "Monitorización", subtitle: "Actividad de los agentes en tiempo real" },
  history: { title: "Historial", subtitle: "Ejecuciones de esta sesión local" },
  agents: { title: "Agentes", subtitle: "Proveedores de IA disponibles" },
  settings: { title: "Configuración", subtitle: "Entorno y preferencias" }
};

export function AppShell({
  view,
  systemStatus,
  onNavigate,
  onLeaveDemo,
  children
}: {
  view: ViewId;
  systemStatus: SystemStatus;
  onNavigate: (view: ViewId) => void;
  onLeaveDemo: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const meta = TITLES[view];
  return (
    <div className="tf-app" data-collapsed={collapsed}>
      <Sidebar active={view} onNavigate={onNavigate} systemStatus={systemStatus} />
      <div className="tf-main">
        <Topbar
          title={meta.title}
          subtitle={meta.subtitle}
          systemStatus={systemStatus}
          onToggleSidebar={() => setCollapsed((c) => !c)}
          onLeaveDemo={onLeaveDemo}
        />
        <main className="tf-content" key={view}>
          {children}
        </main>
      </div>
    </div>
  );
}
