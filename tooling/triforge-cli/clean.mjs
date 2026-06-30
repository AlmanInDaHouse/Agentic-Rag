/**
 * `pnpm triforge:clean` — reclaim transient state. By default: stop managed services,
 * prune stale git worktrees, remove runtime pid files and rotate runtime logs. It does
 * NOT delete persistent data (ledgers, evidence, the database) unless `--all` is passed,
 * and it NEVER touches a repository other than this one.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import {
  REPO_ROOT, resolveStateRoot, runtimeDir, logDir, pidsFilePath, readJsonIfExists, parseServicesRecord,
  killManaged, isAlive, removeIfExists, safeRun, cleanPlan, ui
} from "./lib.mjs";

const ALL = process.argv.includes("--all");

async function main() {
  const stateRoot = resolveStateRoot();
  const plan = cleanPlan({ all: ALL });
  ui.head(`TriForge clean${ALL ? " (--all: includes persistent state)" : ""}`);

  // 1. Stop managed services first (so their worktrees can be pruned).
  if (plan.managedProcesses) {
    const raw = readJsonIfExists(pidsFilePath(stateRoot));
    const rec = raw ? parseServicesRecord(JSON.stringify(raw)) : null;
    let stopped = 0;
    if (rec) {
      for (const svc of Object.values(rec.services)) {
        if (isAlive(svc.pid)) { killManaged(svc.pid); stopped += 1; }
      }
    }
    ui.ok(`managed services: ${stopped} stopped`);
  }

  // 2. Prune stale git worktrees (only removes worktrees whose dir is already gone).
  if (plan.staleWorktrees) {
    const prune = safeRun("git", ["worktree", "prune", "-v"], { cwd: REPO_ROOT, timeout: 30000 });
    ui.ok(`git worktrees pruned${prune.stdout.trim() ? `:\n${prune.stdout.trim()}` : ""}`);
  }

  // 3. Runtime state (pid files) — re-created on next start.
  if (plan.runtimeState) {
    removeIfExists(runtimeDir(stateRoot));
    ui.ok("runtime state cleared");
  }

  // 4. Transient logs.
  if (plan.transientLogs && existsSync(logDir(stateRoot))) {
    removeIfExists(logDir(stateRoot));
    ui.ok("runtime logs removed");
  }

  // 5. Persistent state — ONLY with --all.
  if (plan.persistentState) {
    for (const dir of ["ledgers", "worktrees"]) {
      const target = path.join(stateRoot, dir);
      if (existsSync(target)) { removeIfExists(target); ui.warn(`removed persistent ${dir}/`); }
    }
  } else {
    ui.info("persistent state (ledgers/, worktrees/, database) preserved — use --all to remove");
  }

  ui.head("Clean complete");
  process.exit(0);
}

main().catch((err) => {
  ui.fail(`clean crashed: ${err?.message ?? err}`);
  process.exit(1);
});
