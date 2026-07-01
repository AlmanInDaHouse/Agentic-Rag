/**
 * Per-agent activity view-model (A11 redesign) — the honest source for the dual
 * Codex/Claude monitoring panels.
 *
 * Every persisted event already carries the `provider` that emitted it. This splits the
 * event stream into an OWNER lane and a REVIEWER lane using that provider tag plus the
 * role semantics the pipeline guarantees (only the owner writes files / records
 * mutations; only the reviewer emits `review.completed`). Events with no provider (run
 * lifecycle, gates, governance, merge, cleanup) are orchestration and are NOT attributed
 * to an agent. Captured text is sanitized (secrets masked, control/ANSI stripped,
 * truncation flagged). Nothing is invented: if the backend emitted no events for a
 * provider, its lane is honestly empty.
 *
 * Pure + deterministic (unit-tested).
 */

import { safeText } from "./sanitize.js";
import { eventMeta, type ActivityKind, type Tone } from "./labels.js";
import type { IntegratedRunEventDTO } from "./integratedRun.js";

export type AgentRole = "owner" | "reviewer";

export interface ActivityItem {
  sequenceNumber: number;
  type: string;
  kind: ActivityKind;
  /** Spanish title for the event. */
  title: string;
  /** Sanitized human detail (may be empty). */
  detail: string;
  detailTruncated: boolean;
  tone: Tone;
  at: string;
}

export interface AgentLane {
  role: AgentRole;
  /** Provider id from the spec (e.g. "codex"). */
  provider: string;
  items: ActivityItem[];
  counts: {
    messages: number;
    changes: number;
    findings: number;
    tools: number;
    warnings: number;
  };
}

export interface AgentActivityView {
  owner: AgentLane;
  reviewer: AgentLane;
  /** True when owner and reviewer are the SAME provider (role split is best-effort). */
  sameProvider: boolean;
}

/** Event types the pipeline only ever emits for the OWNER role. */
const OWNER_TYPES = new Set(["repair.round.started", "file.changed", "mutations.recorded", "tool.started", "tool.completed"]);
/** Event types the pipeline only ever emits for the REVIEWER role. */
const REVIEWER_TYPES = new Set(["review.completed"]);

function roleForEvent(
  e: IntegratedRunEventDTO,
  ownerId: string,
  reviewerId: string
): AgentRole | null {
  if (OWNER_TYPES.has(e.type)) return "owner";
  if (REVIEWER_TYPES.has(e.type)) return "reviewer";
  if (e.provider === null) return null; // orchestration
  const isOwner = e.provider === ownerId;
  const isReviewer = e.provider === reviewerId;
  if (isOwner && !isReviewer) return "owner";
  if (isReviewer && !isOwner) return "reviewer";
  // Same provider for both roles (or unknown provider): default provider-tagged events
  // to the owner lane (the implement phase dominates a provider's messages).
  return e.provider ? "owner" : null;
}

/** Extract a Spanish-friendly detail from a payload, per event type. */
function detailFor(e: IntegratedRunEventDTO): { detail: string; truncated: boolean } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  let raw = "";
  switch (e.type) {
    case "agent.message":
      raw = typeof p.text === "string" ? p.text : "";
      break;
    case "file.changed":
      raw = typeof p.path === "string" ? p.path : "";
      break;
    case "warning.raised":
      raw = [typeof p.path === "string" ? p.path : "", typeof p.reason === "string" ? p.reason : ""].filter(Boolean).join(" — ");
      break;
    case "mutations.recorded": {
      const files = Array.isArray(p.filesChanged) ? (p.filesChanged as unknown[]).filter((x) => typeof x === "string") : [];
      const tamper = p.reconciledTampered === true || p.gateTampered === true ? " · integridad comprometida" : "";
      raw = `${files.length} fichero(s): ${files.slice(0, 6).join(", ")}${files.length > 6 ? "…" : ""}${tamper}`;
      break;
    }
    case "review.completed": {
      const f = (p.findings ?? {}) as Record<string, unknown>;
      const parts = ["blocker", "major", "minor", "observation"]
        .map((k) => ({ k, n: Number(f[k] ?? 0) }))
        .filter((x) => x.n > 0)
        .map((x) => `${x.n} ${x.k}`);
      const summary = typeof p.summary === "string" ? p.summary : "";
      raw = [summary, parts.length ? `hallazgos: ${parts.join(", ")}` : ""].filter(Boolean).join(" · ");
      break;
    }
    case "repair.round.started":
      raw = `ronda ${Number(p.round ?? 0)}`;
      break;
    case "tool.started":
    case "tool.completed":
      raw = typeof p.name === "string" ? p.name : typeof p.tool === "string" ? p.tool : "";
      break;
    case "quota.updated":
    case "usage.updated":
      raw =
        typeof p.remaining === "string" || typeof p.remaining === "number"
          ? `restante: ${String(p.remaining)}`
          : typeof p.summary === "string"
            ? p.summary
            : "";
      break;
    default:
      raw =
        (typeof p.text === "string" && p.text) ||
        (typeof p.reason === "string" && p.reason) ||
        (typeof p.summary === "string" && p.summary) ||
        "";
  }
  if (!raw) return { detail: "", truncated: false };
  const safe = safeText(String(raw), 1600);
  return { detail: safe.text, truncated: safe.truncated };
}

function emptyLane(role: AgentRole, provider: string): AgentLane {
  return { role, provider, items: [], counts: { messages: 0, changes: 0, findings: 0, tools: 0, warnings: 0 } };
}

export function deriveAgentActivity(
  events: IntegratedRunEventDTO[],
  ownerId: string,
  reviewerId: string
): AgentActivityView {
  const owner = emptyLane("owner", ownerId);
  const reviewer = emptyLane("reviewer", reviewerId);
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (const e of ordered) {
    const role = roleForEvent(e, ownerId, reviewerId);
    if (role === null) continue;
    const lane = role === "owner" ? owner : reviewer;
    const meta = eventMeta(e.type);
    const d = detailFor(e);
    lane.items.push({
      sequenceNumber: e.sequenceNumber,
      type: e.type,
      kind: meta.kind,
      title: meta.label,
      detail: d.detail,
      detailTruncated: d.truncated,
      tone: meta.tone,
      at: e.at
    });
    // Counts.
    if (e.type === "agent.message") lane.counts.messages += 1;
    else if (e.type === "file.changed") lane.counts.changes += 1;
    else if (e.type === "tool.started") lane.counts.tools += 1;
    else if (e.type === "warning.raised") lane.counts.warnings += 1;
    else if (e.type === "review.completed") {
      const f = (e.payload?.findings ?? {}) as Record<string, unknown>;
      lane.counts.findings += ["blocker", "major", "minor", "observation"].reduce((n, k) => n + Number(f[k] ?? 0), 0);
    }
  }

  return { owner, reviewer, sameProvider: ownerId === reviewerId };
}
