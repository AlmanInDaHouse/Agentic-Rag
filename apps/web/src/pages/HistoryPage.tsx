/**
 * Historial (A11 redesign) — the local-session run registry. HONEST SCOPE: the backend
 * has no list-all endpoint, so this shows only runs created in THIS browser; the header
 * says so. Rows open the live monitoring view; the registry can be cleared locally.
 */

import React from "react";
import { Card, CardBody, CardHead, Button, Badge, EmptyState } from "../components/ui/index.js";
import { IconHistory, IconRocket, IconX } from "../components/brand/icons.js";
import { useRuns, clearRuns } from "../state/runsStore.js";
import { navigate } from "../state/navigation.js";
import { statusLabelEs, statusTone, providerDisplayName } from "../lib/labels.js";

export function HistoryPage(): JSX.Element {
  const runs = useRuns();

  return (
    <>
      <div className="tf-page-head">
        <div>
          <h2>Historial</h2>
          <p>Ejecuciones creadas en esta sesión local del navegador. TriForge no expone un listado global, así que aquí solo verás lo lanzado desde este equipo. El estado mostrado es el último conocido y se actualiza al abrir cada ejecución.</p>
        </div>
        <div className="tf-row">
          <Button variant="primary" size="sm" icon={<IconRocket size={15} />} onClick={() => navigate("new-run")}>Nueva ejecución</Button>
          {runs.length > 0 ? (
            <Button variant="subtle" size="sm" icon={<IconX size={14} />} onClick={() => clearRuns()}>Limpiar</Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHead title={`Ejecuciones (${runs.length})`} icon={<IconHistory size={18} />} />
        <CardBody>
          {runs.length === 0 ? (
            <EmptyState icon={<IconHistory size={22} />} title="Sin ejecuciones en esta sesión">
              Cuando lances una ejecución aparecerá aquí con su estado.
            </EmptyState>
          ) : (
            <div className="tf-stack" style={{ gap: 8 }}>
              {runs.map((r) => (
                <button key={r.id} className="tf-runrow" onClick={() => navigate("monitoring", r.id)}>
                  <div className="tf-runrow__obj">
                    <div className="tf-runrow__title">{r.objective}</div>
                    <div className="tf-runrow__meta">
                      {providerDisplayName(r.owner)} → {providerDisplayName(r.reviewer)} · {r.collaborationMode} · {r.providerMode} · {new Date(r.updatedAt).toLocaleString("es-ES")}
                    </div>
                  </div>
                  <span className="tf-run-summary__id">{r.id.slice(0, 8)}</span>
                  <Badge tone={statusTone(r.status)} dot>{statusLabelEs(r.status)}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
