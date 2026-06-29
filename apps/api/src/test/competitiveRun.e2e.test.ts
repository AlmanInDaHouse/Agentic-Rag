import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapabilityBinding } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { FakeProcessRunner } from "../providers/real/processRunner.js";
import { runCompetitive, type CompetitiveConfig } from "../execution/competitive/index.js";
import type { OwnerImplement, ReviewerReview } from "../execution/e2e/index.js";

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
  const repo = makeTempDir("triforge-comp-base-");
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
  threat: ["T-FS-08"],
  control: ["A5 stack"],
  milestone: "A7.1",
  verification: ["competitiveRun.e2e.test.ts"],
  recovery: "cleanup both candidates",
  residualRisk: "RR-4"
};
const noFindings: ReviewerReview = async () => ({ reviewer: "claude", summary: "lgtm", findings: [] });

function writeN(paths: string[]): OwnerImplement {
  return async (ctx, round) => {
    if (round > 0) return;
    for (const p of paths) {
      await ctx.write(p, `export const x = 1; // ${p}\n`, "impl");
    }
  };
}

/** An owner that ALSO writes an out-of-band file (bypasses the ledger → tampered). */
function tamperingOwner(validPath: string): OwnerImplement {
  return async (ctx, round) => {
    if (round > 0) return;
    await ctx.write(validPath, "export const x = 1;\n", "impl");
    mkdirSync(path.join(ctx.worktreePath, "src"), { recursive: true });
    writeFileSync(path.join(ctx.worktreePath, "src", "sneaky.ts"), "stolen\n");
  };
}

function makeConfig(base: string, over: Partial<CompetitiveConfig> = {}): CompetitiveConfig {
  return {
    baseRepoPath: base,
    stateRoot: makeTempDir("triforge-comp-state-"),
    taskId: "taskA",
    task: "add feature",
    pathPolicy: { readPaths: ["."], writePaths: ["src"], blockedPaths: [], maxFilesChanged: 10 },
    gates: [{ name: "unit", command: { bin: "vitest", args: ["run"] } }],
    processRunner: new FakeProcessRunner(() => ({
      lines: [{ stream: "stdout", line: "ok" }],
      exit: { code: 0, signal: null, reason: "exited" }
    })),
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] },
    capabilityBinding: BINDING,
    clock: new ManualClock(),
    gitRunner: new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-comp-h-") }),
    maxRepairRounds: 2,
    candidates: [
      { provider: "codex", runId: "cand-codex", ownerImplement: writeN(["src/feature.ts"]), reviewerReview: noFindings },
      { provider: "claude", runId: "cand-claude", ownerImplement: writeN(["src/feature.ts", "src/extra.ts"]), reviewerReview: noFindings }
    ],
    budget: { optIn: true, availableUnits: 100, requiredUnitsPerCandidate: 1 },
    ...over
  };
}

describe("A7.1 Competitive Mode (E2E, real git) — isolated candidates, governance selection", () => {
  it("REFUSES to run when not opted in or under-budget", async () => {
    const base = makeFixtureRepo();
    expect((await runCompetitive(makeConfig(base, { budget: { optIn: false, availableUnits: 100, requiredUnitsPerCandidate: 1 } }))).ran).toBe(false);
    expect((await runCompetitive(makeConfig(base, { budget: { optIn: true, availableUnits: 1, requiredUnitsPerCandidate: 1 } }))).ran).toBe(false);
  }, 30_000);

  it("runs two ISOLATED candidates and SELECTS the better by re-derived evidence (smaller diff), merging only the winner", async () => {
    const base = makeFixtureRepo();
    const result = await runCompetitive(makeConfig(base));
    expect(result.ran).toBe(true);
    expect(result.candidates).toHaveLength(2);
    // Both pass governance, codex wins on the smaller-diff tiebreak (1 file vs 2).
    expect(result.winner).toBe("codex");
    expect(result.selectionDecision?.verdict).toBe("merge");
    expect(result.merged).toBe(true);
    // The winner's change is on the base branch; the loser's extra file is NOT.
    expect(existsSync(path.join(base, "src", "feature.ts"))).toBe(true);
    expect(existsSync(path.join(base, "src", "extra.ts"))).toBe(false);
    // Both candidate worktrees are cleaned up.
    for (const c of result.candidates) {
      expect(existsSync(c.report.worktreePath)).toBe(false);
    }
  }, 60_000);

  it("selects NO winner when neither candidate reaches a merge verdict (both tampered)", async () => {
    const base = makeFixtureRepo();
    const config = makeConfig(base, {
      candidates: [
        { provider: "codex", runId: "cand-codex", ownerImplement: tamperingOwner("src/a.ts"), reviewerReview: noFindings },
        { provider: "claude", runId: "cand-claude", ownerImplement: tamperingOwner("src/b.ts"), reviewerReview: noFindings }
      ]
    });
    const result = await runCompetitive(config);
    expect(result.ran).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.merged).toBe(false);
    // Neither candidate's change reached the base branch.
    expect(existsSync(path.join(base, "src", "a.ts"))).toBe(false);
    expect(existsSync(path.join(base, "src", "b.ts"))).toBe(false);
  }, 60_000);
});
