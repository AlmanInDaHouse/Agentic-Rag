/**
 * WorktreeManager (A5.1) — the first piece of TriForge's writable-execution
 * runtime. It administers isolated Git linked worktrees so that owner agents can
 * make REAL repository writes WITHOUT ever touching the primary working tree or
 * `main`.
 *
 * Security & isolation model (mandate §A5.1; WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC
 * §8.4; PROVIDER_REPOSITORY_THREAT_MODEL_SPEC T-FS-08, T-GIT-01/02/03):
 *
 *  - Work NEVER happens on `main`: every worktree is a NEW branch created from a
 *    base commit; protected branch names are refused (mandate "never work on main";
 *    SAT-A5-10 partial — the local branch guard).
 *  - Worktrees live in an EXTERNAL, manager-owned state root, NOT nested in the
 *    primary working tree, so the Code Graph scanner and Context Engine never walk
 *    managed state (substrate §8.4; T-FS-08).
 *  - Per-run AND per-task ownership with persistent metadata, plus owning-pid
 *    liveness so a crashed run's worktrees are detectable as stale and recoverable.
 *  - Every path is contained: ids are charset-validated, the resolved worktree path
 *    must stay inside the state root, and a symlinked ancestor escaping the state
 *    root is refused (T-FS-03/07 baseline for the manager's own paths; the full
 *    allowed-path policy is A5.2/A5.3).
 *  - All managed git ops run through the HARDENED `GitRunner` (hooks/global config
 *    neutralized), so `git worktree add` (which checks out, firing post-checkout)
 *    cannot execute repository-controlled code (T-GIT-01/02/03).
 *  - Collision prevention, disk-usage limits, cancellation, cleanup and an
 *    append-only audit trail round out the lifecycle.
 *
 * Residual risk (recorded in the capability binding): a worktree's `.git` and the
 * shared object store must still be blocked by the A5.2/A5.3 allowed-path policy —
 * worktree isolation is not object-store isolation (T-FS-08). `.gitattributes`
 * smudge/clean-filter neutralization is A5.4. No OS sandbox exists (RR-4).
 */

import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Clock } from "../../providers/clock.js";
import type { GitRunner, GitResult } from "./gitRunner.js";

/** Metadata record schema version (independent of the provider contract version). */
export const WORKTREE_METADATA_VERSION = "1.0.0";

/** Default per-run disk budget for the whole managed state root (512 MiB). */
const DEFAULT_DISK_LIMIT_BYTES = 512 * 1024 * 1024;

/** Branch names the manager refuses to create/operate on directly. */
const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "HEAD"] as const;

/** Safe id charset: no path separators, no `..`, bounded length. */
const SAFE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export type WorktreeStatus = "active" | "stale" | "cleaned";

/** Persistent, auditable record of one managed worktree. Carries no secrets. */
export interface WorktreeMetadata {
  metadataVersion: string;
  runId: string;
  taskId: string;
  branch: string;
  worktreePath: string;
  baseRepoPath: string;
  baseCommit: string;
  createdAt: string;
  ownerPid: number;
  status: WorktreeStatus;
}

export type WorktreeErrorCode =
  | "invalid_id"
  | "invalid_repo"
  | "dirty_base"
  | "branch_conflict"
  | "worktree_exists"
  | "collision"
  | "unsafe_path"
  | "symlink_escape"
  | "protected_branch"
  | "disk_limit"
  | "git_failed"
  | "not_found"
  | "fs_failed";

/** Typed, non-secret error for every refusal/failure path. */
export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;
  readonly detail?: string;
  constructor(code: WorktreeErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "WorktreeError";
    this.code = code;
    this.detail = detail;
  }
}

/** A single audit-trail entry (append-only JSONL). Carries no secrets. */
export interface WorktreeAuditEntry {
  timestamp: string;
  action: "create" | "cleanup" | "cancel" | "recover" | "refuse";
  runId: string;
  taskId: string;
  outcome: "ok" | "refused" | "failed";
  detail: string;
}

export interface CreateWorktreeRequest {
  runId: string;
  taskId: string;
  /** Base commit-ish to branch from; defaults to the base repo HEAD. */
  baseCommit?: string;
  /** Branch prefix; the branch is `<prefix>/<runId>/<taskId>`. Default `triforge`. */
  branchPrefix?: string;
  /** Refuse creation when the base repo working tree is dirty. Default false. */
  requireCleanBase?: boolean;
}

/** A live handle to a created worktree. */
export interface WorktreeHandle {
  metadata: WorktreeMetadata;
  /** Absolute path to the isolated worktree root. */
  path: string;
}

export interface WorktreeManagerOptions {
  /** Absolute path to the primary repository the worktrees branch from. */
  baseRepoPath: string;
  /** Hardened git boundary (NodeGitRunner in prod, FakeGitRunner in tests). */
  gitRunner: GitRunner;
  /** Injected clock — production never reads Date.now() directly. */
  clock: Clock;
  /**
   * External managed state root. Defaults to
   * `${XDG_STATE_HOME:-$HOME/.local/state}/triforge` (substrate §8.4). Tests inject
   * a temp dir. MUST be outside the base working tree.
   */
  stateRoot?: string;
  /** Owning process id stamped on metadata (default `process.pid`). */
  ownerPid?: number;
  /** Predicate deciding whether an owner pid is still alive (default: real probe). */
  isOwnerAlive?: (pid: number) => boolean;
  /** Total managed-state byte budget; a create over budget is refused. */
  diskLimitBytes?: number;
  /** Branch names refused for direct operation. */
  protectedBranches?: readonly string[];
  /** Optional sink for audit entries (always also appended to `<stateRoot>/audit.log`). */
  onAudit?: (entry: WorktreeAuditEntry) => void;
  /** Per-git-op timeout in ms. */
  gitTimeoutMs?: number;
}

/** Compute the default external state root per substrate §8.4. */
export function defaultStateRoot(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base =
    xdg && xdg.length > 0 ? xdg : path.join(homedir() || tmpdir(), ".local", "state");
  return path.join(base, "triforge");
}

export class WorktreeManager {
  private readonly baseRepoPath: string;
  private readonly git: GitRunner;
  private readonly clock: Clock;
  private readonly stateRoot: string;
  private readonly worktreesRoot: string;
  private readonly metaRoot: string;
  private readonly auditLogPath: string;
  private readonly ownerPid: number;
  private readonly isOwnerAlive: (pid: number) => boolean;
  private readonly diskLimitBytes: number;
  private readonly protectedBranches: ReadonlySet<string>;
  private readonly onAudit?: (entry: WorktreeAuditEntry) => void;
  private readonly gitTimeoutMs: number;

  constructor(options: WorktreeManagerOptions) {
    this.baseRepoPath = path.resolve(options.baseRepoPath);
    this.git = options.gitRunner;
    this.clock = options.clock;
    this.stateRoot = path.resolve(options.stateRoot ?? defaultStateRoot());
    this.worktreesRoot = path.join(this.stateRoot, "worktrees");
    this.metaRoot = path.join(this.stateRoot, "meta");
    this.auditLogPath = path.join(this.stateRoot, "audit.log");
    this.ownerPid = options.ownerPid ?? process.pid;
    this.isOwnerAlive = options.isOwnerAlive ?? defaultIsOwnerAlive;
    this.diskLimitBytes = options.diskLimitBytes ?? DEFAULT_DISK_LIMIT_BYTES;
    this.protectedBranches = new Set(
      (options.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES).map((b) => b.toLowerCase())
    );
    this.onAudit = options.onAudit;
    this.gitTimeoutMs = options.gitTimeoutMs ?? 60_000;
  }

  // --- public API --------------------------------------------------------

  /**
   * Create an isolated worktree on a NEW branch for (runId, taskId). Refuses on:
   * invalid ids, an invalid base repo, a dirty base (when required), a protected
   * branch, an existing run/task (reuse), a path collision, an unsafe/symlinked
   * path, a disk-budget overrun or a branch conflict. Never operates on `main`.
   */
  async create(req: CreateWorktreeRequest): Promise<WorktreeHandle> {
    const { runId, taskId } = req;
    this.assertId(runId, "runId");
    this.assertId(taskId, "taskId");

    const branchPrefix = req.branchPrefix ?? "triforge";
    this.assertId(branchPrefix, "branchPrefix");
    const branch = `${branchPrefix}/${runId}/${taskId}`;
    if (this.isProtectedBranch(branch) || this.isProtectedBranch(branchPrefix)) {
      await this.audit("refuse", runId, taskId, "refused", `protected branch ${branch}`);
      throw new WorktreeError("protected_branch", `refusing to create protected branch ${branch}`);
    }

    await fs.mkdir(this.worktreesRoot, { recursive: true });
    await fs.mkdir(this.metaRoot, { recursive: true });

    // Reuse rejection: metadata already present for this run/task.
    const metaPath = this.metadataPath(runId, taskId);
    if (await pathExists(metaPath)) {
      await this.audit("refuse", runId, taskId, "refused", "worktree already exists");
      throw new WorktreeError("worktree_exists", `worktree already exists for ${runId}/${taskId}`);
    }

    const worktreePath = this.containedWorktreePath(runId, taskId);

    // Collision: target path exists on disk without owning metadata.
    if (await pathExists(worktreePath)) {
      await this.audit("refuse", runId, taskId, "refused", "path collision");
      throw new WorktreeError("collision", `worktree path already exists: ${worktreePath}`);
    }

    // Symlink-escape check on the existing ancestor chain (T-FS-03/07 baseline).
    await this.assertNoSymlinkEscape(worktreePath);

    // Disk budget: refuse when managed state already exceeds the limit.
    const used = await dirSize(this.worktreesRoot);
    if (used > this.diskLimitBytes) {
      await this.audit("refuse", runId, taskId, "refused", "disk limit exceeded");
      throw new WorktreeError("disk_limit", `managed state ${used}B exceeds limit ${this.diskLimitBytes}B`);
    }

    // Validate the base repo.
    const gitDir = await this.runGit(["rev-parse", "--git-dir"], this.baseRepoPath);
    if (gitDir.spawnFailed || gitDir.code !== 0) {
      await this.audit("refuse", runId, taskId, "refused", "invalid base repo");
      throw new WorktreeError("invalid_repo", `not a git repository: ${this.baseRepoPath}`, gitDir.stderr.trim());
    }

    if (req.requireCleanBase) {
      const status = await this.runGit(["status", "--porcelain"], this.baseRepoPath);
      if (status.code === 0 && status.stdout.trim().length > 0) {
        await this.audit("refuse", runId, taskId, "refused", "dirty base");
        throw new WorktreeError("dirty_base", "base working tree has uncommitted changes");
      }
    }

    // Resolve the base commit (default HEAD).
    let baseCommit = req.baseCommit;
    if (baseCommit === undefined) {
      const head = await this.runGit(["rev-parse", "HEAD"], this.baseRepoPath);
      if (head.code !== 0) {
        throw new WorktreeError("git_failed", "could not resolve base HEAD", head.stderr.trim());
      }
      baseCommit = head.stdout.trim();
    }

    // Branch conflict: refuse if the branch ref already exists.
    const existing = await this.runGit(
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      this.baseRepoPath
    );
    if (existing.code === 0) {
      await this.audit("refuse", runId, taskId, "refused", "branch conflict");
      throw new WorktreeError("branch_conflict", `branch already exists: ${branch}`);
    }

    // Create the worktree on a NEW branch from the base commit.
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    const add = await this.runGit(
      ["worktree", "add", "-b", branch, worktreePath, baseCommit],
      this.baseRepoPath
    );
    if (add.spawnFailed || add.code !== 0) {
      // Best-effort cleanup of any partial worktree, then surface a typed error.
      await this.bestEffortGit(["worktree", "remove", "--force", worktreePath]);
      await this.bestEffortRemoveDir(worktreePath);
      const conflict = /already (checked out|used by worktree|exists)/i.test(add.stderr);
      await this.audit("create", runId, taskId, "failed", `git worktree add failed: ${add.stderr.trim()}`);
      throw new WorktreeError(
        conflict ? "branch_conflict" : "git_failed",
        `git worktree add failed for ${branch}`,
        add.stderr.trim()
      );
    }

    const metadata: WorktreeMetadata = {
      metadataVersion: WORKTREE_METADATA_VERSION,
      runId,
      taskId,
      branch,
      worktreePath,
      baseRepoPath: this.baseRepoPath,
      baseCommit,
      createdAt: this.clock.iso(),
      ownerPid: this.ownerPid,
      status: "active"
    };
    await this.writeMetadata(metadata);
    await this.audit("create", runId, taskId, "ok", `branch ${branch} @ ${baseCommit.slice(0, 12)}`);
    return { metadata, path: worktreePath };
  }

  /** Read the metadata for (runId, taskId), or null if none. */
  async inspect(runId: string, taskId: string): Promise<WorktreeMetadata | null> {
    this.assertId(runId, "runId");
    this.assertId(taskId, "taskId");
    return this.readMetadata(runId, taskId);
  }

  /** List all managed worktree metadata. */
  async list(): Promise<WorktreeMetadata[]> {
    const out: WorktreeMetadata[] = [];
    let runDirs: string[];
    try {
      runDirs = await fs.readdir(this.metaRoot);
    } catch {
      return out;
    }
    for (const runId of runDirs) {
      let files: string[];
      try {
        files = await fs.readdir(path.join(this.metaRoot, runId));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const meta = await readJsonFile<WorktreeMetadata>(path.join(this.metaRoot, runId, file));
        if (meta) {
          out.push(meta);
        }
      }
    }
    return out;
  }

  /**
   * Remove a worktree and its branch, then delete its metadata. Idempotent: a
   * missing worktree/metadata is not an error. Uses `git worktree remove` (not a
   * raw delete) so git's administrative state stays consistent, then prunes.
   */
  async cleanup(runId: string, taskId: string): Promise<void> {
    this.assertId(runId, "runId");
    this.assertId(taskId, "taskId");
    const meta = await this.readMetadata(runId, taskId);
    if (meta === null) {
      return;
    }
    await this.removeWorktreeAndBranch(meta);
    await this.deleteMetadata(runId, taskId);
    await this.audit("cleanup", runId, taskId, "ok", `removed ${meta.branch}`);
  }

  /** Cancel a run/task: mark cancelled then clean up. Idempotent. */
  async cancel(runId: string, taskId: string): Promise<void> {
    this.assertId(runId, "runId");
    this.assertId(taskId, "taskId");
    const meta = await this.readMetadata(runId, taskId);
    if (meta === null) {
      return;
    }
    await this.removeWorktreeAndBranch(meta);
    await this.deleteMetadata(runId, taskId);
    await this.audit("cancel", runId, taskId, "ok", `cancelled ${meta.branch}`);
  }

  /**
   * Detect stale worktrees: those whose owning process is no longer alive (a crash
   * left the worktree behind) or already marked stale. Does not mutate anything.
   */
  async detectStale(): Promise<WorktreeMetadata[]> {
    const all = await this.list();
    return all.filter((m) => m.status === "stale" || !this.isOwnerAlive(m.ownerPid));
  }

  /**
   * Crash recovery: clean up every stale worktree (dead owner) and prune git's
   * administrative state for worktrees removed out-of-band. Returns the recovered
   * records. Idempotent and safe to run at startup.
   */
  async recoverStale(): Promise<WorktreeMetadata[]> {
    const stale = await this.detectStale();
    for (const meta of stale) {
      await this.removeWorktreeAndBranch(meta);
      await this.deleteMetadata(meta.runId, meta.taskId);
      await this.audit("recover", meta.runId, meta.taskId, "ok", `recovered stale ${meta.branch}`);
    }
    // Prune any worktree admin entries whose directory is gone (out-of-band delete).
    await this.bestEffortGit(["worktree", "prune"]);
    return stale;
  }

  // --- internals ---------------------------------------------------------

  private isProtectedBranch(name: string): boolean {
    return this.protectedBranches.has(name.toLowerCase());
  }

  private assertId(value: string, field: string): void {
    if (typeof value !== "string" || !SAFE_ID.test(value)) {
      throw new WorktreeError(
        "invalid_id",
        `invalid ${field}: must match ${SAFE_ID} (no separators, no '..')`,
        value
      );
    }
  }

  /** Build the worktree path and assert it stays inside the worktrees root. */
  private containedWorktreePath(runId: string, taskId: string): string {
    const candidate = path.resolve(this.worktreesRoot, runId, taskId);
    const root = path.resolve(this.worktreesRoot);
    const rel = path.relative(root, candidate);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new WorktreeError("unsafe_path", `worktree path escapes the state root: ${candidate}`);
    }
    return candidate;
  }

  private metadataPath(runId: string, taskId: string): string {
    return path.join(this.metaRoot, runId, `${taskId}.json`);
  }

  /**
   * Refuse if any EXISTING ancestor of the target path is a symlink whose real path
   * leaves the worktrees root (a symlink-escape that would place the worktree
   * outside managed state — T-FS-01/02/07 baseline for the manager's own paths).
   */
  private async assertNoSymlinkEscape(targetPath: string): Promise<void> {
    const root = path.resolve(this.worktreesRoot);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      // Root not yet materialized to a real path — nothing to escape through.
      return;
    }
    // Walk existing ancestors from the target up to the root; the first existing
    // one is realpath-resolved and must remain within the real root.
    let cursor = path.resolve(targetPath);
    while (cursor.startsWith(root) && cursor !== root) {
      if (await pathExists(cursor)) {
        const real = await fs.realpath(cursor);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          throw new WorktreeError(
            "symlink_escape",
            `path component escapes the state root via symlink: ${cursor} -> ${real}`
          );
        }
        return;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return;
      }
      cursor = parent;
    }
  }

  private async removeWorktreeAndBranch(meta: WorktreeMetadata): Promise<void> {
    // Remove the linked worktree (git keeps the shared object store consistent).
    await this.bestEffortGit(["worktree", "remove", "--force", meta.worktreePath]);
    // Remove leftover directory if git left anything (e.g. worktree already gone).
    await this.bestEffortRemoveDir(meta.worktreePath);
    // Force-delete the branch (it may carry the run's commits).
    await this.bestEffortGit(["branch", "-D", meta.branch]);
    // Prune stale admin entries.
    await this.bestEffortGit(["worktree", "prune"]);
  }

  private async writeMetadata(meta: WorktreeMetadata): Promise<void> {
    const file = this.metadataPath(meta.runId, meta.taskId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write-then-rename for crash-atomic metadata.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await fs.rename(tmp, file);
  }

  private async readMetadata(runId: string, taskId: string): Promise<WorktreeMetadata | null> {
    return readJsonFile<WorktreeMetadata>(this.metadataPath(runId, taskId));
  }

  private async deleteMetadata(runId: string, taskId: string): Promise<void> {
    try {
      await fs.rm(this.metadataPath(runId, taskId));
    } catch {
      /* already gone */
    }
  }

  private async runGit(args: string[], cwd: string): Promise<GitResult> {
    return this.git.run(args, { cwd, timeoutMs: this.gitTimeoutMs });
  }

  private async bestEffortGit(args: string[]): Promise<void> {
    try {
      await this.runGit(args, this.baseRepoPath);
    } catch {
      /* best-effort */
    }
  }

  private async bestEffortRemoveDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  private async audit(
    action: WorktreeAuditEntry["action"],
    runId: string,
    taskId: string,
    outcome: WorktreeAuditEntry["outcome"],
    detail: string
  ): Promise<void> {
    const entry: WorktreeAuditEntry = {
      timestamp: this.clock.iso(),
      action,
      runId,
      taskId,
      outcome,
      detail
    };
    try {
      this.onAudit?.(entry);
    } catch {
      /* an audit sink must never break the operation */
    }
    try {
      await fs.mkdir(this.stateRoot, { recursive: true });
      await fs.appendFile(this.auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* audit is best-effort durable; never throw from the audit path */
    }
  }
}

// --- module-private helpers ------------------------------------------------

/** Real owner-liveness probe: signal 0 succeeds iff the process exists. */
function defaultIsOwnerAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM => the process exists but we cannot signal it (still alive).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Recursive byte size of a directory tree; missing dir => 0. */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        const st = await fs.stat(full);
        total += st.size;
      } catch {
        /* skip unreadable */
      }
    }
  }
  return total;
}
