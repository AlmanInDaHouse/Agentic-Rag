import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { NodeProcessRunner } from "../providers/real/processRunner.js";
import { CommandPolicy, CommandSupervisor } from "../execution/command/index.js";

/**
 * Real-process supervision evidence (mandate §A5.3: timeout, cancellation,
 * orphan/process-group). The cross-platform block exercises the `NodeProcessRunner`
 * the supervisor reuses (cancel + timeout) on every OS. The POSIX-only block proves
 * the supervisor end-to-end with an allowed real binary and the process-GROUP orphan
 * reaping (`detached` + negative-PID kill), which is Linux/WSL2 substrate behavior.
 */
const POSIX = process.platform !== "win32";
const onPosix = POSIX ? describe : describe.skip;

const tempDirs: string[] = [];
function makeDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

const NODE_ENV_ALLOW = ["PATH", "Path", "HOME", "SystemRoot", "windir"];

describe("NodeProcessRunner — real cancel/timeout (cross-platform)", () => {
  it("cancellation terminates a real long-running process", async () => {
    const ws = makeDir("triforge-proc-");
    const runner = new NodeProcessRunner({ killGraceMs: 300 });
    const proc = runner.run({
      bin: process.execPath,
      args: ["-e", "setTimeout(()=>{},30000)"],
      cwd: ws,
      envAllowlist: NODE_ENV_ALLOW,
      timeoutMs: 30_000,
      maxOutputBytes: null
    });
    void (async () => {
      for await (const _l of proc.output) {
        /* drain */
      }
    })();
    await delay(300);
    await proc.cancel();
    const exit = await proc.exit;
    expect(exit.reason).toBe("cancelled");
  }, 20_000);

  it("timeout terminates a real long-running process", async () => {
    const ws = makeDir("triforge-proc-");
    const runner = new NodeProcessRunner({ killGraceMs: 300 });
    const proc = runner.run({
      bin: process.execPath,
      args: ["-e", "setTimeout(()=>{},30000)"],
      cwd: ws,
      envAllowlist: NODE_ENV_ALLOW,
      timeoutMs: 500,
      maxOutputBytes: null
    });
    void (async () => {
      for await (const _l of proc.output) {
        /* drain */
      }
    })();
    const exit = await proc.exit;
    expect(exit.reason).toBe("timeout");
  }, 20_000);
});

onPosix("CommandSupervisor — supervised real binary + orphan reaping (POSIX)", () => {
  function makeSupervisor(ws: string, timeoutMs: number): CommandSupervisor {
    return new CommandSupervisor({
      policy: new CommandPolicy({ workspaceRoot: ws, config: { allowedCategories: ["read_only"] } }),
      runner: new NodeProcessRunner({ killGraceMs: 250 }),
      clock: new ManualClock(),
      envAllowlist: ["PATH", "HOME"],
      timeoutMs
    });
  }

  it("cancels a long-running allowed command (tail) via the process group", async () => {
    const ws = makeDir("triforge-cmd-");
    const sup = makeSupervisor(ws, 20_000);
    const run = sup.start({ bin: "tail", args: ["-f", "/dev/null"] }, ws);
    await delay(400);
    await run.cancel();
    const r = await run.result;
    expect(r.allowed).toBe(true);
    expect(r.terminationReason).toBe("cancelled");
  }, 25_000);

  it("times out a long-running allowed command", async () => {
    const ws = makeDir("triforge-cmd-");
    const sup = makeSupervisor(ws, 500);
    const r = await sup.run({ bin: "tail", args: ["-f", "/dev/null"] }, ws);
    expect(r.terminationReason).toBe("timeout");
  }, 25_000);

  it("reaps an orphaned child via the process group (no sentinel written)", async () => {
    const ws = makeDir("triforge-cmd-");
    const sentinel = path.join(makeDir("triforge-sent-"), "fired");
    process.env.TRIFORGE_SENTINEL = sentinel;
    // Parent forks a NON-detached child that writes the sentinel after 3.5s. The
    // child stays in the parent's process group, so a group kill must reap it.
    const childScript =
      "const fs=require('fs');setTimeout(()=>{fs.writeFileSync(process.env.TRIFORGE_SENTINEL,'x')},3500)";
    const parentScript =
      `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore',env:process.env});` +
      "setTimeout(()=>{},20000)";
    const runner = new NodeProcessRunner({ killGraceMs: 250 });
    const proc = runner.run({
      bin: process.execPath,
      args: ["-e", parentScript],
      cwd: ws,
      envAllowlist: ["PATH", "HOME", "TRIFORGE_SENTINEL"],
      timeoutMs: 20_000,
      maxOutputBytes: null
    });
    void (async () => {
      for await (const _l of proc.output) {
        /* drain */
      }
    })();
    await delay(500); // let the parent spawn its child
    await proc.cancel(); // SIGTERM the whole group
    await proc.exit;
    await delay(3300); // wait past the child's would-be write time
    delete process.env.TRIFORGE_SENTINEL;
    expect(existsSync(sentinel)).toBe(false);
  }, 30_000);
});
