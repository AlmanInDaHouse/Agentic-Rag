/**
 * Integrated-run view-model (A10-W.8b) — derives the product UI's honest display state
 * from the backend's persisted run record + event stream. Honest-by-construction
 * (mandate §10): provider provenance distinguishes real from mock; events are rendered
 * in persisted sequence with gaps flagged (never invented); changed files are never
 * hidden; captured text is sanitized (secrets masked, terminal escapes stripped,
 * truncation flagged); `unknown` is never shown as `0`.
 *
 * Pure + deterministic (unit-tested); the component just renders this.
 */

import { safeText, safeFilename } from "./sanitize.js";

export interface ProviderProvenanceDTO {
  provider: string;
  mode: "mock" | "real";
  version: string;
  isReal: boolean;
}

export interface IntegratedRunEventDTO {
  sequenceNumber: number;
  type: string;
  provider: string | null;
  providerVersion: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export interface IntegratedRunReportDTO {
  governance: { verdict: string };
  merged: boolean;
  repairState: string;
  ledgerEntryCount: number;
  reconciledTampered: boolean;
  gateTampered: boolean;
  cleanedUp: boolean;
  changedFiles: { path: string; status: string }[];
  diffText: string | null;
}

export interface IntegratedRunRecordDTO {
  id: string;
  status: string;
  spec: { providerMode: string; collaborationMode: string; owner: string; reviewer: string; objective: string };
  ownerProvenance: ProviderProvenanceDTO | null;
  reviewerProvenance: ProviderProvenanceDTO | null;
  report: IntegratedRunReportDTO | null;
  terminalReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProviderIdentityView {
  /** e.g. "codex — real (0.142.4)" or "codex — mock (mock-codex)" or "unknown". */
  label: string;
  isReal: boolean | "unknown";
  version: string;
}

export interface TimelineEventView {
  sequenceNumber: number;
  type: string;
  provider: string | null;
  providerVersion: string | null;
  detail: string;
  detailTruncated: boolean;
  at: string;
}

export interface IntegratedRunView {
  id: string;
  statusLabel: string;
  isTerminal: boolean;
  mode: string;
  collaborationMode: string;
  owner: ProviderIdentityView;
  reviewer: ProviderIdentityView;
  events: TimelineEventView[];
  /** True when persisted sequence numbers are NOT a gapless 1..N run. */
  sequenceGap: boolean;
  /** Count of terminal events; exactly 1 is the honest invariant. */
  terminalCount: number;
  governanceVerdict: string; // "merge" | "hold" | ... | "unknown"
  merged: boolean | "unknown";
  changedFiles: { path: string; status: string }[];
  diff: { present: boolean; lineCount: number | "unknown"; truncated: boolean };
  cleanup: boolean | "unknown";
  terminalReason: string | null;
}

const TERMINAL_EVENT_TYPES = ["run.completed", "run.failed", "run.cancelled", "run.blocked"];
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "blocked"];

function provenanceView(p: ProviderProvenanceDTO | null, fallbackProvider: string): ProviderIdentityView {
  if (!p) {
    return { label: `${fallbackProvider} — unknown`, isReal: "unknown", version: "unknown" };
  }
  const kind = p.isReal ? "real" : "mock";
  return { label: `${p.provider} — ${kind} (${p.version || "unknown"})`, isReal: p.isReal, version: p.version || "unknown" };
}

/** Best-effort human detail for a persisted event payload (sanitized + truncated). */
function eventDetail(event: IntegratedRunEventDTO): { detail: string; truncated: boolean } {
  const p = event.payload ?? {};
  const pick =
    (typeof p.text === "string" && p.text) ||
    (typeof p.reason === "string" && p.reason) ||
    (typeof p.summary === "string" && p.summary) ||
    (typeof p.verdict === "string" && `verdict: ${p.verdict}`) ||
    (typeof p.status === "string" && `status: ${p.status}`) ||
    (typeof p.path === "string" && `file: ${p.path}`) ||
    "";
  if (!pick) {
    return { detail: "", truncated: false };
  }
  const safe = safeText(String(pick), 2000);
  return { detail: safe.text, truncated: safe.truncated };
}

export function deriveIntegratedRunView(record: IntegratedRunRecordDTO, events: IntegratedRunEventDTO[]): IntegratedRunView {
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const sequenceGap = ordered.some((e, i) => e.sequenceNumber !== i + 1);
  const terminalCount = ordered.filter((e) => TERMINAL_EVENT_TYPES.includes(e.type)).length;

  const report = record.report;
  const diffText = report?.diffText ?? null;
  const diffLines = diffText === null ? "unknown" : diffText.split("\n").length;

  return {
    id: record.id,
    statusLabel: record.status,
    isTerminal: TERMINAL_STATUSES.includes(record.status),
    mode: record.spec.providerMode,
    collaborationMode: record.spec.collaborationMode,
    owner: provenanceView(record.ownerProvenance, record.spec.owner),
    reviewer: provenanceView(record.reviewerProvenance, record.spec.reviewer),
    events: ordered.map((e) => {
      const d = eventDetail(e);
      return {
        sequenceNumber: e.sequenceNumber,
        type: e.type,
        provider: e.provider,
        providerVersion: e.providerVersion,
        detail: d.detail,
        detailTruncated: d.truncated,
        at: e.at
      };
    }),
    sequenceGap,
    terminalCount,
    governanceVerdict: report?.governance.verdict ?? "unknown",
    merged: report ? report.merged : "unknown",
    changedFiles: (report?.changedFiles ?? []).map((f) => ({ path: safeFilename(f.path), status: f.status })),
    diff: { present: diffText !== null, lineCount: diffLines, truncated: diffText !== null && diffText.length >= 20_000 },
    cleanup: report ? report.cleanedUp : "unknown",
    terminalReason: record.terminalReason ? safeText(record.terminalReason, 500).text : null
  };
}
