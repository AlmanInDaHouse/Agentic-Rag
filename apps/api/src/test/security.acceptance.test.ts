/**
 * A9.2 Security acceptance tests (mandate §11 / A0.5).
 *
 * Executable acceptance criteria for the A0.5 threat-model controls — each test asserts a
 * security control HOLDS, composing the REAL A5 components, and is mapped to its SAT id.
 * This is the consolidated security gate for the release candidate; it deliberately
 * re-asserts the controls at acceptance level (component tests cover the internals).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapabilityBinding, FindingsSummary, TestSummary } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import { PathPolicyEngine, type AllowedPathPolicy } from "../execution/path/pathPolicy.js";
import { CommandPolicy } from "../execution/command/commandPolicy.js";
import { redactSecrets } from "../execution/ledger/mutationLedger.js";
import {
  buildGovernanceDecision,
  verifyDecisionBinding,
  type GovernanceInputs
} from "../execution/governance/index.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function makeWorkspace(): string {
  const ws = mkdtempSync(path.join(tmpdir(), "triforge-sat-"));
  tempDirs.push(ws);
  mkdirSync(path.join(ws, "src"), { recursive: true });
  writeFileSync(path.join(ws, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(path.join(ws, "secret.txt"), "shh\n");
  mkdirSync(path.join(ws, ".git"), { recursive: true });
  writeFileSync(path.join(ws, ".git", "config"), "[core]\n");
  return ws;
}

const POLICY: AllowedPathPolicy = {
  readPaths: ["src"],
  writePaths: ["src"],
  blockedPaths: [],
  maxFilesChanged: 10
};

function engine(ws: string): PathPolicyEngine {
  return new PathPolicyEngine({ workspaceRoot: ws, policy: POLICY, clock: new ManualClock(0) });
}

// --- SAT-A5-1: filesystem containment (T-FS-*) ---------------------------------

describe("SAT-A5-1 — filesystem containment holds (path policy)", () => {
  it("refuses a write outside the write allow-list", () => {
    const e = engine(makeWorkspace());
    expect(e.checkWrite("secret.txt").allowed).toBe(false);
  });

  it("refuses a write to .git", () => {
    const e = engine(makeWorkspace());
    expect(e.checkWrite(".git/config")).toMatchObject({ allowed: false, reason: "blocked_git" });
  });

  it("refuses a path-traversal escape", () => {
    const e = engine(makeWorkspace());
    expect(e.checkWrite("../escape.txt")).toMatchObject({ allowed: false, reason: "traversal" });
  });

  it("allows a write inside the allow-list", () => {
    const e = engine(makeWorkspace());
    expect(e.checkWrite("src/app.ts").allowed).toBe(true);
  });

  it("refuses a symlinked-ancestor escape (POSIX; skipped where symlink needs privilege)", () => {
    const ws = makeWorkspace();
    const external = mkdtempSync(path.join(tmpdir(), "triforge-ext-"));
    tempDirs.push(external);
    let linked = false;
    try {
      symlinkSync(external, path.join(ws, "src", "out"), "dir");
      linked = true;
    } catch {
      /* symlink needs privilege on win32; CI is Linux */
    }
    if (linked) {
      expect(engine(ws).checkWrite("src/out/loot.txt")).toMatchObject({ allowed: false, reason: "symlink_escape" });
    }
  });
});

// --- SAT-A5-3: command deny-by-default + no shell (T-EXE-*, T-CMP-*) -----------

describe("SAT-A5-3 — command policy denies dangerous categories by default; no shell", () => {
  const ws = process.cwd();
  const policy = new CommandPolicy({ workspaceRoot: ws });

  it("denies a destructive command (rm -rf) by default", () => {
    const d = policy.check({ bin: "rm", args: ["-rf", "src"] }, ws);
    expect(d.allowed).toBe(false);
    expect(d.category).toBe("destructive");
  });

  it("denies a network command (curl) by default", () => {
    expect(policy.check({ bin: "curl", args: ["http://x"] }, ws).allowed).toBe(false);
  });

  it("denies a privileged command (sudo) by default", () => {
    expect(policy.check({ bin: "sudo", args: ["ls"] }, ws).allowed).toBe(false);
  });

  it("does NOT shell-interpret arguments (a metacharacter arg is literal data)", () => {
    // `echo` with a "&& rm -rf /" ARG is not a destructive command — there is no shell.
    const c = policy.classify({ bin: "echo", args: ["hello && rm -rf /"] });
    expect(c.category).not.toBe("destructive");
  });

  it("rejects an invalid command spec (e.g. a shell string in bin)", () => {
    const d = policy.check({ bin: "rm -rf /", args: [] }, ws);
    // A shell string as bin is classified by its first token and still denied.
    expect(d.allowed).toBe(false);
  });
});

// --- SAT-A5-5: ledger secret redaction (T-INT-*) ------------------------------

describe("SAT-A5-5 — the mutation ledger redacts secrets", () => {
  it("masks a secret-shaped token in a mutation reason", () => {
    const out = redactSecrets("set token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX in config");
    expect(out).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWX");
  });
});

// --- SAT-A5-8: governance anti-replay (T-INT-*) -------------------------------

const BINDING: CapabilityBinding = {
  threat: ["T-INT-04"],
  control: ["A5.5 ledger reconcile", "A5.6 real gates"],
  milestone: "A5.8",
  verification: ["security.acceptance.test.ts"],
  recovery: "revert + ledger",
  residualRisk: "RR-4 no OS sandbox"
};
const NO_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };
const TESTS: TestSummary = { passed: 10, failed: 0, skipped: 0, total: 10 };

function mergeInputs(): GovernanceInputs {
  return {
    task: "add feature",
    specHash: "spec-1",
    acceptanceCriteria: ["does X"],
    contextHash: "ctx-1",
    owner: "codex",
    reviewer: "claude",
    worktree: "/wt",
    branch: "triforge/run1/taskA",
    diffHash: "diff-1",
    ledgerHeadHash: "ledger-1",
    ledgerTampered: false,
    gateTampered: false,
    gatesPassed: true,
    gateTestedDiffHash: "diff-1",
    gateResultHash: "gate-1",
    findings: NO_FINDINGS,
    tests: TESTS,
    repairState: "accepted",
    repairRounds: 1,
    quota: null,
    unresolvedRisks: [],
    capabilityBinding: BINDING
  };
}

describe("SAT-A5-8 — governance decision binding is anti-replay", () => {
  it("accepts the binding only against the exact bound state", () => {
    const record = buildGovernanceDecision(mergeInputs());
    expect(verifyDecisionBinding(record, { diffHash: "diff-1", ledgerHeadHash: "ledger-1", gateResultHash: "gate-1" }).valid).toBe(true);
  });

  it("rejects a binding whose diff changed after the decision (replay / TOCTOU)", () => {
    const record = buildGovernanceDecision(mergeInputs());
    expect(verifyDecisionBinding(record, { diffHash: "diff-CHANGED", ledgerHeadHash: "ledger-1", gateResultHash: "gate-1" }).valid).toBe(false);
  });

  it("rejects a binding whose gate result changed after the decision", () => {
    const record = buildGovernanceDecision(mergeInputs());
    expect(verifyDecisionBinding(record, { diffHash: "diff-1", ledgerHeadHash: "ledger-1", gateResultHash: "gate-CHANGED" }).valid).toBe(false);
  });
});
