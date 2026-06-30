/**
 * A10-W.8b — REAL-host restart recovery (mandate §12). Gated on a real Windows host with
 * a reachable Postgres (TRIFORGE_PG_RESTART_TEST=1 + DATABASE_URL). Proves that an
 * integrated run persisted to Postgres is reconstructable after the process that ran it
 * is gone: a FRESH store + service (empty process memory) over the SAME database
 * reconstructs the run + its sequence-numbered timeline, emits no duplicate terminal, and
 * never re-merges. Also proves an interrupted (running) run reconciles to a single
 * terminal. This is the real-environment proof behind `recovery_after_restart`'s fixture.
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { FakeProcessRunner, type ProcessRunSpec } from "../providers/real/processRunner.js";
import { runMigrations } from "../db/migrate.js";
import {
  IntegratedRunService,
  PgIntegratedRunStore,
  type IntegratedRunDeps,
  type IntegratedRunSpec
} from "../execution/integrated/index.js";

const ENABLED = process.platform === "win32" && process.env.TRIFORGE_PG_RESTART_TEST === "1";
const d = ENABLED ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tempDirs: string[] = [];
const runIds: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
function git(cwd: string, args: string[]): void {
  spawnSync("git", args, { cwd, encoding: "utf8" });
}
function makeFixtureRepo(): string {
  const repo = makeTempDir("triforge-rr-base-");
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@triforge.local"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "# fixture\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}
function gateRunner(): FakeProcessRunner {
  return new FakeProcessRunner((_s: ProcessRunSpec) => ({
    lines: [{ stream: "stdout" as const, line: "ok" }],
    exit: { code: 0, signal: null, reason: "exited" as const }
  }));
}
function deps(): IntegratedRunDeps {
  return {
    store: new PgIntegratedRunStore(pool),
    gitRunner: new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-rr-harden-") }),
    processRunner: gateRunner(),
    clock: new ManualClock(),
    stateRoot: makeTempDir("triforge-rr-state-"),
    now: () => new Date().toISOString(),
    newId: () => uuid(),
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] }
  };
}
function spec(base: string, mode: "mock" = "mock"): IntegratedRunSpec {
  return {
    objective: "restart-recovery fixture run",
    owner: "codex",
    reviewer: "claude",
    providerMode: mode,
    collaborationMode: "specialist",
    fixtureRepoPath: base,
    writePaths: ["src"],
    readPaths: ["."],
    blockedPaths: [],
    maxFilesChanged: 10,
    gates: [{ name: "unit", command: { bin: "vitest", args: ["run"] } }],
    ownerModel: null,
    reviewerModel: null,
    budget: { maxRepairRounds: 1, perRunTimeoutMs: 60_000 }
  };
}

const TERMINALS = ["run.completed", "run.failed", "run.cancelled", "run.blocked"];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
afterAll(async () => {
  if (ENABLED && runIds.length > 0) {
    await pool.query(`DELETE FROM integrated_runs WHERE id = ANY($1::uuid[])`, [runIds]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
});

// The id generator must produce uuids for the Pg uuid columns; override per use.
function uuid(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}

d("A10-W.8b restart recovery on a real Windows host + real Postgres", () => {
  it("reconstructs a COMPLETED run from Postgres after a simulated restart (no double-merge)", async () => {
    await runMigrations();
    const base = makeFixtureRepo();

    // First "process": run to completion, persisting to Postgres.
    const d1 = deps();
    const id = uuid();
    d1.newId = () => id;
    runIds.push(id);
    const svc1 = new IntegratedRunService(d1);
    await svc1.create(spec(base));
    const final1 = await svc1.start(id);
    expect(final1.status).toBe("completed");
    expect(final1.report?.merged).toBe(true);

    // "Restart": a brand-new store + service over the SAME database, empty process memory.
    const store2 = new PgIntegratedRunStore(pool);
    const svc2 = new IntegratedRunService({ ...deps(), store: store2 });

    const reread = await svc2.get(id);
    expect(reread?.status).toBe("completed");
    expect(reread?.report?.merged).toBe(true);

    const events = await svc2.timeline(id);
    expect(events.map((e) => e.sequenceNumber)).toEqual(events.map((_, i) => i + 1)); // gapless
    expect(events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1); // single terminal

    // recover() on an already-terminal run is a no-op: no duplicate terminal, no re-merge.
    const recovered = await svc2.recover(id);
    expect(recovered.record.status).toBe("completed");
    expect(recovered.events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1);
  }, 60_000);

  it("reconciles an INTERRUPTED (running) run to a single terminal — no merge, no duplicate", async () => {
    await runMigrations();
    const base = makeFixtureRepo();
    const id = uuid();
    runIds.push(id);

    const d1 = deps();
    d1.newId = () => id;
    const svc1 = new IntegratedRunService(d1);
    await svc1.create(spec(base));
    // Simulate a crash mid-run: mark running, no terminal event persisted.
    await d1.store.patch(id, { status: "running", startedAt: new Date().toISOString() });

    // Restart: fresh service reconstructs + reconciles.
    const svc2 = new IntegratedRunService({ ...deps(), store: new PgIntegratedRunStore(pool) });
    const { record, events } = await svc2.recover(id);
    expect(record.status).toBe("failed");
    expect(record.terminalReason).toMatch(/interrupted by restart/);
    expect(events.filter((e) => e.type === "run.failed")).toHaveLength(1);
    expect(events.filter((e) => TERMINALS.includes(e.type))).toHaveLength(1);
  }, 60_000);
});
