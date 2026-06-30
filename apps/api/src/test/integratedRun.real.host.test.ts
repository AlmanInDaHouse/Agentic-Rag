/**
 * A10-W.8b — REAL provider integrated run (mandate §9). Gated on a real Windows host with
 * an authenticated Codex CLI + reachable Postgres (TRIFORGE_REAL_PROVIDER=1 + DATABASE_URL;
 * describe.skip otherwise — never runs in CI). It is the codified reproducer of the
 * VERIFIED browser-driven run (2026-06-30, run cb8de8e0): the integrated product runtime
 * (the exact IntegratedRunService the API/UI call) drives a real Codex owner + Codex
 * cross-vendor reviewer over the writable pipeline on a disposable fixture and reaches a
 * governed merge. Claude is intentionally not used (mandate §20 quota conservation).
 *
 * Per mandate §20 ("do not repeat already-valid pilots") this is NOT re-run on every CI
 * pass; the browser run + its Postgres record + the fixture git history are the live
 * evidence for windows_integrated_product_e2e=verified_real_provider. Run manually with
 * TRIFORGE_REAL_PROVIDER=1 to reproduce.
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { TrustedCommandRunner } from "../execution/command/trustedCommandRunner.js";
import { WINDOWS_BASE_ENV_ALLOWLIST } from "../providers/real/index.js";
import { runMigrations } from "../db/migrate.js";
import {
  IntegratedRunService,
  PgIntegratedRunStore,
  type IntegratedRunSpec
} from "../execution/integrated/index.js";

const ENABLED = process.platform === "win32" && process.env.TRIFORGE_REAL_PROVIDER === "1";
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
function uuid(): string {
  return (globalThis.crypto as Crypto).randomUUID();
}
function makeFixtureRepo(): string {
  const repo = makeTempDir("triforge-real-base-");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "t@triforge.local"]);
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "fx", version: "1.0.0", scripts: { test: "node --test" } }));
  writeFileSync(
    path.join(repo, "src", "slugify.test.js"),
    `const { test } = require("node:test");\nconst assert = require("node:assert");\nconst { slugify } = require("./slugify.js");\ntest("slugify", () => { assert.strictEqual(slugify("Hello World"), "hello-world"); });\n`
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "fixture: failing slugify spec"]);
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
afterAll(async () => {
  if (ENABLED && runIds.length > 0) {
    await pool.query(`DELETE FROM integrated_runs WHERE id = ANY($1::uuid[])`, [runIds]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
});

d("A10-W.8b integrated REAL-provider run (Codex owner + Codex reviewer) on native Windows", () => {
  it("completes a real Codex run end-to-end through the integrated runtime to a governed merge", async () => {
    await runMigrations();
    const base = makeFixtureRepo();
    const id = uuid();
    runIds.push(id);

    const svc = new IntegratedRunService({
      store: new PgIntegratedRunStore(pool),
      gitRunner: new NodeGitRunner(),
      processRunner: new TrustedCommandRunner(),
      clock: new ManualClock(),
      stateRoot: makeTempDir("triforge-real-state-"),
      now: () => new Date().toISOString(),
      newId: () => id,
      envAllowlist: [...WINDOWS_BASE_ENV_ALLOWLIST],
      commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] }
    });

    const spec: IntegratedRunSpec = {
      objective: "Add a slugify helper under src/slugify.js exporting slugify(str) so `npm test` passes",
      owner: "codex",
      reviewer: "codex",
      providerMode: "real",
      collaborationMode: "specialist",
      fixtureRepoPath: base,
      writePaths: ["src"],
      readPaths: ["."],
      blockedPaths: [],
      maxFilesChanged: 10,
      gates: [{ name: "unit", command: { bin: "npm", args: ["test"] } }],
      ownerModel: null,
      reviewerModel: null,
      budget: { maxRepairRounds: 1, perRunTimeoutMs: 240_000 }
    };

    await svc.create(spec);
    const final = await svc.start(id);

    expect(final.status).toBe("completed");
    expect(final.ownerProvenance?.isReal).toBe(true);
    expect(final.ownerProvenance?.provider).toBe("codex");
    expect(final.report?.governance.verdict).toBe("merge");
    expect(final.report?.merged).toBe(true);
    expect(final.report?.changedFiles.some((f) => f.path.includes("slugify"))).toBe(true);

    const events = await svc.timeline(id);
    expect(events.map((e) => e.sequenceNumber)).toEqual(events.map((_, i) => i + 1)); // gapless
    expect(events.filter((e) => ["run.completed", "run.failed", "run.cancelled"].includes(e.type))).toHaveLength(1);
    // real provider provenance is recorded on the provider events
    const fileChanged = events.find((e) => e.type === "file.changed");
    expect(fileChanged?.providerVersion).toMatch(/^\d/); // a real CLI version, not "mock-*"
  }, 300_000);
});
