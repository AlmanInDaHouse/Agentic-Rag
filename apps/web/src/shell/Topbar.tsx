/**
 * Top bar (A11 redesign) — section title/subtitle, live system-status badge, an honest
 * "demo" session badge, and a session menu (log out of the demo). No real notifications
 * backend exists, so the bell is a static affordance labelled accordingly.
 */

import React, { useState } from "react";
import { Badge } from "../components/ui/index.js";
import { IconBell, IconSidebar, IconLogout } from "../components/brand/icons.js";
import type { SystemStatus } from "../state/config.js";

export function Topbar({
  title,
  subtitle,
  systemStatus,
  onToggleSidebar,
  onLeaveDemo
}: {
  title: string;
  subtitle?: string;
  systemStatus: SystemStatus;
  onToggleSidebar: () => void;
  onLeaveDemo: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="tf-topbar">
      <button className="tf-iconbtn" type="button" aria-label="Contraer menú" onClick={onToggleSidebar}>
        <IconSidebar size={18} />
      </button>
      <div className="tf-topbar__title">
        <h1>{title}</h1>
        {subtitle ? <span className="tf-topbar__sub">{subtitle}</span> : null}
      </div>

      <div className="tf-topbar__spacer" />

      <Badge tone={systemStatus === "online" ? "success" : systemStatus === "offline" ? "danger" : "running"} dot live={systemStatus === "checking"}>
        {systemStatus === "online" ? "En línea" : systemStatus === "offline" ? "Sin conexión" : "Comprobando"}
      </Badge>

      <button className="tf-iconbtn" type="button" aria-label="Notificaciones" title="Sin notificaciones">
        <IconBell size={18} />
      </button>

      <div style={{ position: "relative" }}>
        <button className="tf-avatar" type="button" aria-label="Sesión" onClick={() => setMenuOpen((o) => !o)}>
          D
        </button>
        {menuOpen ? (
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 8px)",
              minWidth: 200,
              background: "var(--tf-surface-2)",
              border: "1px solid var(--tf-border-strong)",
              borderRadius: "var(--tf-radius)",
              boxShadow: "var(--tf-shadow-lg)",
              padding: 6,
              zIndex: 50
            }}
          >
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--tf-border-faint)", marginBottom: 4 }}>
              <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>Usuario demo</div>
              <div className="tf-muted" style={{ fontSize: "0.74rem" }}>Sesión local · sin autenticación real</div>
            </div>
            <button
              type="button"
              className="tf-btn tf-btn--ghost tf-btn--sm tf-btn--block"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                setMenuOpen(false);
                onLeaveDemo();
              }}
            >
              <IconLogout size={16} /> Salir del entorno demo
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
