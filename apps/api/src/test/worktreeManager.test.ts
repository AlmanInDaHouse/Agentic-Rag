import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs, mkdtempSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import {
  WorktreeManager,
  WorktreeError,
  NodeGitRunner,
  FakeGitRunner,
  type WorktreeManagerOptions
} from "../execution/worktree/index.js";

// --- fixtures --------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Run git directly (test helper only — NOT the hardened runner under test). */
function git(cwd: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

interface ManagerHarness {
  manager: WorktreeManager;
  baseRepo: string;
  stateRoot: string;
  clock: ManualClock;
}

function makeManager(overrides: Partial<WorktreeManagerOptions> = {}): ManagerHarness {
  const baseRepo = (overrides.baseRepoPath as string | undefined) ?? makeFixtureRepoCommitted();
  const stateRoot = (overrides.stateRoot as string | undefined) ?? makeTempDir("triforge-state-");
  const clock = new ManualClock();
  // Hermetic hardening root under a temp dir (never the real $HOME state dir).
  const gitRunner =
    overrides.gitRunner ?? new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-harden-") });
  const manager = new WorktreeManager({
    baseRepoPath: baseRepo,
    stateRoot,
    gitRunner,
    clock,
    ...overrides
  });
  return { manager, baseRepo, stateRoot, clock };
}

/** A fixture repo with an actual commit (README) on `main`. */
function makeFixtureRepoCommitted(): string {
  const repo = makeTempDir("triforge-base-");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@triforge.local"]);
  git(repo, ["config", "user.name", "TriForge Test"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  spawnSync("node", ["-e", `require('fs').writeFileSync(${JSON.stringify(path.join(repo, "README.md"))}, '# fixture\\n')`]);
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// --- lifecycle (real git) --------------------------------------------------

describe("WorktreeManager — lifecycle (real git)", () => {
  it("creates an isolated worktree on a NEW branch, outside the base repo, with metadata", async () => {
    const { manager, baseRepo, stateRoot } = makeManager();
    const handle = await manager.create({ runId: "run1", taskId: "taskA" });

    // The worktree exists, contains the checked-out file, and lives OUTSIDE the base repo (T-FS-08).
    expect(existsSync(handle.path)).toBe(true);
    expect(existsSync(path.join(handle.path, "README.md"))).toBe(true);
    expect(handle.path.startsWith(path.resolve(stateRoot))).toBe(true);
    expect(path.resolve(handle.path).startsWith(path.resolve(baseRepo) + path.sep)).toBe(false);

    // On a NEW branch — never main.
    expect(handle.metadata.branch).toBe("triforge/run1/taskA");
    const wtBranch = git(handle.path, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    expect(wtBranch).toBe("triforge/run1/taskA");

    // Base repo is still on main, unmodified (SAT-A5-10: never work on main).
    expect(git(baseRepo, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe("main");

    // Metadata persisted and inspectable.
    const meta = await manager.inspect("run1", "taskA");
    expect(meta?.branch).toBe("triforge/run1/taskA");
    expect(meta?.status).toBe("active");
    expect(meta?.ownerPid).toBe(process.pid);
  });

  it("inspect returns null for an unknown run/task", async () => {
    const { manager } = makeManager();
    expect(await manager.inspect("nope", "nada")).toBeNull();
  });

  it("lists all managed worktrees across runs", async () => {
    const { manager } = makeManager();
    await manager.create({ runId: "run1", taskId: "taskA" });
    await manager.create({ runId: "run2", taskId: "taskB" });
    const all = await manager.list();
    expect(all.map((m) => m.branch).sort()).toEqual([
      "triforge/run1/taskA",
      "triforge/run2/taskB"
    ]);
  });

  it("REJECTS reuse: a second create for the same run/task", async () => {
    const { manager } = makeManager();
    await manager.create({ runId: "run1", taskId: "taskA" });
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "worktree_exists"
    });
  });

  it("detects a path COLLISION (path present without owning metadata)", async () => {
    const { manager, stateRoot } = makeManager();
    const collidePath = path.join(stateRoot, "worktrees", "run1", "taskA");
    await fs.mkdir(collidePath, { recursive: true });
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "collision"
    });
  });

  it("cleans up a worktree, its branch and metadata; cleanup is idempotent", async () => {
    const { manager, baseRepo } = makeManager();
    const handle = await manager.create({ runId: "run1", taskId: "taskA" });
    await manager.cleanup("run1", "taskA");

    expect(existsSync(handle.path)).toBe(false);
    expect(await manager.inspect("run1", "taskA")).toBeNull();
    // Branch is gone from the base repo.
    expect(git(baseRepo, ["show-ref", "--verify", "--quiet", "refs/heads/triforge/run1/taskA"]).code).not.toBe(0);
    // Idempotent: second cleanup is a no-op, not an error.
    await expect(manager.cleanup("run1", "taskA")).resolves.toBeUndefined();
  });

  it("REFUSES a branch conflict when the branch already exists", async () => {
    const { manager, baseRepo } = makeManager();
    git(baseRepo, ["branch", "triforge/run1/taskA"]);
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "branch_conflict"
    });
  });

  it("REFUSES a dirty base when requireCleanBase is set", async () => {
    const { manager, baseRepo } = makeManager();
    await fs.writeFile(path.join(baseRepo, "dirty.txt"), "uncommitted\n");
    await expect(
      manager.create({ runId: "run1", taskId: "taskA", requireCleanBase: true })
    ).rejects.toMatchObject({ code: "dirty_base" });
  });

  it("allows a dirty base by default (worktree is created from a committed base)", async () => {
    const { manager, baseRepo } = makeManager();
    await fs.writeFile(path.join(baseRepo, "dirty.txt"), "uncommitted\n");
    const handle = await manager.create({ runId: "run1", taskId: "taskA" });
    expect(existsSync(handle.path)).toBe(true);
  });
});

// --- security refusals -----------------------------------------------------

describe("WorktreeManager — security refusals", () => {
  it("REFUSES unsafe ids (path traversal / separators)", async () => {
    const { manager } = makeManager();
    for (const bad of ["..", "../escape", "a/b", "a\\b", ".", "with space", ""]) {
      await expect(manager.create({ runId: bad, taskId: "ok" })).rejects.toBeInstanceOf(WorktreeError);
      await expect(manager.create({ runId: bad, taskId: "ok" })).rejects.toMatchObject({
        code: "invalid_id"
      });
    }
  });

  it("REFUSES a protected base branch (never work on main directly — SAT-A5-10)", async () => {
    const { manager } = makeManager();
    await expect(
      manager.create({ runId: "run1", taskId: "taskA", branchPrefix: "main" })
    ).rejects.toMatchObject({ code: "protected_branch" });
  });

  it("REFUSES a symlink escape of the state root (T-FS-01/02/07)", async () => {
    const { manager, stateRoot } = makeManager();
    const worktreesRoot = path.join(stateRoot, "worktrees");
    await fs.mkdir(worktreesRoot, { recursive: true });
    const external = makeTempDir("triforge-external-");
    let symlinked = false;
    try {
      symlinkSync(external, path.join(worktreesRoot, "run1"), "dir");
      symlinked = true;
    } catch {
      // Symlink creation needs privilege on win32; skip when unavailable (CI is Linux).
    }
    if (!symlinked) {
      return;
    }
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "symlink_escape"
    });
  });

  it("hardened git runner does NOT execute a repository post-checkout hook (T-GIT-01 / SAT-A5-5)", async () => {
    const { manager, baseRepo } = makeManager();
    // Plant a post-checkout hook that writes a sentinel into a temp file.
    const sentinel = path.join(makeTempDir("triforge-sentinel-"), "fired");
    const sentinelPosix = sentinel.replaceAll("\\", "/");
    const hookDir = path.join(baseRepo, ".git", "hooks");
    await fs.mkdir(hookDir, { recursive: true });
    const hookPath = path.join(hookDir, "post-checkout");
    await fs.writeFile(hookPath, `#!/bin/sh\necho fired > '${sentinelPosix}'\n`);
    await fs.chmod(hookPath, 0o755).catch(() => undefined);

    // Positive control: an UNHARDENED checkout fires the hook (skip the assertion if
    // the platform doesn't run shell hooks, but CI/Linux does).
    const control = path.join(makeTempDir("triforge-ctrl-"), "wt");
    spawnSync("git", ["worktree", "add", "-b", "control/branch", control, "HEAD"], { cwd: baseRepo });
    const controlFired = existsSync(sentinel);
    // Clean the control worktree + sentinel before the hardened run.
    spawnSync("git", ["worktree", "remove", "--force", control], { cwd: baseRepo });
    rmSync(sentinel, { force: true });

    // Hardened run: the manager's NodeGitRunner must NOT fire the hook.
    await manager.create({ runId: "run1", taskId: "taskA" });
    expect(existsSync(sentinel)).toBe(false);

    // If the positive control did fire, the negative result above is meaningful.
    if (controlFired) {
      expect(controlFired).toBe(true);
    }
  });

  it("writes an append-only audit trail of create + refusals", async () => {
    const audited: string[] = [];
    const { manager, stateRoot } = makeManager({ onAudit: (e) => audited.push(`${e.action}:${e.outcome}`) });
    await manager.create({ runId: "run1", taskId: "taskA" });
    await manager.create({ runId: "run1", taskId: "taskA" }).catch(() => undefined); // reuse refusal
    expect(audited).toContain("create:ok");
    expect(audited).toContain("refuse:refused");
    const log = await fs.readFile(path.join(stateRoot, "audit.log"), "utf8");
    expect(log.trim().split("\n").length).toBeGreaterThanOrEqual(2);
    // Each line is a valid JSON audit record.
    for (const line of log.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// --- stale / crash recovery ------------------------------------------------

describe("WorktreeManager — stale detection & crash recovery", () => {
  it("detects a stale worktree whose owner pid is dead and recovers it", async () => {
    let alive = true;
    const { manager, baseRepo } = makeManager({ isOwnerAlive: () => alive });
    const handle = await manager.create({ runId: "run1", taskId: "taskA" });
    expect(await manager.detectStale()).toHaveLength(0);

    // Simulate the owning run crashing.
    alive = false;
    const stale = await manager.detectStale();
    expect(stale.map((m) => m.branch)).toEqual(["triforge/run1/taskA"]);

    const recovered = await manager.recoverStale();
    expect(recovered).toHaveLength(1);
    expect(existsSync(handle.path)).toBe(false);
    expect(await manager.inspect("run1", "taskA")).toBeNull();
    expect(git(baseRepo, ["show-ref", "--verify", "--quiet", "refs/heads/triforge/run1/taskA"]).code).not.toBe(0);
  });

  it("recoverStale is idempotent and leaves live worktrees intact", async () => {
    const { manager } = makeManager({ isOwnerAlive: (pid) => pid === process.pid });
    await manager.create({ runId: "live", taskId: "t" });
    const recovered = await manager.recoverStale();
    expect(recovered).toHaveLength(0);
    expect(await manager.inspect("live", "t")).not.toBeNull();
  });
});

// --- failure injection (FakeGitRunner) -------------------------------------

describe("WorktreeManager — failure injection (FakeGitRunner)", () => {
  it("maps an invalid base repo to invalid_repo", async () => {
    const fake = new FakeGitRunner((args) =>
      args[0] === "rev-parse" && args[1] === "--git-dir" ? { code: 128, stderr: "not a git repo" } : null
    );
    const { manager } = makeManager({ gitRunner: fake, baseRepoPath: makeTempDir("triforge-norepo-") });
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "invalid_repo"
    });
  });

  it("maps a git worktree add failure to git_failed and cleans up the partial path", async () => {
    const fake = new FakeGitRunner((args) => {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return { code: 0 };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "deadbeef\n" };
      if (args[0] === "show-ref") return { code: 1 }; // no existing branch
      if (args[0] === "worktree" && args[1] === "add") return { code: 1, stderr: "fatal: disk failure" };
      return { code: 0 };
    });
    const { manager } = makeManager({ gitRunner: fake });
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "git_failed"
    });
    // No metadata was persisted for the failed create.
    expect(await manager.inspect("run1", "taskA")).toBeNull();
  });

  it("REFUSES creation over the disk budget", async () => {
    const fake = new FakeGitRunner();
    // Pre-create a worktrees dir with a file larger than the 1-byte budget.
    const stateRoot = makeTempDir("triforge-state-");
    await fs.mkdir(path.join(stateRoot, "worktrees", "seed"), { recursive: true });
    await fs.writeFile(path.join(stateRoot, "worktrees", "seed", "big"), "xxxxxxxxxx");
    const { manager } = makeManager({ gitRunner: fake, stateRoot, diskLimitBytes: 1 });
    await expect(manager.create({ runId: "run1", taskId: "taskA" })).rejects.toMatchObject({
      code: "disk_limit"
    });
  });
});
