/**
 * A8.5 Diff & Review view-model (mandate §10 A8.5).
 *
 * Shows the complete diff and review WITHOUT hiding any changed file: the rendered file
 * set always equals the input change set (`hiddenFiles === 0` by construction). Binary /
 * deleted / renamed files are marked; diff text is truncation-flagged and sanitized;
 * findings are attached per file with their severity; and the diff hash is compared to
 * the REVIEWED hash so a change AFTER review is flagged. Pure + deterministic.
 */

import { safeFilename, safeText, type Truncated } from "./sanitize.js";

export type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "binary";

export interface DiffFile {
  path: string;
  status: DiffStatus;
  renamedFrom?: string;
  /** The unified diff patch, when textual. */
  patch?: string;
}

export interface Finding {
  severity: string;
  file?: string;
  message: string;
}

export interface DiffReviewInput {
  files: DiffFile[];
  findings: Finding[];
  gateOverall?: string;
  repairRounds: number;
  /** The diff hash currently in the worktree (A5.5). */
  diffHash: string;
  /** The diff hash that was actually reviewed (A5.8). */
  reviewedHash: string;
}

export interface DiffFileView {
  path: string;
  status: DiffStatus;
  renamedFrom: string | null;
  isBinary: boolean;
  patch: Truncated;
  findings: { severity: string; message: string }[];
}

export interface DiffReviewView {
  files: DiffFileView[];
  fileCount: number;
  /** Always 0 — every changed file is rendered (invariant). */
  hiddenFiles: number;
  changedAfterReview: boolean;
  repairRounds: number;
  gateOverall: string;
  findingsBySeverity: Record<string, number>;
}

export function buildDiffReview(input: DiffReviewInput): DiffReviewView {
  const findingsByFile = new Map<string, { severity: string; message: string }[]>();
  const findingsBySeverity: Record<string, number> = {};
  for (const f of input.findings) {
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
    const key = f.file ?? "__general__";
    const list = findingsByFile.get(key) ?? [];
    list.push({ severity: f.severity, message: safeText(f.message, 2000).text });
    findingsByFile.set(key, list);
  }

  // Render EVERY file — never hide a changed file.
  const files: DiffFileView[] = input.files.map((file) => ({
    path: safeFilename(file.path),
    status: file.status,
    renamedFrom: file.renamedFrom ? safeFilename(file.renamedFrom) : null,
    isBinary: file.status === "binary",
    patch: file.status === "binary" ? { text: "[binary file]", truncated: false } : safeText(file.patch ?? "", 50_000),
    findings: findingsByFile.get(file.path) ?? []
  }));

  return {
    files,
    fileCount: files.length,
    hiddenFiles: input.files.length - files.length, // 0 by construction
    changedAfterReview: input.diffHash !== input.reviewedHash,
    repairRounds: input.repairRounds,
    gateOverall: input.gateOverall ?? "unknown",
    findingsBySeverity
  };
}
