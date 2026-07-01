/**
 * Dashboard (A11 redesign) — an honest overview of the platform and this browser's
 * session. System status is probed live; run KPIs and "recent runs" come from the local
 * registry (runs created in this session — the backend has no list-all endpoint, and the
 * UI says so). Provider status is per-run, so the provider tiles link to Agentes rather
 * than claiming a global verified state.
 */

import React from "react";
import { Card, CardBody, CardHead, Button, Badge, EmptyState } from "../components/ui/index.js";
import {
  IconShield,
  IconRocket,
  IconMonitor,
  IconHistory,
  IconAgents,
  IconSettings,
  IconLayers,
  IconClock,
  IconSparkle
} from "../components/brand/icons.js";
import { TriquetraLogo } from "../components/brand/TriquetraLogo.js";
import { ProviderAvatar } from "../components/brand/providerLogos.js";
import { useRuns } from "../state/runsStore.js";
import { useSystemHealth } from "../state/config.js";
import { navigate } from "../state/navigation.js";
import { statusLabelEs, statusTone } from "../lib/labels.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "blocked"]);

export function DashboardPage(): JSX.Element {
  const runs = useRuns();
  const health = useSystemHealth();

  const total = runs.length;
  const active = runs.filter((r) => !TERMINAL.has(r.status)).length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const last = runs[0] ?? null;

  return (
    <div className="tf-stack" style={{ gap: "var(--tf-space-6)" }}>
      {/* Hero row */}
      <div className="tf-grid tf-grid--3">
        <Card accent="cyan" glow>
          <CardHead title="Estado del sistema" icon={<IconShield size={18} />} />
          <CardBody>
            <div className="tf-row" style={{ gap: 12 }}>
              <span className={`tf-dot tf-dot--${health === "online" ? "success" : health === "offline" ? "danger" : "running"}`} style={{ width: 12, height: 12 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  {health === "online" ? "Operativo" : health === "offline" ? "Sin conexión" : "Comprobando…"}
                </div>
                <div className="tf-muted" style={{ fontSize: "0.82rem" }}>Backend integrado · Windows nativo</div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Actividad de la sesión" icon={<IconLayers size={18} />} />
          <CardBody>
            <div className="tf-row" style={{ gap: "var(--tf-space-6)" }}>
              <div className="tf-stat"><span className="tf-stat__label">Total</span><span className="tf-stat__value">{total}</span></div>
              <div className="tf-stat"><span className="tf-stat__label">En curso</span><span className="tf-stat__value" style={{ color: "var(--tf-running)" }}>{active}</span></div>
              <div className="tf-stat"><span className="tf-stat__label">Completadas</span><span className="tf-stat__value" style={{ color: "var(--tf-success)" }}>{completed}</span></div>
            </div>
          </CardBody>
        </Card>

        <Card accent="amber">
          <CardHead title="Modo de proveedor" icon={<IconSparkle size={18} />} />
          <CardBody>
            <p className="tf-secondary" style={{ fontSize: "0.9rem" }}>
              El modo (<span className="tf-mono">mock</span> / <span className="tf-mono">real</span>) se elige en cada ejecución.
              El modo real requiere las CLIs de Codex y Claude autenticadas.
            </p>
            <div className="tf-row" style={{ marginTop: "var(--tf-space-3)" }}>
              <Badge tone="info">mock</Badge>
              <Badge tone="success">real</Badge>
              <Button variant="ghost" size="sm" onClick={() => navigate("agents")}>Ver agentes →</Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Quick actions + providers */}
      <div className="tf-grid tf-grid--3">
        <Card className="tf-span-2" accent="primary">
          <CardHead title="Acciones rápidas" icon={<IconRocket size={18} />} />
          <CardBody>
            <div className="tf-quick">
              <button className="tf-quick__btn" onClick={() => navigate("new-run")}>
                <IconRocket size={22} className="tf-ico" /> Nueva ejecución
              </button>
              <button className="tf-quick__btn" onClick={() => navigate("monitoring", last?.id)}>
                <IconMonitor size={22} className="tf-ico" /> Monitorización
              </button>
              <button className="tf-quick__btn" onClick={() => navigate("history")}>
                <IconHistory size={22} className="tf-ico" /> Historial
              </button>
              <button className="tf-quick__btn" onClick={() => navigate("agents")}>
                <IconAgents size={22} className="tf-ico" /> Agentes
              </button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Agentes disponibles" icon={<IconAgents size={18} />} />
          <CardBody>
            <div className="tf-stack" style={{ gap: 10 }}>
              <div className="tf-file" style={{ padding: "12px" }}>
                <ProviderAvatar provider="codex" size={34} />
                <span className="tf-grow" style={{ fontWeight: 600 }}>Codex</span>
                <Badge tone="codex">owner por defecto</Badge>
              </div>
              <div className="tf-file" style={{ padding: "12px" }}>
                <ProviderAvatar provider="claude" size={34} />
                <span className="tf-grow" style={{ fontWeight: 600 }}>Claude</span>
                <Badge tone="claude">reviewer por defecto</Badge>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Recent runs + last activity */}
      <div className="tf-grid tf-grid--3">
        <Card className="tf-span-2">
          <CardHead
            title="Ejecuciones recientes"
            icon={<IconHistory size={18} />}
            action={<Button variant="ghost" size="sm" onClick={() => navigate("history")}>Ver todo →</Button>}
          />
          <CardBody>
            {runs.length === 0 ? (
              <EmptyState icon={<IconRocket size={20} />} title="Aún no hay ejecuciones">
                Lanza tu primera ejecución para empezar a ver actividad aquí.
              </EmptyState>
            ) : (
              <div className="tf-stack" style={{ gap: 8 }}>
                {runs.slice(0, 5).map((r) => (
                  <button key={r.id} className="tf-runrow" onClick={() => navigate("monitoring", r.id)}>
                    <div className="tf-runrow__obj">
                      <div className="tf-runrow__title">{r.objective}</div>
                      <div className="tf-runrow__meta">
                        {r.owner} → {r.reviewer} · {r.providerMode} · {r.id.slice(0, 8)}
                      </div>
                    </div>
                    <Badge tone={statusTone(r.status)} dot>{statusLabelEs(r.status)}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card accent="purple">
          <CardHead title="Última actividad" icon={<IconClock size={18} />} />
          <CardBody>
            {last ? (
              <div className="tf-stack">
                <div className="tf-row tf-between">
                  <span className="tf-muted" style={{ fontSize: "0.8rem" }}>Estado</span>
                  <Badge tone={statusTone(last.status)} dot>{statusLabelEs(last.status)}</Badge>
                </div>
                <div className="tf-truncate" style={{ fontWeight: 600 }}>{last.objective}</div>
                <div className="tf-mono tf-muted" style={{ fontSize: "0.76rem" }}>
                  {new Date(last.updatedAt).toLocaleString("es-ES")}
                </div>
                <Button variant="subtle" size="sm" onClick={() => navigate("monitoring", last.id)}>Abrir monitorización →</Button>
              </div>
            ) : (
              <div className="tf-stack" style={{ alignItems: "center", padding: "var(--tf-space-4)" }}>
                <TriquetraLogo size={44} idSuffix="dash" />
                <p className="tf-muted" style={{ textAlign: "center", fontSize: "0.86rem" }}>
                  Todo listo. Lanza una ejecución para poner a Codex y Claude a trabajar.
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
