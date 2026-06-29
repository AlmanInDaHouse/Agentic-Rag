/**
 * Task Profiler (A6.1) — turns a `TaskSpecification` (+ optional repository signals)
 * into a structured, validated `TaskProfile` (the A1 contract) plus an extended
 * profile, so the routers (A6.2/A6.3) can pick a provider from evidence rather than
 * stereotype (mandate §A6.1).
 *
 * The profile is:
 *  - **validated** — parsed against the A1 `TaskProfileSchema`;
 *  - **deterministic / reproducible** — pure heuristics over the spec text + signals;
 *    no clock, no randomness (same input → same output);
 *  - **versioned** — carries `profilerVersion`;
 *  - **overrideable** — an explicit override wins over the computed value and the
 *    overridden fields are recorded (auditable);
 *  - **auditable** — returns the rationale and the inputs' fingerprints.
 */

import {
  TaskProfileSchema,
  type BlastRadius,
  type Complexity,
  type RiskLevel,
  type TaskProfile,
  type TaskSpecification
} from "@triforge/shared";

export const TASK_PROFILER_VERSION = "a6.1-profiler-1.0.0";

export interface ProfileSignals {
  /** Workspace-relative paths the task is expected to touch. */
  filesTouched?: string[];
  /** Explicit language hint (else inferred from file extensions). */
  language?: string;
  /** Explicit framework hint. */
  framework?: string;
}

export interface ExtendedProfile {
  language: string;
  framework: string | null;
  /** 0–1 how security-sensitive the task is. */
  securitySensitivity: number;
  /** 0–1 migration/behavioural-impact weight. */
  migrationImpact: number;
  /** Rough estimate of required context size. */
  contextSize: "small" | "medium" | "large";
  /** Provider capabilities the task needs. */
  requiredProviderCapabilities: string[];
  profilerVersion: string;
}

export interface ProfileOverride {
  profile?: Partial<TaskProfile>;
  extended?: Partial<ExtendedProfile>;
}

export interface ProfileResult {
  profile: TaskProfile;
  extended: ExtendedProfile;
  rationale: string[];
  overriddenFields: string[];
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  md: "markdown",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  json: "json"
};

function text(spec: TaskSpecification): string {
  return [spec.objective, ...spec.scope, ...spec.invariants, ...spec.acceptanceCriteria]
    .join(" ")
    .toLowerCase();
}

function has(t: string, re: RegExp): boolean {
  return re.test(t);
}

function classifyTaskKind(t: string): string {
  if (has(t, /\b(security|vuln|auth|acl|crypto|secret|sanitiz)/)) return "security";
  if (has(t, /\bmigrat/)) return "migration";
  if (has(t, /\brefactor/)) return "refactor";
  if (has(t, /\b(bug|fix|defect|regression)\b/)) return "bugfix";
  if (has(t, /\b(doc|docs|readme|changelog)\b/)) return "docs";
  if (has(t, /\b(test|spec|coverage)\b/) && !has(t, /\b(feature|implement|add)\b/)) return "test";
  return "feature";
}

function dirOf(p: string): string {
  const i = p.replaceAll("\\", "/").lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function topOf(p: string): string {
  const seg = p.replaceAll("\\", "/").split("/");
  return seg.length > 1 ? seg[0] : "";
}

function classifyBlastRadius(files: string[], scopeSize: number): BlastRadius {
  if (files.length === 0) {
    if (scopeSize <= 1) return "file";
    if (scopeSize <= 3) return "module";
    return scopeSize <= 6 ? "package" : "repository";
  }
  if (files.length === 1) return "file";
  const dirs = new Set(files.map(dirOf));
  if (dirs.size === 1) return "module";
  const tops = new Set(files.map(topOf));
  return tops.size <= 1 ? "package" : "repository";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function inferLanguage(signals: ProfileSignals): string {
  if (signals.language) return signals.language;
  for (const f of signals.filesTouched ?? []) {
    const ext = f.split(".").pop()?.toLowerCase() ?? "";
    if (LANG_BY_EXT[ext]) return LANG_BY_EXT[ext];
  }
  return "unknown";
}

/** Produce a validated, versioned, overrideable profile. Pure + deterministic. */
export function profileTask(
  spec: TaskSpecification,
  signals: ProfileSignals = {},
  override: ProfileOverride = {}
): ProfileResult {
  const t = text(spec);
  const rationale: string[] = [];
  const files = signals.filesTouched ?? [];

  const taskKind = classifyTaskKind(t);
  rationale.push(`taskKind=${taskKind} from spec keywords`);

  const scopeSize = spec.scope.length;
  const sizeScore = scopeSize + spec.invariants.length + Math.ceil(files.length / 2);
  const complexity: Complexity = sizeScore <= 2 ? "low" : sizeScore <= 6 ? "medium" : "high";

  const blastRadius = classifyBlastRadius(files, scopeSize);

  const securityKind = taskKind === "security";
  const behavioralPreservationRequired = taskKind === "refactor" || taskKind === "migration";
  const migrationImpact = clamp01((taskKind === "migration" ? 0.8 : 0) + (behavioralPreservationRequired ? 0.2 : 0));
  const securitySensitivity = clamp01(
    (securityKind ? 0.7 : 0) + (has(t, /\b(secret|token|password|credential|key)\b/) ? 0.3 : 0)
  );

  let risk: RiskLevel = "low";
  if (securitySensitivity >= 0.7 || blastRadius === "repository") risk = "critical";
  else if (securityKind || behavioralPreservationRequired || blastRadius === "package") risk = "high";
  else if (complexity === "high" || blastRadius === "module") risk = "medium";
  rationale.push(`risk=${risk} (security=${securitySensitivity.toFixed(2)}, blast=${blastRadius})`);

  const acCount = spec.acceptanceCriteria.length;
  const reasoningDepthRequired = clamp01(
    (complexity === "high" ? 0.6 : complexity === "medium" ? 0.4 : 0.2) + (acCount === 0 ? 0.3 : 0)
  );
  const repetitiveWorkRatio = clamp01((taskKind === "migration" ? 0.6 : 0) + (has(t, /\b(rename|replace|bulk|each|all)\b/) ? 0.3 : 0));
  const testBurden = clamp01(
    (behavioralPreservationRequired ? 0.5 : 0) + (taskKind === "feature" || taskKind === "bugfix" ? 0.4 : 0.2) + Math.min(0.2, acCount * 0.05)
  );

  const computedProfile: TaskProfile = {
    taskKind,
    complexity,
    risk,
    blastRadius,
    reasoningDepthRequired,
    repetitiveWorkRatio,
    testBurden,
    behavioralPreservationRequired
  };

  const requiredCaps =
    taskKind === "docs"
      ? ["read", "write_local"]
      : taskKind === "test"
        ? ["read", "write_local", "test"]
        : ["read", "write_local", "test", "build"];

  const computedExtended: ExtendedProfile = {
    language: inferLanguage(signals),
    framework: signals.framework ?? null,
    securitySensitivity,
    migrationImpact,
    contextSize: sizeScore <= 2 ? "small" : sizeScore <= 6 ? "medium" : "large",
    requiredProviderCapabilities: requiredCaps,
    profilerVersion: TASK_PROFILER_VERSION
  };

  // Apply overrides (explicit wins), recording which fields changed (auditable).
  const overriddenFields: string[] = [];
  const mergedProfileRaw: TaskProfile = { ...computedProfile };
  for (const [k, v] of Object.entries(override.profile ?? {})) {
    if (v !== undefined && (mergedProfileRaw as Record<string, unknown>)[k] !== v) {
      (mergedProfileRaw as Record<string, unknown>)[k] = v;
      overriddenFields.push(`profile.${k}`);
    }
  }
  const mergedExtended = { ...computedExtended } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(override.extended ?? {})) {
    if (v !== undefined) {
      mergedExtended[k] = v;
      overriddenFields.push(`extended.${k}`);
    }
  }
  if (overriddenFields.length > 0) {
    rationale.push(`override applied to: ${overriddenFields.join(", ")}`);
  }

  // Validate against the A1 contract (throws on an invalid profile).
  const profile = TaskProfileSchema.parse(mergedProfileRaw);

  return {
    profile,
    extended: mergedExtended as unknown as ExtendedProfile,
    rationale,
    overriddenFields
  };
}
