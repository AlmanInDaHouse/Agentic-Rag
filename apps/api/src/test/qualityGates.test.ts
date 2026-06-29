import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { FakeProcessRunner, type ProcessRunSpec } from "../providers/real/processRunner.js";
import { CommandPolicy, CommandSupervisor } from "../execution/command/index.js";
import {
  QualityGateRunner,
  detectGateTampering,
  type GateSpec
} from "../execution/gates/index.js";
import type { WorktreeChange } from "../execution/ledger/index.js";

const tempDirs: string[] = [];
function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-gatews-"));
  tempDirs.push(dir);
  return dir;
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

/** A supervisor whose fake runner exits non-zero iff argv contains "fail-sentinel". */
function makeSupervisor(ws: string): CommandSupervisor {
  const runner = new FakeProcessRunner((spec: ProcessRunSpec) => {
    const fail = spec.args.includes("fail-sentinel");
    return {
      lines: [{ stream: "stdout" as const, line: fail ? "boom" : "ok" }],
      exit: { code: fail ? 1 : 0, signal: null, reason: "exited" as const }
    };
  });
  return new CommandSupervisor({
    policy: new CommandPolicy({ workspaceRoot: ws }),
    runner,
    clock: new ManualClock()
  });
}

describe("QualityGateRunner — structured result from real exit codes", () => {
  it("reports passed when every gate exits 0, binding the tested diff hash", async () => {
    const ws = makeWorkspace();
    const gates: GateSpec[] = [
      { name: "typecheck", command: { bin: "tsc", args: ["-p", "."] } },
      { name: "unit", command: { bin: "vitest", args: ["run"] } }
    ];
    const runner = new QualityGateRunner({
      supervisor: makeSupervisor(ws),
      cwd: ws,
      gates,
      clock: new ManualClock(),
      testedDiffHash: "diff-123"
    });
    const result = await runner.run();
    expect(result.overallStatus).toBe("passed");
    expect(result.gates.map((g) => g.status)).toEqual(["passed", "passed"]);
    expect(result.testedDiffHash).toBe("diff-123");
    expect(result.gates[0].outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports failed from the REAL exit code (no provider claim can override)", async () => {
    const ws = makeWorkspace();
    const gates: GateSpec[] = [
      { name: "unit", command: { bin: "vitest", args: ["run"] } },
      { name: "build", command: { bin: "tsc", args: ["fail-sentinel"] } } // exits 1
    ];
    const runner = new QualityGateRunner({ supervisor: makeSupervisor(ws), cwd: ws, gates, clock: new ManualClock() });
    const result = await runner.run();
    expect(result.overallStatus).toBe("failed");
    const build = result.gates.find((g) => g.name === "build");
    expect(build).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("fails a gate whose command the policy rejects (never silently passed)", async () => {
    const ws = makeWorkspace();
    const gates: GateSpec[] = [{ name: "custom", command: { bin: "rm", args: ["-rf", "x"] } }];
    const runner = new QualityGateRunner({ supervisor: makeSupervisor(ws), cwd: ws, gates, clock: new ManualClock() });
    const result = await runner.run();
    expect(result.gates[0]).toMatchObject({ status: "failed" });
    expect(result.gates[0].detail).toMatch(/rejected by policy/);
  });
});

describe("detectGateTampering — deleted tests + weakened CI", () => {
  function change(relPath: string, status: WorktreeChange["status"], renamedFrom?: string): WorktreeChange {
    return { relPath, status, hash: status === "delete" ? null : "h", renamedFrom };
  }

  it("flags a deleted test file", () => {
    const report = detectGateTampering([
      change("src/app.ts", "modify"),
      change("src/app.test.ts", "delete")
    ]);
    expect(report.tampered).toBe(true);
    expect(report.deletedTests).toContain("src/app.test.ts");
  });

  it("flags a test renamed away", () => {
    const report = detectGateTampering([change("src/x.ts", "rename", "src/x.spec.ts")]);
    expect(report.deletedTests).toContain("src/x.spec.ts");
  });

  it("flags CI workflow and root package.json changes", () => {
    const report = detectGateTampering([
      change(".github/workflows/ci.yml", "modify"),
      change("package.json", "modify")
    ]);
    expect(report.tampered).toBe(true);
    expect(report.ciConfigChanges).toEqual(
      expect.arrayContaining([".github/workflows/ci.yml", "package.json"])
    );
  });

  it("does not flag an ordinary source change", () => {
    const report = detectGateTampering([change("src/app.ts", "modify"), change("src/new.ts", "create")]);
    expect(report.tampered).toBe(false);
    expect(report.deletedTests).toHaveLength(0);
    expect(report.ciConfigChanges).toHaveLength(0);
  });
});
