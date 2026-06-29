/**
 * Worktree state capture (A5.5) — computes the REAL set of file changes in a
 * worktree from git (the working tree vs HEAD), independent of any provider
 * narrative. This is the evidence the mutation ledger is reconciled against
 * (`reconcile.ts`; SAT-A5-6).
 *
 * Uses the hardened `GitRunner` (A5.1) and NUL-delimited porcelain (`-z`) so hostile
 * filenames (spaces, quotes, newlines) are handled literally and cannot be
 * misparsed. `--untracked-files=all` lists every untracked FILE individually (git
 * otherwise collapses a wholly-untracked NEW directory to `dir/`, which would hide
 * the actual files from reconciliation). Content hashes are read from the working file.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GitRunner } from "../worktree/index.js";

export type ChangeStatus = "create" | "modify" | "delete" | "rename";

export interface WorktreeChange {
  /** Workspace-relative path (POSIX) of the changed file (the new path for a rename). */
  relPath: string;
  status: ChangeStatus;
  /** sha256 of the current working file, or null when deleted. */
  hash: string | null;
  /** Previous path for a rename. */
  renamedFrom?: string;
}

function mapStatus(xy: string): ChangeStatus {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "R" || x === "C") {
    return "rename";
  }
  if (x === "D" || y === "D") {
    return "delete";
  }
  if (x === "?" || x === "A") {
    return "create";
  }
  return "modify";
}

async function hashFile(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absPath);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Compute the changed files in `worktreePath` (working tree vs HEAD), with a content
 * hash per non-deleted file. Returns [] for a clean tree. Throws on a git failure.
 */
export async function computeWorktreeChanges(
  git: GitRunner,
  worktreePath: string
): Promise<WorktreeChange[]> {
  const res = await git.run(["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: worktreePath });
  if (res.spawnFailed || res.code !== 0) {
    throw new Error(`git status failed in ${worktreePath}: ${res.stderr.trim()}`);
  }
  const tokens = res.stdout.split("\0");
  const changes: WorktreeChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const rec = tokens[i];
    if (rec === undefined || rec.length === 0) {
      i += 1;
      continue;
    }
    // Porcelain -z record: "XY <path>"; X at 0, Y at 1, space at 2, path from 3.
    const xy = rec.slice(0, 2);
    const relPath = rec.slice(3);
    const status = mapStatus(xy);
    if (status === "rename") {
      const renamedFrom = tokens[i + 1] ?? "";
      i += 2;
      changes.push({
        relPath,
        status,
        renamedFrom,
        hash: await hashFile(path.join(worktreePath, relPath))
      });
      continue;
    }
    i += 1;
    changes.push({
      relPath,
      status,
      hash: status === "delete" ? null : await hashFile(path.join(worktreePath, relPath))
    });
  }
  return changes;
}

/**
 * Stable hash over a set of changes (the "reviewed diff hash"). Order-independent;
 * a later recomputation that differs proves the worktree changed after review.
 */
export function diffHash(changes: WorktreeChange[]): string {
  const canonical = [...changes]
    .map((c) => `${c.status}:${c.relPath}:${c.hash ?? "∅"}:${c.renamedFrom ?? ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
