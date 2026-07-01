/**
 * Honest run-progress view-model (A11 redesign).
 *
 * The integrated pipeline is a fixed, ordered sequence of stages. Progress is derived
 * from the FURTHEST pipeline event actually persisted — never a random or time-based
 * number (mandate §10 honesty). While running, the bar climbs stage-by-stage and is
 * capped below 100%; only a terminal `completed` reaches 100%. A terminal
 * failed/blocked/cancelled freezes the bar at the furthest stage reached and marks the
 * stage that was in flight as failed/blocked — the UI never implies more happened than
 * the event log shows.
 *
 * Pure + deterministic (unit-tested).
 */

import type { IntegratedRunEventDTO } from "./integratedRun.js";

export type StageStatus = "pending" | "active" | "done" | "failed" | "blocked" | "skipped";

export interface StageView {
  id: string;
  label: string;
  status: StageStatus;
}

export interface RunProgressView {
  /** 0..100, integer. Derived from the furthest stage; 100 only on terminal success. */
  percent: number;
  /** Progress-bar tone. */
  tone: "running" | "success" | "danger" | "blocked";
  isTerminal: boolean;
  /** Id of the stage currently active (or the last reached on a terminal run). */
  currentStageId: string;
  stages: StageView[];
  /** Repair rounds actually observed (>=0). Surfaced honestly next to the bar. */
  repairRounds: number;
}

interface StageDef {
  id: string;
  label: string;
  /** Event types whose presence means this stage has been reached. */
  triggers: string[];
  /** Target percentage once this stage is the furthest reached (running). */
  target: number;
}

/** Ordered pipeline. `reparacion` is optional and only shown when repair rounds occur. */
const STAGES: StageDef[] = [
  { id: "inicio", label: "Inicio", triggers: ["run.started"], target: 8 },
  { id: "preparacion", label: "Preparación", triggers: ["provider.selected", "worktree.created"], target: 20 },
  { id: "ejecucion", label: "Ejecución", triggers: ["repair.round.started", "file.changed", "mutations.recorded", "tool.started", "tool.completed"], target: 42 },
  { id: "gates", label: "Verificación", triggers: ["gates.completed"], target: 56 },
  { id: "revision", label: "Revisión", triggers: ["review.completed"], target: 68 },
  { id: "reparacion", label: "Reparación", triggers: [], target: 74 },
  { id: "gobernanza", label: "Gobernanza", triggers: ["governance.decided"], target: 84 },
  { id: "merge", label: "Merge", triggers: ["merge.completed", "merge.skipped"], target: 93 },
  { id: "cierre", label: "Cierre", triggers: ["diff.captured", "cleanup.completed"], target: 98 }
];

const TERMINAL_SUCCESS = "run.completed";
const TERMINAL_FAIL = new Set(["run.failed"]);
const TERMINAL_BLOCK = new Set(["run.blocked", "run.cancelled"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "blocked"]);

/** Count distinct repair rounds >= 1 from repair.round.started payloads. */
function countRepairRounds(events: IntegratedRunEventDTO[]): number {
  const rounds = new Set<number>();
  for (const e of events) {
    if (e.type === "repair.round.started") {
      const r = Number((e.payload as { round?: unknown }).round ?? 0);
      if (Number.isFinite(r) && r >= 1) rounds.add(r);
    }
  }
  return rounds.size;
}

export function deriveRunProgress(status: string, events: IntegratedRunEventDTO[]): RunProgressView {
  const present = new Set(events.map((e) => e.type));
  const repairRounds = countRepairRounds(events);
  const isTerminal = TERMINAL_STATUSES.has(status);

  // Furthest reached stage index (by trigger presence).
  let furthest = -1;
  STAGES.forEach((s, i) => {
    if (s.triggers.some((t) => present.has(t))) furthest = Math.max(furthest, i);
  });
  // `reparacion` is reached implicitly when repair rounds happened.
  const reparacionIdx = STAGES.findIndex((s) => s.id === "reparacion");
  const reparacionReached = repairRounds > 0;
  if (reparacionReached) furthest = Math.max(furthest, reparacionIdx);

  const success = status === "completed" || present.has(TERMINAL_SUCCESS);
  const failed = status === "failed" || events.some((e) => TERMINAL_FAIL.has(e.type));
  const blocked = status === "blocked" || status === "cancelled" || events.some((e) => TERMINAL_BLOCK.has(e.type));

  // Build stage views.
  const stages: StageView[] = STAGES.map((s, i) => {
    let st: StageStatus;
    if (i < furthest) {
      st = "done";
    } else if (i === furthest) {
      st = isTerminal ? (success ? "done" : failed ? "failed" : blocked ? "blocked" : "done") : "active";
    } else {
      st = "pending";
    }
    // Optional reparación stage: if no repair happened, mark skipped (never "failed").
    if (s.id === "reparacion" && !reparacionReached) {
      st = i <= furthest ? "skipped" : "pending";
    }
    return { id: s.id, label: s.label, status: st };
  });

  if (success) {
    // Terminal success: every stage done.
    stages.forEach((s) => {
      if (s.status !== "skipped") s.status = "done";
    });
  }

  // Percent.
  let percent: number;
  let tone: RunProgressView["tone"];
  if (success) {
    percent = 100;
    tone = "success";
  } else if (failed) {
    percent = furthest >= 0 ? STAGES[Math.min(furthest, STAGES.length - 1)].target : 4;
    tone = "danger";
  } else if (blocked) {
    percent = furthest >= 0 ? STAGES[Math.min(furthest, STAGES.length - 1)].target : 4;
    tone = "blocked";
  } else {
    // Running: climb to the furthest stage target, capped below 100.
    percent = furthest >= 0 ? STAGES[Math.min(furthest, STAGES.length - 1)].target : 3;
    tone = "running";
  }

  const currentStageId = furthest >= 0 ? STAGES[Math.min(furthest, STAGES.length - 1)].id : "inicio";

  return {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    tone,
    isTerminal,
    currentStageId,
    stages,
    repairRounds
  };
}
