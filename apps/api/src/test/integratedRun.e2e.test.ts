import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { FakeProcessRunner, type ProcessRunSpec } from "../providers/real/processRunner.js";
import {
  IntegratedRunService,
  InMemoryIntegratedRunStore,
  type IntegratedRunDeps,
  type IntegratedRunSpec
} from "../execution/integrated/index.js";

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
  const repo = makeTempDir("triforge-int-base-");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@triforge.local"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "# fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}
function gateRunnerFor(fail: boolean): FakeProcessRunner {
  return new FakeProcessRunner((_spec: ProcessRunSpec) => ({
    lines: [{ stream: "stdout" as const, line: fail ? "fail" : "ok" }],
    exit: { code: fail ? 1 : 0, signal: null, reason: "exited" as const }
  }));
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

let idCounter = 0;
function makeDeps(gatesFail = false): IntegratedRunDeps {
  idCounter = 0;
  return {
    store: new InMemoryIntegratedRunStore(),
    gitRunner: new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-int-harden-") }),
    processRunner: gateRunnerFor(gatesFail),
    clock: new ManualClock(),
    stateRoot: makeTempDir("triforge-int-state-"),
    now: () => "2026-06-30T00:00:00.000Z",
    newId: () => `run-${++idCounter}`,
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] }
  };
}
function makeSpec(base: string, over: Partial<IntegratedRunSpec> = {}): IntegratedRunSpec {
  return {
    objective: "add a generated file",
    owner: "codex",
    reviewer: "claude",
    providerMode: "mock",
    collaborationMode: "specialist",
    fixtureRepoPath: base,
    writePaths: ["src"],
    readPaths: ["."],
    blockedPaths: [],
    maxFilesChanged: 10,
    gates: [{ name: "unit", command: { bin: "vitest", args: ["run"] } }],
    ownerModel: null,
    reviewerModel: null,
    budget: { maxRepairRounds: 2, perRunTimeoutMs: 60_000 },
    ...over
  };
}

const TERMINALS = ["run.completed", "run.failed", "run.cancelled", "run.blocked"];

describe("IntegratedRunService — mock-mode integrated E2E (real git, in-memory store)", () => {
  it("create -> start runs the full pipeline to a governed merge, with honest provenance", async () => {
    const deps = makeDeps();
    const svc = new IntegratedRunService(deps);
    const base = makeFixtureRepo();

    const created = await svc.create(makeSpec(base));
    expect(created.status).toBe("created");

    const final = await svc.start(created.id);
    expect(final.status).toBe("completed");
    expect(final.report?.governance.verdict).toBe("merge");
    expect(final.report?.merged).toBe(true);
    expect(final.ownerProvenance).toEqual({ provider: "codex", mode: "mock", version: "mock-codex", isReal: false });
    expect(final.reviewerProvenance?.isReal).toBe(false);

    // The change landed on the fixture base (governed merge) — never the TriForge tree.
    expect(existsSync(path.join(base, "src", "triforge_generated.txt"))).toBe(true);
  }, 30_000);

  it("persists a gapless, single-terminal, sequence-ordered event stream", async () => {
    const deps = makeDeps();
    const svc = new IntegratedRunService(deps);
    const created = await svc.create(makeSpec(makeFixtureRepo()));
    await svc.start(created.id);

    const events = await svc.timeline(created.id);
    expect(events.length).toBeGreaterThan(0);
    // strictly increasing, gapless from 1
    expect(events.map((e) => e.sequenceNumber)).toEqual(events.map((_, i) => i + 1));
    // exactly one terminal
    expect(events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1);
    const types = events.map((e) => e.type);
    for (const required of ["run.started", "provider.selected", "worktree.created", "governance.decided", "merge.completed", "run.completed"]) {
      expect(types).toContain(required);
    }
    // provider events carry provenance version (never a real version in mock mode)
    const fileChanged = events.find((e) => e.type === "file.changed");
    expect(fileChanged?.providerVersion).toBe("mock-codex");
  }, 30_000);

  it("exposes a real diff + artifacts derived purely from the persisted record", async () => {
    const deps = makeDeps();
    const svc = new IntegratedRunService(deps);
    const created = await svc.create(makeSpec(makeFixtureRepo()));
    await svc.start(created.id);

    const diff = await svc.diff(created.id);
    expect(diff?.changedFiles.some((f) => f.path.includes("triforge_generated"))).toBe(true);
    expect(typeof diff?.patch === "string" || diff?.patch === null).toBe(true);

    const arts = await svc.artifacts(created.id);
    expect(arts?.merged).toBe(true);
    expect(arts?.providerMode).toBe("mock");
    expect(arts?.governanceVerdict).toBe("merge");
  }, 30_000);

  it("cancel is idempotent on a terminal run", async () => {
    const deps = makeDeps();
    const svc = new IntegratedRunService(deps);
    const created = await svc.create(makeSpec(makeFixtureRepo()));
    await svc.start(created.id);
    const afterCancel = await svc.cancel(created.id);
    expect(afterCancel.status).toBe("completed"); // unchanged; no second terminal
    const events = await svc.timeline(created.id);
    expect(events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1);
  }, 30_000);

  it("recover reconciles an interrupted (running) run to a single terminal, no double-merge", async () => {
    const deps = makeDeps();
    const svc = new IntegratedRunService(deps);
    const created = await svc.create(makeSpec(makeFixtureRepo()));
    // Simulate a process that died mid-run: status running, no live in-flight entry.
    await deps.store.patch(created.id, { status: "running", startedAt: deps.now() });

    const { record, events } = await svc.recover(created.id);
    expect(record.status).toBe("failed");
    expect(record.terminalReason).toMatch(/interrupted by restart/);
    expect(events.filter((e) => e.type === "run.failed")).toHaveLength(1);
    expect(events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1);
  }, 30_000);
});
