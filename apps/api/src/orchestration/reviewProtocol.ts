/**
 * Review protocol (A4.4) — structured findings + severity gate.
 *
 * Normalizes a reviewer's output into the A1 `ReviewFindings` artifact, where every
 * finding carries the nine mandated fields (mandate §A4.4): severity, category,
 * file, line, evidence, impact, requiredAction, missingTest and confidence. A
 * severity gate then decides whether the run may proceed: any OPEN blocker/critical
 * finding stops it (Vision §15 governance posture — no progress with open
 * blocker/critical findings).
 *
 * `reviewFindingsFromEvents` maps a reviewer adapter's normalized event stream
 * (driven by the MOCK adapters in tests) into findings deterministically. Because
 * A4 performs NO real writes, a `file.changed` event on a read-only review run is
 * itself a blocker (an unauthorized write attempt, T-INT-14 territory).
 *
 * Pure and deterministic: no clock, no randomness, no I/O.
 */

import {
  ReviewFindingSchema,
  ReviewFindingsSchema,
  type FindingSeverity,
  type ProviderEvent,
  type ProviderId,
  type ReviewFinding,
  type ReviewFindings
} from "@triforge/shared";

/** Severities that BLOCK progress when open (mandate §A4.4 / Vision §15). */
export const BLOCKING_SEVERITIES: ReadonlySet<FindingSeverity> = new Set<FindingSeverity>([
  "blocker",
  "critical"
]);

export interface SeverityGateResult {
  /** True when no open blocker/critical finding exists → the run may proceed. */
  passed: boolean;
  /** The blocker/critical findings that would stop the run (empty when passed). */
  blocking: ReviewFinding[];
  /** Counts by severity (audit/report). */
  counts: Record<FindingSeverity, number>;
}

/** A loose, partial finding accepted from a reviewer before normalization. */
export interface RawReviewFinding {
  severity: FindingSeverity;
  category: string;
  evidence: string;
  impact: string;
  requiredAction: string;
  file?: string | null;
  line?: number | null;
  missingTest?: string | null;
  confidence?: number;
}

const ALL_SEVERITIES: FindingSeverity[] = ["blocker", "critical", "major", "minor", "observation"];

/** Normalize one raw finding into a schema-valid `ReviewFinding` (fills the 9 fields). */
export function normalizeReviewFinding(raw: RawReviewFinding): ReviewFinding {
  return ReviewFindingSchema.parse({
    severity: raw.severity,
    category: raw.category,
    file: raw.file ?? null,
    line: raw.line ?? null,
    evidence: raw.evidence,
    impact: raw.impact,
    requiredAction: raw.requiredAction,
    missingTest: raw.missingTest ?? null,
    confidence: clamp01(raw.confidence ?? 0.75)
  });
}

/** Build a validated `ReviewFindings` artifact from raw findings. */
export function buildReviewFindings(
  reviewer: ProviderId,
  summary: string,
  rawFindings: RawReviewFinding[]
): ReviewFindings {
  return ReviewFindingsSchema.parse({
    reviewer,
    summary,
    findings: rawFindings.map(normalizeReviewFinding)
  });
}

/** Count findings by severity. */
export function summarizeSeverity(findings: ReviewFinding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    blocker: 0,
    critical: 0,
    major: 0,
    minor: 0,
    observation: 0
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/**
 * The severity gate: no open blocker/critical → proceed. Returns the blocking
 * findings so the caller can record exactly what stopped the run. Accepts either a
 * `ReviewFindings` artifact or a flat list of findings (e.g. several reviews merged).
 */
export function severityGate(input: ReviewFindings | ReviewFinding[]): SeverityGateResult {
  const findings = Array.isArray(input) ? input : input.findings;
  const blocking = findings.filter((finding) => BLOCKING_SEVERITIES.has(finding.severity));
  return {
    passed: blocking.length === 0,
    blocking,
    counts: summarizeSeverity(findings)
  };
}

export interface FromEventsOptions {
  /**
   * The phase the events belong to. A `self` review is the owner reviewing its own
   * read-only run; a `cross` review is the other provider reviewing adversarially.
   */
  kind: "self" | "cross";
  /** Optional target descriptor (e.g. the owner whose work is under review). */
  target?: string;
}

/**
 * Map a reviewer adapter's normalized event stream into a `ReviewFindings` artifact.
 *
 * Deterministic mapping (read-only review; A4 never writes):
 *  - a `file.changed` event → BLOCKER (unauthorized write attempt under read-only);
 *  - a terminal `run.failed` → MAJOR (the reviewed run did not complete cleanly);
 *  - each `warning.raised` → MINOR;
 *  - an `approval.requested` → MAJOR (a gated action surfaced);
 *  - otherwise → a single OBSERVATION ("no blocking findings").
 */
export function reviewFindingsFromEvents(
  reviewer: ProviderId,
  events: ProviderEvent[],
  options: FromEventsOptions
): ReviewFindings {
  const raw: RawReviewFinding[] = [];
  const targetLabel = options.target ? ` of ${options.target}` : "";

  for (const event of events) {
    if (event.type === "file.changed") {
      const payload = event.payload as { path: string; changeType: string };
      raw.push({
        severity: "blocker",
        category: "unauthorized_write",
        file: payload.path,
        line: null,
        evidence: `file.changed (${payload.changeType}) emitted on a read-only ${options.kind} review`,
        impact: "A4 forbids real writes; a mutation under a read-only run is an unauthorized write attempt.",
        requiredAction: "Reject the change and keep the run read-only until A5 grants a bound writable capability.",
        missingTest: "regression test asserting read-only runs never mutate the workspace",
        confidence: 0.99
      });
    } else if (event.type === "approval.requested") {
      const payload = event.payload as { actionType: string; riskLevel: string };
      raw.push({
        severity: "major",
        category: "gated_action",
        evidence: `approval.requested for "${payload.actionType}" at risk ${payload.riskLevel}`,
        impact: "A gated action surfaced during review and must be resolved before progress.",
        requiredAction: "Route the action through the approval gate / governance decision.",
        confidence: 0.8
      });
    } else if (event.type === "warning.raised") {
      const payload = event.payload as { code: string; message: string };
      raw.push({
        severity: "minor",
        category: payload.code,
        evidence: payload.message,
        impact: "Non-fatal warning surfaced by the provider.",
        requiredAction: "Review the warning and address it if it affects correctness.",
        confidence: 0.6
      });
    }
  }

  const terminal = [...events].reverse().find((event) => event.type === "run.failed");
  if (terminal) {
    const payload = terminal.payload as { errorCode: string; message: string };
    raw.push({
      severity: "major",
      category: `run_failed:${payload.errorCode}`,
      evidence: payload.message,
      impact: `The reviewed${targetLabel} run terminated with "${payload.errorCode}" and did not complete cleanly.`,
      requiredAction: "Inspect the partial result and decide whether to repair, halt or re-route.",
      missingTest: null,
      confidence: 0.85
    });
  }

  const summary =
    raw.length === 0
      ? `No blocking findings on the ${options.kind} review${targetLabel}.`
      : `${raw.length} finding(s) on the ${options.kind} review${targetLabel}.`;

  if (raw.length === 0) {
    raw.push({
      severity: "observation",
      category: "clean_review",
      evidence: "Read-only review completed with no contract violations or warnings.",
      impact: "None observed.",
      requiredAction: "Proceed.",
      confidence: 0.7
    });
  }

  return buildReviewFindings(reviewer, summary, raw);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export { ALL_SEVERITIES };
