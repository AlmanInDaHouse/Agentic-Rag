/**
 * A10-W.7 — REAL cross-vendor pilots on the native Windows host.
 *
 * verified_real_provider evidence for codex_owner_claude_reviewer_e2e and
 * claude_owner_codex_reviewer_e2e. Each pilot runs the FULL writable pipeline with REAL
 * providers on a DISPOSABLE fixture git repo (never the TriForge tree): worktree →
 * real owner writes → ledger (attributed via path-checked replay) → diff → quality
 * gates (npm test → node --test) → real cross-vendor review → repair loop → governed
 * GovernanceDecision → governed merge into the fixture base → cleanup.
 *
 * DOUBLE-GATED: `win32` AND `TRIFORGE_REAL_PROVIDER=1`. Claude runs use `--model sonnet`
 * to conserve the 7-day quota; codex uses its configured default. Run locally:
 *   $env:TRIFORGE_REAL_PROVIDER = "1"
 *   corepack pnpm --filter @triforge/api exec vitest run realPilot.host
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRealPilot, type RealPilotResult } from "../execution/e2e/realPilot.js";
import type { GateSpec } from "../execution/gates/index.js";

const RUN = process.platform === "win32" && process.env.TRIFORGE_REAL_PROVIDER === "1";

const tmp: string[] = [];

function git(dir: string, args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { windowsHide: true });
}

/** A disposable git repo with a failing stub the owner must implement + a node:test gate. */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tf-pilot-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tf-pilot-fixture", private: true, scripts: { test: "node --test" } }, null, 2)
  );
  writeFileSync(
    path.join(dir, "src", "slugify.js"),
    "/**\n * Convert a string to a URL slug.\n * @param {string} input\n * @returns {string}\n */\n" +
      "function slugify(input) {\n  throw new Error('not implemented');\n}\nmodule.exports = { slugify };\n"
  );
  writeFileSync(
    path.join(dir, "src", "slugify.test.js"),
    "const test = require('node:test');\nconst assert = require('node:assert');\nconst { slugify } = require('./slugify');\n\n" +
      "test('lowercases', () => assert.strictEqual(slugify('Hello'), 'hello'));\n" +
      "test('collapses whitespace runs to single hyphens', () => assert.strictEqual(slugify('a  b   c'), 'a-b-c'));\n" +
      "test('trims surrounding whitespace', () => assert.strictEqual(slugify('  hi there  '), 'hi-there'));\n"
  );
  execFileSync("git", ["init", "-q", dir], { windowsHide: true });
  git(dir, ["config", "user.email", "pilot@local"]);
  git(dir, ["config", "user.name", "pilot"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "fixture: slugify stub + tests"]);
  tmp.push(dir);
  return dir;
}

function makeStateRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tf-pstate-"));
  tmp.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmp.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const GATES: GateSpec[] = [{ name: "unit", command: { bin: "npm", args: ["test"] } }];
const TASK =
  "Implement the slugify(input) function in src/slugify.js so every test in src/slugify.test.js passes: " +
  "lowercase the input, trim surrounding whitespace, and replace each run of whitespace with a single hyphen. " +
  "Edit ONLY src/slugify.js.";

function reportPilot(label: string, r: RealPilotResult): void {
  // eslint-disable-next-line no-console
  console.log(
    `[${label}] verdict=${r.report.governance.verdict} merged=${r.report.merged} repairState=${r.report.repairState} ` +
      `ledgerEntries=${r.report.ledgerEntryCount} reconciledTampered=${r.report.reconciledTampered} ` +
      `reviewerVerdict=${r.reviewerVerdict} ownerEvents=${r.ownerEventCount} wrote=${JSON.stringify(r.ownerWroteFiles)} ` +
      `refusedReplays=${JSON.stringify(r.ownerReviewerWriteRefused)}`
  );
}

/** Invariants that MUST hold for any real pilot run, independent of the LLM's content. */
function assertPipelineInvariants(r: RealPilotResult): void {
  // The real owner writes were attributed to the owner via the path-checked replay —
  // NOT flagged as out-of-ledger tampering. This is the core A10-W.7 integration proof.
  expect(r.report.reconciledTampered).toBe(false);
  expect(r.report.gateTampered).toBe(false);
  expect(r.report.ledgerEntryCount).toBeGreaterThan(0);
  expect(r.ownerWroteFiles).toContain("src/slugify.js");
  expect(r.ownerReviewerWriteRefused).toEqual([]); // every owner write stayed in-policy
  expect(["pass", "fail", "uncertain"]).toContain(r.reviewerVerdict);
  expect(r.report.cleanedUp).toBe(true);
  // The governance verdict is real; when it is "merge" the governed merge MUST have run.
  if (r.report.governance.verdict === "merge") {
    expect(r.report.merged).toBe(true);
  }
}

describe.runIf(RUN)("A10-W.7 — real cross-vendor pilots (verified_real_provider)", () => {
  it("Pilot A: codex owner + claude reviewer → governed merge on a fixture repo", async () => {
    const r = await runRealPilot({
      owner: "codex",
      reviewer: "claude",
      fixtureRepoPath: makeFixtureRepo(),
      stateRoot: makeStateRoot(),
      runId: "pilotA",
      task: TASK,
      writePaths: ["src"],
      gates: GATES,
      reviewerModel: "sonnet",
      maxRepairRounds: 2,
      perRunTimeoutMs: 240_000
    });
    reportPilot("Pilot A", r);
    assertPipelineInvariants(r);
    // Happy path: the owner implements a correct slugify → gates pass → reviewer PASS →
    // governed merge into the fixture base.
    expect(r.report.governance.verdict).toBe("merge");
    expect(r.report.merged).toBe(true);
  }, 600_000);

  it("Pilot B: claude owner + codex reviewer → governed merge on a fixture repo", async () => {
    const r = await runRealPilot({
      owner: "claude",
      reviewer: "codex",
      fixtureRepoPath: makeFixtureRepo(),
      stateRoot: makeStateRoot(),
      runId: "pilotB",
      task: TASK,
      writePaths: ["src"],
      gates: GATES,
      ownerModel: "sonnet",
      maxRepairRounds: 2,
      perRunTimeoutMs: 240_000
    });
    reportPilot("Pilot B", r);
    assertPipelineInvariants(r);
    expect(r.report.governance.verdict).toBe("merge");
    expect(r.report.merged).toBe(true);
  }, 600_000);
});
