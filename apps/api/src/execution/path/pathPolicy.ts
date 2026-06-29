/**
 * Allowed-Path Policy (A5.2) — the enforcement engine that decides whether an
 * owner agent may READ or WRITE a given path inside an isolated worktree.
 *
 * It is the first owner-facing security boundary of writable execution. The model
 * is a precise allow-list carved INSIDE an otherwise-blocked filesystem (the
 * worktree lives under `$HOME`, so "block `$HOME`" cannot be a blanket rule —
 * T-FS-08): the ONLY thing allowed is a path that, after full canonicalization,
 * stays inside the workspace root AND clears the per-policy gates. Everything else
 * — `/mnt/c`, `$HOME`, sibling worktrees, the state root, the shared `.git` object
 * store — is outside the workspace and therefore denied by containment.
 *
 * Resolution pipeline (security-critical; PROVIDER_REPOSITORY_THREAT_MODEL_SPEC
 * T-FS-01/02/03/04/07, SAT-A5-1/2/3):
 *
 *   1. validate the raw input (no NUL, bounded);
 *   2. `path.resolve(workspaceRoot, input)` — collapses `..` lexically; an absolute
 *      or `..`-escaping input lands outside and is rejected (traversal /
 *      prefix-confusion);
 *   3. realpath the NEAREST EXISTING ANCESTOR and require it stay inside
 *      realpath(workspaceRoot) — this catches a symlinked ancestor escaping the
 *      workspace, and safely validates a not-yet-existing target via its existing
 *      ancestor;
 *   4. if the full target exists, realpath it and re-check containment (a symlinked
 *      leaf), and for a WRITE refuse a multiply-linked file (hardlink clobber,
 *      T-FS-04 — conservative: a fresh worktree has no legitimate hardlinks);
 *   5. refuse any `.git` path segment (the worktree's `.git` gitdir link + the
 *      shared object store, T-FS-08);
 *   6. refuse a `blockedPaths` match (always wins);
 *   7. gate on `readPaths` / `writePaths`; enforce `maxFilesChanged` for writes.
 *
 * Returns the canonical `realPath`; callers MUST open THAT, not re-resolve the
 * input, to limit the check→open TOCTOU window (full TOCTOU hardening is A9; the
 * residual is RR-2). Case-insensitive matching is applied to the `.git` block so a
 * case-folding filesystem cannot smuggle `.GIT`.
 */

import {
  lstatSync,
  realpathSync,
  existsSync,
  type Stats
} from "node:fs";
import path from "node:path";

export interface AllowedPathPolicy {
  /** Workspace-relative path prefixes the owner may READ. `["."]`/`[""]` = all. */
  readPaths: string[];
  /** Workspace-relative path prefixes the owner may WRITE. Empty = nothing writable. */
  writePaths: string[];
  /** Workspace-relative prefixes ALWAYS denied (override read/write). */
  blockedPaths: string[];
  /** Maximum distinct files a single run may write. */
  maxFilesChanged: number;
}

export type PathAccessMode = "read" | "write";

export type PathDenyReason =
  | "invalid_input"
  | "traversal"
  | "symlink_escape"
  | "hardlink"
  | "blocked_git"
  | "blocked_path"
  | "not_readable"
  | "not_writable"
  | "max_files";

export interface PathDecision {
  allowed: boolean;
  mode: PathAccessMode;
  input: string;
  /** Canonical real path to open when `allowed` (callers MUST use this). */
  realPath?: string;
  /** Workspace-relative normalized path (POSIX separators). */
  relPath?: string;
  reason?: PathDenyReason;
  detail?: string;
}

export interface PathPolicyAuditEntry {
  timestamp: string;
  mode: PathAccessMode;
  input: string;
  allowed: boolean;
  reason?: PathDenyReason;
  relPath?: string;
}

export interface PathPolicyEngineOptions {
  /** Absolute path to the workspace (worktree) root. */
  workspaceRoot: string;
  policy: AllowedPathPolicy;
  /** Clock for audit timestamps (deterministic in tests). */
  clock: { iso(): string };
  /** Optional audit sink for every decision. */
  onAudit?: (entry: PathPolicyAuditEntry) => void;
}

const MAX_INPUT_LENGTH = 4096;

export class PathPolicyEngine {
  private readonly workspaceRoot: string;
  private readonly realWorkspaceRoot: string;
  private readonly policy: AllowedPathPolicy;
  private readonly clock: { iso(): string };
  private readonly onAudit?: (entry: PathPolicyAuditEntry) => void;
  /** Distinct canonical files approved for write (for maxFilesChanged). */
  private readonly writtenFiles = new Set<string>();

  constructor(options: PathPolicyEngineOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    // Canonicalize the workspace root once; fall back to the resolved path when it
    // does not yet exist on disk (containment then uses the lexical root).
    this.realWorkspaceRoot = existsSync(this.workspaceRoot)
      ? realpathSync(this.workspaceRoot)
      : this.workspaceRoot;
    this.policy = options.policy;
    this.clock = options.clock;
    this.onAudit = options.onAudit;
  }

  checkRead(input: string): PathDecision {
    return this.check("read", input);
  }

  checkWrite(input: string): PathDecision {
    return this.check("write", input);
  }

  /** Number of distinct files approved for write so far (maxFilesChanged budget). */
  approvedWriteCount(): number {
    return this.writtenFiles.size;
  }

  check(mode: PathAccessMode, input: string): PathDecision {
    const decision = this.evaluate(mode, input);
    this.audit(decision);
    return decision;
  }

  private evaluate(mode: PathAccessMode, input: string): PathDecision {
    const deny = (reason: PathDenyReason, detail?: string): PathDecision => ({
      allowed: false,
      mode,
      input,
      reason,
      detail
    });

    // 1. Validate raw input.
    if (typeof input !== "string" || input.length === 0 || input.length > MAX_INPUT_LENGTH) {
      return deny("invalid_input", "empty or oversized path");
    }
    if (input.includes("\0")) {
      return deny("invalid_input", "NUL byte in path");
    }

    // 2. Lexical resolution + containment (rejects `..` and absolute escapes).
    //    Resolve against the CANONICAL workspace root so a symlinked temp/base
    //    (e.g. macOS `/var` -> `/private/var`) does not skew containment.
    const candidate = path.resolve(this.realWorkspaceRoot, input);
    const lexRel = path.relative(this.realWorkspaceRoot, candidate);
    if (lexRel.startsWith("..") || path.isAbsolute(lexRel)) {
      return deny("traversal", `path escapes the workspace: ${candidate}`);
    }

    // 3. Realpath the nearest existing ancestor; require containment.
    const ancestorReal = this.nearestExistingRealPath(candidate);
    if (ancestorReal === null || !this.isWithinRealRoot(ancestorReal)) {
      return deny("symlink_escape", `path resolves outside the workspace via a link: ${candidate}`);
    }

    // 4. If the full target exists, realpath it and re-check (symlinked leaf), and
    //    refuse a hardlinked write target (T-FS-04).
    let realPath = candidate;
    let leafStat: Stats | null = null;
    if (existsSync(candidate)) {
      try {
        realPath = realpathSync(candidate);
      } catch {
        return deny("symlink_escape", "could not canonicalize an existing path");
      }
      if (!this.isWithinRealRoot(realPath)) {
        return deny("symlink_escape", `path resolves outside the workspace via a link: ${realPath}`);
      }
      try {
        leafStat = lstatSync(candidate);
      } catch {
        leafStat = null;
      }
      if (mode === "write" && leafStat !== null && leafStat.isFile() && leafStat.nlink > 1) {
        return deny("hardlink", `refusing to write a multiply-linked file (nlink=${leafStat.nlink})`);
      }
    }

    // Canonical workspace-relative path (POSIX separators for stable matching).
    const relPath = toPosix(path.relative(this.realWorkspaceRoot, realPath) || ".");

    // 5. Block any `.git` segment (case-insensitive) — the gitdir link + the shared
    //    object store (T-FS-08).
    if (hasSegment(relPath, ".git")) {
      return { ...deny("blocked_git", "the worktree .git is not accessible"), relPath };
    }

    // 6. blockedPaths always win.
    if (this.matchesAny(relPath, this.policy.blockedPaths)) {
      return { ...deny("blocked_path", "path is explicitly blocked"), relPath };
    }

    // 7. read/write gating.
    if (mode === "read") {
      if (!this.matchesAny(relPath, this.policy.readPaths)) {
        return { ...deny("not_readable", "path is not within readPaths"), relPath };
      }
      return { allowed: true, mode, input, realPath, relPath };
    }

    // write
    if (!this.matchesAny(relPath, this.policy.writePaths)) {
      return { ...deny("not_writable", "path is not within writePaths"), relPath };
    }
    if (!this.writtenFiles.has(realPath) && this.writtenFiles.size >= this.policy.maxFilesChanged) {
      return { ...deny("max_files", `maxFilesChanged=${this.policy.maxFilesChanged} reached`), relPath };
    }
    this.writtenFiles.add(realPath);
    return { allowed: true, mode, input, realPath, relPath };
  }

  /** True when `realTarget` is the workspace root or strictly inside it. */
  private isWithinRealRoot(realTarget: string): boolean {
    if (realTarget === this.realWorkspaceRoot) {
      return true;
    }
    return realTarget.startsWith(this.realWorkspaceRoot + path.sep);
  }

  /** Realpath of the nearest existing ancestor of `target` (or null on failure). */
  private nearestExistingRealPath(target: string): string | null {
    let cursor = target;
    // Walk up until an existing path is found.
    // The loop terminates at the filesystem root.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (existsSync(cursor)) {
        try {
          return realpathSync(cursor);
        } catch {
          return null;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return null;
      }
      cursor = parent;
    }
  }

  private matchesAny(relPath: string, prefixes: string[]): boolean {
    for (const raw of prefixes) {
      const prefix = normalizePrefix(raw);
      if (prefix === "" || prefix === ".") {
        return true; // whole workspace
      }
      if (relPath === prefix || relPath.startsWith(prefix + "/")) {
        return true;
      }
    }
    return false;
  }

  private audit(decision: PathDecision): void {
    if (this.onAudit === undefined) {
      return;
    }
    try {
      this.onAudit({
        timestamp: this.clock.iso(),
        mode: decision.mode,
        input: decision.input,
        allowed: decision.allowed,
        reason: decision.reason,
        relPath: decision.relPath
      });
    } catch {
      /* an audit sink must never break enforcement */
    }
  }
}

// --- helpers ---------------------------------------------------------------

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Normalize a policy prefix to a POSIX, leading-`./`-stripped form. */
function normalizePrefix(raw: string): string {
  const posix = raw.split(path.sep).join("/").trim();
  let p = posix;
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  if (p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/** True when `relPath` (POSIX) contains a path segment equal to `seg` (case-insensitive). */
function hasSegment(relPath: string, seg: string): boolean {
  const target = seg.toLowerCase();
  return relPath.split("/").some((s) => s.toLowerCase() === target);
}
