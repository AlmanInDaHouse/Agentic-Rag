import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapabilityBinding } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { FakeProcessRunner, type ProcessRunSpec } from "../providers/real/processRunner.js";
import {
  runWritableTask,
  type OwnerImplement,
  type ReviewerReview,
  type WritableTaskConfig
} from "../execution/e2e/index.js";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
function git(cwd: string, args: string[]): void {
  spawnSync("git", args, { cwd, encoding: "utf8" });
}
function makeFixtureRepo(): string {
  const repo = makeTempDir("triforge-e2e-base-");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@triforge.local"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "# fixture\n");
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

const BINDING: CapabilityBinding = {
  threat: ["T-FS-08", "T-INT-04"],
  control: ["A5.1 worktree", "A5.2 paths", "A5.5 ledger", "A5.8 governance"],
  milestone: "A5.9",
  verification: ["writableRun.e2e.test.ts"],
  recovery: "revert + ledger + cleanup",
  residualRisk: "RR-4 no OS sandbox"
};

/** A fake gate runner backed by FakeProcessRunner; gates pass unless `fail` is set. */
function gateRunnerFor(fail: boolean): FakeProcessRunner {
  return new FakeProcessRunner((_spec: ProcessRunSpec) => ({
    lines: [{ stream: "stdout" as const, line: fail ? "fail" : "ok" }],
    exit: { code: fail ? 1 : 0, signal: null, reason: "exited" as const }
  }));
}

function baseConfig(
  baseRepoPath: string,
  ownerImplement: OwnerImplement,
  reviewerReview: ReviewerReview,
  gatesFail = false
): WritableTaskConfig {
  return {
    baseRepoPath,
    stateRoot: makeTempDir("triforge-e2e-state-"),
    runId: "run1",
    taskId: "taskA",
    owner: "codex",
    reviewer: "claude",
    task: "add feature",
    pathPolicy: { readPaths: ["."], writePaths: ["src"], blockedPaths: [], maxFilesChanged: 10 },
    gates: [{ name: "unit", command: { bin: "vitest", args: ["run"] } }],
    processRunner: gateRunnerFor(gatesFail),
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] },
    ownerImplement,
    reviewerReview,
    capabilityBinding: BINDING,
    clock: new ManualClock(),
    gitRunner: new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-e2e-harden-") }),
    maxRepairRounds: 3
  };
}

const noFindings: ReviewerReview = async () => ({ reviewer: "claude", summary: "lgtm", findings: [] });

describe("A5.9 writable E2E (MVP) — real git, mock owner/reviewer", () => {
  it("completes a low-risk writable task end to end: worktree → owner writes → gates → governance MERGE → cleanup", async () => {
    const base = makeFixtureRepo();
    const owner: OwnerImplement = async (ctx, round) => {
      if (round > 0) return; // converges on the first round
      const w1 = await ctx.write("src/feature.ts", "export const f = () => 42;\n", "implement feature");
      const w2 = await ctx.write("src/feature.test.ts", "import {f} from './feature';\n", "add test");
      expect(w1.ok).toBe(true);
      expect(w2.ok).toBe(true);
    };
    const report = await runWritableTask(baseConfig(base, owner, noFindings));

    expect(report.repairState).toBe("accepted");
    expect(report.governance.verdict).toBe("merge");
    expect(report.merged).toBe(true);
    expect(report.ledgerEntryCount).toBe(2);
    expect(report.reconciledTampered).toBe(false);

    // The change landed on the base branch (governed merge), and the worktree is gone.
    expect(existsSync(path.join(base, "src", "feature.ts"))).toBe(true);
    expect(report.cleanedUp).toBe(true);
    expect(existsSync(report.worktreePath)).toBe(false);
    // main was never touched directly — the merge created a merge commit.
    expect(git0(base, ["log", "--oneline"]).includes("triforge: add feature")).toBe(true);
  }, 30_000);

  it("REFUSES an owner write outside writePaths / into .git (path policy), still merges the valid change", async () => {
    const base = makeFixtureRepo();
    const owner: OwnerImplement = async (ctx, round) => {
      if (round > 0) return;
      const escape = await ctx.write("../escape.ts", "x", "evil");
      const dotgit = await ctx.write(".git/hooks/post-commit", "x", "evil");
      const readme = await ctx.write("README.md", "x", "out of writePaths");
      expect(escape.ok).toBe(false);
      expect(dotgit.ok).toBe(false);
      expect(readme.ok).toBe(false);
      const ok = await ctx.write("src/ok.ts", "export const ok = 1;\n", "valid");
      expect(ok.ok).toBe(true);
    };
    const report = await runWritableTask(baseConfig(base, owner, noFindings));
    expect(report.governance.verdict).toBe("merge");
    expect(report.ledgerEntryCount).toBe(1); // only the valid write was recorded
    expect(existsSync(path.join(base, "src", "ok.ts"))).toBe(true);
    // No escape happened.
    expect(existsSync(path.join(path.dirname(base), "escape.ts"))).toBe(false);
  }, 30_000);

  it("BLOCKS the merge when an UNATTRIBUTED change appears (tampering, SAT-A5-6)", async () => {
    const base = makeFixtureRepo();
    const owner: OwnerImplement = async (ctx, round) => {
      if (round > 0) return;
      await ctx.write("src/feature.ts", "export const f = 1;\n", "implement"); // recorded
      // An out-of-band write that bypasses the ledger (forged/unrecorded change):
      mkdirSync(path.join(ctx.worktreePath, "src"), { recursive: true });
      writeFileSync(path.join(ctx.worktreePath, "src", "sneaky.ts"), "stolen\n");
    };
    const report = await runWritableTask(baseConfig(base, owner, noFindings));
    expect(report.reconciledTampered).toBe(true);
    expect(report.governance.verdict).toBe("block");
    expect(report.merged).toBe(false);
    // main is unchanged: no feature file landed.
    expect(existsSync(path.join(base, "src", "feature.ts"))).toBe(false);
  }, 30_000);

  it("BLOCKS the merge when quality gates fail", async () => {
    const base = makeFixtureRepo();
    const owner: OwnerImplement = async (ctx, round) => {
      if (round > 0) return;
      await ctx.write("src/feature.ts", "export const f = 1;\n", "implement");
    };
    const report = await runWritableTask(baseConfig(base, owner, noFindings, true)); // gates fail
    expect(report.governance.verdict).not.toBe("merge");
    expect(report.merged).toBe(false);
    expect(existsSync(path.join(base, "src", "feature.ts"))).toBe(false);
  }, 30_000);
});

/** Helper: capture `git` stdout. */
function git0(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.stdout ?? "";
}
