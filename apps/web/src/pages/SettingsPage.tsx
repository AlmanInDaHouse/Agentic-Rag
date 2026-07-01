/**
 * Configuración (A11 redesign) — environment + local preferences. Everything here is
 * honest: the API URL is a build-time constant, the theme is dark-only for now, the demo
 * session and the local run registry are client-side only, and social auth is not
 * implemented. No setting here changes backend behaviour it cannot actually change.
 */

import React from "react";
import { Card, CardBody, CardHead, Button, Badge, Alert } from "../components/ui/index.js";
import { IconSettings, IconShield, IconX, IconLogout, IconAlert } from "../components/brand/icons.js";
import { API_URL } from "../state/config.js";
import { useRuns, clearRuns } from "../state/runsStore.js";
import { leaveDemo } from "../state/session.js";

function Kv({ k, children }: { k: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="tf-row tf-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--tf-border-faint)" }}>
      <span className="tf-muted" style={{ fontSize: "0.86rem" }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{children}</span>
    </div>
  );
}

export function SettingsPage(): JSX.Element {
  const runs = useRuns();
  return (
    <>
      <div className="tf-page-head">
        <div>
          <h2>Configuración</h2>
          <p>Entorno, sesión y datos locales de TriForge.</p>
        </div>
      </div>

      <div className="tf-grid tf-grid--2" style={{ alignItems: "start" }}>
        <Card>
          <CardHead title="Entorno" icon={<IconSettings size={18} />} />
          <CardBody>
            <Kv k="URL de la API"><span className="tf-mono" style={{ fontSize: "0.84rem" }}>{API_URL}</span></Kv>
            <Kv k="Tema"><Badge tone="info">Oscuro</Badge></Kv>
            <Kv k="Idioma"><Badge tone="neutral">Español</Badge></Kv>
            <Kv k="Versión"><span className="tf-mono" style={{ fontSize: "0.84rem" }}>TriForge v1.0</span></Kv>
            <p className="tf-muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
              La URL de la API se define en tiempo de compilación con <span className="tf-mono">VITE_API_URL</span>.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Sesión y datos locales" icon={<IconShield size={18} />} />
          <CardBody>
            <Kv k="Sesión">
              <Badge tone="info">Demo · sin autenticación real</Badge>
            </Kv>
            <Kv k="Ejecuciones locales guardadas">
              <span className="tf-mono">{runs.length}</span>
            </Kv>
            <div className="tf-row" style={{ marginTop: "var(--tf-space-4)", gap: 10 }}>
              <Button variant="subtle" size="sm" icon={<IconX size={14} />} onClick={() => clearRuns()} disabled={runs.length === 0}>
                Borrar historial local
              </Button>
              <Button variant="danger" size="sm" icon={<IconLogout size={14} />} onClick={() => leaveDemo()}>
                Salir del entorno demo
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Alert tone="info" icon={<IconAlert size={18} />} style={{ marginTop: "var(--tf-space-5)" }}>
        <strong>Honestidad de la interfaz:</strong> el inicio de sesión social (Google/GitHub) es solo visual y aún no
        está implementado. El acceso demo, el historial y las preferencias viven únicamente en este navegador
        (<span className="tf-mono">localStorage</span>) y no se envían a ningún servidor.
      </Alert>
    </>
  );
}
