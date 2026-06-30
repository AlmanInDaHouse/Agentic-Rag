/**
 * A10-W.3 — WorktreeManager on native Windows / NTFS (real Git for Windows).
 *
 * The cross-platform worktreeManager.test.ts already drives NodeGitRunner against
 * real git (and passes on this Windows host). This suite adds the Windows-SPECIFIC
 * coverage that POSIX cannot exercise: the %LOCALAPPDATA%\TriForge state root and a
 * directory-JUNCTION escape (mklink /J — no admin, unlike Windows symlinks). Runs
 * only on win32. Evidence behind windows_worktree_manager = verified_real_environment.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner, WorktreeError, WorktreeManager, defaultStateRoot } from "../execution/worktree/index.js";

const RUN = process.platform === "win32";
const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

describe.runIf(RUN)("A10-W.3 WorktreeManager — native Windows / NTFS", () => {
  const temps: string[] = [];
  const mkTemp = (p: string) => {
    const d = mkdtempSync(path.join(os.tmpdir(), p));
    temps.push(d);
    return d;
  };
  let baseRepo = "";

  beforeAll(() => {
    baseRepo = mkTemp("tf-w3-base-");
    git(baseRepo, ["init", "-b", "main"]);
    git(baseRepo, ["config", "user.email", "t@triforge.local"]);
    git(baseRepo, ["config", "user.name", "TriForge"]);
    writeFileSync(path.join(baseRepo, "README.md"), "# base\n");
    git(baseRepo, ["add", "."]);
    git(baseRepo, ["commit", "-m", "init"]);
  });

  afterAll(() => {
    for (const d of temps) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  const makeManager = (stateRoot: string) =>
    new WorktreeManager({
      baseRepoPath: baseRepo,
      stateRoot,
      gitRunner: new NodeGitRunner({ hardeningRoot: mkTemp("tf-w3-harden-") }),
      clock: new ManualClock()
    });

  it("defaultStateRoot is %LOCALAPPDATA%\\TriForge on Windows", () => {
    const root = defaultStateRoot();
    expect(root.endsWith(path.join("TriForge"))).toBe(true);
    const local = process.env.LOCALAPPDATA;
    if (local) expect(root.toLowerCase().startsWith(local.toLowerCase())).toBe(true);
  });

  it("creates an isolated worktree on a NEW branch (never main) under the NTFS state root", async () => {
    const stateRoot = mkTemp("tf-w3-state-");
    const mgr = makeManager(stateRoot);
    const handle = await mgr.create({ runId: "run1", taskId: "task1" });

    expect(handle.metadata.branch).toBe("triforge/run1/task1");
    expect(handle.metadata.branch).not.toBe("main");
    expect(handle.path.toLowerCase().startsWith(stateRoot.toLowerCase())).toBe(true);
    // It is a real git worktree checked out on the new branch.
    const cur = git(handle.path, ["branch", "--show-current"]).stdout.trim();
    expect(cur).toBe("triforge/run1/task1");
    // The base commit content is present.
    expect(git(handle.path, ["ls-files"]).stdout).toContain("README.md");

    await mgr.cleanup("run1", "task1");
    expect(await mgr.inspect("run1", "task1")).toBeNull();
  });

  it("refuses a protected branch prefix (never operate on main)", async () => {
    const mgr = makeManager(mkTemp("tf-w3-state-"));
    await expect(mgr.create({ runId: "r", taskId: "t", branchPrefix: "main" })).rejects.toBeInstanceOf(WorktreeError);
  });

  it("refuses a worktree whose ancestor is a directory junction escaping the state root", async () => {
    const stateRoot = mkTemp("tf-w3-state-");
    const outside = mkTemp("tf-w3-outside-");
    const worktrees = path.join(stateRoot, "worktrees");
    mkdirSync(worktrees, { recursive: true });
    // Plant a junction at the runId level pointing OUTSIDE the state root.
    let junctionMade = false;
    try {
      execFileSync("cmd", ["/c", "mklink", "/J", path.join(worktrees, "runJ"), outside], { stdio: "ignore" });
      junctionMade = true;
    } catch {
      junctionMade = false;
    }
    if (!junctionMade) return; // mklink unavailable — nothing to assert
    const mgr = makeManager(stateRoot);
    await expect(mgr.create({ runId: "runJ", taskId: "task1" })).rejects.toMatchObject({ code: "symlink_escape" });
  });
});
