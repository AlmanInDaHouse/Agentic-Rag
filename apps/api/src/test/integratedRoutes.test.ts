import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { NodeGitRunner } from "../execution/worktree/index.js";
import { FakeProcessRunner, type ProcessRunSpec } from "../providers/real/processRunner.js";
import { IntegratedRunService, InMemoryIntegratedRunStore } from "../execution/integrated/index.js";
import { registerIntegratedRoutes } from "../http/integratedRoutes.js";

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
  const repo = makeTempDir("triforge-route-base-");
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

function buildApp(): FastifyInstance {
  const service = new IntegratedRunService({
    store: new InMemoryIntegratedRunStore(),
    gitRunner: new NodeGitRunner({ hardeningRoot: makeTempDir("triforge-route-harden-") }),
    processRunner: new FakeProcessRunner((_spec: ProcessRunSpec) => ({
      lines: [{ stream: "stdout" as const, line: "ok" }],
      exit: { code: 0, signal: null, reason: "exited" as const }
    })),
    clock: new ManualClock(),
    stateRoot: makeTempDir("triforge-route-state-"),
    now: () => "2026-06-30T00:00:00.000Z",
    newId: () => `00000000-0000-4000-8000-${String(idc++).padStart(12, "0")}`,
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] }
  });
  const app = Fastify();
  registerIntegratedRoutes(app, service, { repoRoot: TRIFORGE_ROOT, defaultProviderMode: "mock" });
  return app;
}
let idc = 1;
const TRIFORGE_ROOT = path.resolve(process.cwd()); // a path that the fixtures are NEVER under

function validBody(fixture: string) {
  return {
    objective: "add a generated file",
    owner: "codex",
    reviewer: "claude",
    providerMode: "mock",
    collaborationMode: "specialist",
    fixtureRepoPath: fixture,
    writePaths: ["src"],
    gates: [{ name: "unit", command: { bin: "vitest", args: ["run"] } }]
  };
}

describe("integrated runtime HTTP API", () => {
  it("creates, starts, and reports a run end-to-end (mock mode)", async () => {
    const app = buildApp();
    const fixture = makeFixtureRepo();

    const created = await app.inject({ method: "POST", url: "/api/integrated-runs", payload: validBody(fixture) });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    expect(typeof id).toBe("string");

    const started = await app.inject({ method: "POST", url: `/api/integrated-runs/${id}/start` });
    expect(started.statusCode).toBe(202);

    // Poll until terminal.
    let status = "running";
    for (let i = 0; i < 100 && !["completed", "failed", "cancelled", "blocked"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 100));
      const res = await app.inject({ method: "GET", url: `/api/integrated-runs/${id}` });
      status = res.json().status;
    }
    expect(status).toBe("completed");

    const timeline = await app.inject({ method: "GET", url: `/api/integrated-runs/${id}/timeline` });
    const events = timeline.json().events as Array<{ sequenceNumber: number; type: string }>;
    expect(events.map((e) => e.sequenceNumber)).toEqual(events.map((_, i) => i + 1));
    expect(events.filter((e) => ["run.completed", "run.failed", "run.cancelled"].includes(e.type))).toHaveLength(1);

    const artifacts = await app.inject({ method: "GET", url: `/api/integrated-runs/${id}/artifacts` });
    expect(artifacts.json().merged).toBe(true);

    const diff = await app.inject({ method: "GET", url: `/api/integrated-runs/${id}/diff` });
    expect((diff.json().changedFiles as unknown[]).length).toBeGreaterThan(0);

    await app.close();
  }, 30_000);

  it("refuses a run targeting the TriForge repository (forbidden_target)", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/integrated-runs",
      payload: validBody(path.join(TRIFORGE_ROOT, "some", "nested", "path"))
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("forbidden_target");
    await app.close();
  });

  it("rejects a non-existent / non-git fixture path", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/integrated-runs",
      payload: validBody(path.join(makeTempDir("triforge-not-a-repo-"), "nope"))
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("validates the body and 404s unknown runs", async () => {
    const app = buildApp();
    const bad = await app.inject({ method: "POST", url: "/api/integrated-runs", payload: { objective: "" } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/api/integrated-runs/00000000-0000-4000-8000-000000009999" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
