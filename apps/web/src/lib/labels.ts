/**
 * Spanish presentation labels + honest metadata for integrated-run events, statuses and
 * verdicts (A11 redesign). This is a PURE mapping layer: it renames/annotates what the
 * backend already reports (event `type`, run `status`, governance `verdict`) into Spanish
 * with a display tone + an activity "kind". It invents no state — an unknown value falls
 * back to a visible, honest label rather than a fabricated one.
 */

export type Tone = "neutral" | "success" | "danger" | "warning" | "running" | "info" | "codex" | "claude";

/** Category used to pick an icon/colour inside an agent activity panel. */
export type ActivityKind = "message" | "change" | "decision" | "finding" | "tool" | "warning" | "quota" | "stage";

export interface EventMeta {
  /** Human, Spanish label for the event type. */
  label: string;
  tone: Tone;
  kind: ActivityKind;
}

const EVENT_META: Record<string, EventMeta> = {
  "run.started": { label: "Ejecución iniciada", tone: "running", kind: "stage" },
  "provider.selected": { label: "Proveedores asignados", tone: "info", kind: "stage" },
  "worktree.created": { label: "Entorno aislado preparado", tone: "info", kind: "stage" },
  "repair.round.started": { label: "Ronda de trabajo iniciada", tone: "running", kind: "stage" },
  "agent.message": { label: "Mensaje del agente", tone: "neutral", kind: "message" },
  "file.changed": { label: "Fichero modificado", tone: "info", kind: "change" },
  "warning.raised": { label: "Aviso", tone: "warning", kind: "warning" },
  "tool.started": { label: "Herramienta en uso", tone: "neutral", kind: "tool" },
  "tool.completed": { label: "Herramienta finalizada", tone: "neutral", kind: "tool" },
  "quota.updated": { label: "Cuota actualizada", tone: "neutral", kind: "quota" },
  "usage.updated": { label: "Uso actualizado", tone: "neutral", kind: "quota" },
  "mutations.recorded": { label: "Cambios registrados", tone: "info", kind: "change" },
  "gates.completed": { label: "Verificaciones (gates) ejecutadas", tone: "info", kind: "stage" },
  "review.completed": { label: "Revisión completada", tone: "claude", kind: "finding" },
  "governance.decided": { label: "Decisión de gobernanza", tone: "info", kind: "decision" },
  "merge.completed": { label: "Merge gobernado completado", tone: "success", kind: "decision" },
  "merge.skipped": { label: "Merge omitido", tone: "warning", kind: "decision" },
  "diff.captured": { label: "Diff capturado", tone: "neutral", kind: "stage" },
  "cleanup.completed": { label: "Limpieza completada", tone: "neutral", kind: "stage" },
  "run.completed": { label: "Ejecución completada", tone: "success", kind: "stage" },
  "run.failed": { label: "Ejecución fallida", tone: "danger", kind: "stage" },
  "run.cancelled": { label: "Ejecución cancelada", tone: "warning", kind: "stage" },
  "run.blocked": { label: "Ejecución bloqueada", tone: "warning", kind: "stage" }
};

export function eventMeta(type: string): EventMeta {
  return EVENT_META[type] ?? { label: type, tone: "neutral", kind: "stage" };
}

export function eventLabel(type: string): string {
  return eventMeta(type).label;
}

const STATUS_LABEL: Record<string, string> = {
  created: "Creada",
  running: "En curso",
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
  blocked: "Bloqueada"
};

export function statusLabelEs(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "running";
    case "failed":
      return "danger";
    case "blocked":
    case "cancelled":
      return "warning";
    default:
      return "neutral";
  }
}

const VERDICT_LABEL: Record<string, string> = {
  merge: "Aprobado para merge",
  hold: "En espera",
  block: "Bloqueado",
  reject: "Rechazado",
  escalate: "Escalado",
  unknown: "Desconocido"
};

export function verdictLabelEs(verdict: string): string {
  return VERDICT_LABEL[verdict] ?? verdict;
}

export function verdictTone(verdict: string): Tone {
  switch (verdict) {
    case "merge":
      return "success";
    case "hold":
    case "escalate":
      return "warning";
    case "block":
    case "reject":
      return "danger";
    default:
      return "neutral";
  }
}

/** Display name for a provider id (honest passthrough for unknown ids). */
export function providerDisplayName(id: string | null | undefined): string {
  if (!id) return "—";
  if (id === "codex") return "Codex";
  if (id === "claude") return "Claude";
  return id;
}

/** Which per-agent accent a provider maps to. */
export function providerTone(id: string | null | undefined): Tone {
  if (id === "codex") return "codex";
  if (id === "claude") return "claude";
  return "neutral";
}
