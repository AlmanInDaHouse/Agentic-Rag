/**
 * Run progress card (A11 redesign) — a big honest percentage, the stage stepper, and the
 * repair-round count. All values come from `deriveRunProgress` (furthest-event derived,
 * never random). The stage stepper reflects done / active / pending / failed / blocked /
 * skipped exactly as the pipeline reports.
 */

import React from "react";
import { ProgressBar } from "../ui/index.js";
import type { RunProgressView } from "../../lib/runProgress.js";

const TONE_LABEL: Record<RunProgressView["tone"], string> = {
  running: "En curso",
  success: "Completado",
  danger: "Fallido",
  blocked: "Detenido"
};

export function RunProgress({ progress }: { progress: RunProgressView }): JSX.Element {
  const live = progress.tone === "running";
  return (
    <div className="tf-progress">
      <div className="tf-progress__head">
        <div className="tf-row" style={{ gap: "var(--tf-space-4)", alignItems: "baseline" }}>
          <span className="tf-progress__pct" data-testid="run-percent">
            {progress.percent}%
          </span>
          <span className="tf-eyebrow">Progreso · {TONE_LABEL[progress.tone]}</span>
        </div>
        {progress.repairRounds > 0 ? (
          <span className="tf-mono tf-muted" style={{ fontSize: "0.8rem" }}>
            {progress.repairRounds} ronda(s) de reparación
          </span>
        ) : null}
      </div>

      <ProgressBar value={progress.percent} live={live} tone={progress.tone === "running" || progress.tone === "success" ? undefined : progress.tone} />

      <div className="tf-stages" role="list" aria-label="Etapas del pipeline">
        {progress.stages.map((s, i) => (
          <div key={s.id} className="tf-stage" data-status={s.status} role="listitem">
            <span className="tf-stage__idx">{s.status === "done" ? "✓" : i + 1}</span>
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
