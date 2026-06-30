/**
 * A10-W.4 — Job Object process supervision, REAL host chaos tests (win32).
 *
 * Empirical adversarial verification of native tree reaping: a child spawns a
 * long-sleeping GRANDCHILD; after cancel() the kill-on-close Job Object must reap
 * the whole tree — a surviving grandchild FAILS the test (this is exactly what
 * taskkill /T can miss and the Job Object guarantees). Runs only on win32.
 */

import { describe, expect, it } from "vitest";
import os from "node:os";
import { WindowsExecutionPlatform } from "../platform/index.js";
import type { ManagedProcess } from "@triforge/shared";

const RUN = process.platform === "win32";
const NODE = process.execPath;

const ENV: Record<string, string> = {};
for (const k of ["SystemRoot", "windir", "PATH", "Path", "PATHEXT", "TEMP", "TMP", "COMSPEC"]) {
  const v = process.env[k];
  if (v) ENV[k] = v;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists but unsignalable
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read output lines until `re` matches (or reject after `timeoutMs`). */
async function readUntil(mp: ManagedProcess, re: RegExp, timeoutMs: number): Promise<string> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("readUntil timeout")), timeoutMs)));
  const reader = (async () => {
    for await (const rec of mp.output) {
      if (re.test(rec.line)) return rec.line;
    }
    throw new Error("output ended before match");
  })();
  try {
    return await Promise.race([reader, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const platform = new WindowsExecutionPlatform();

// A child that, after a 300ms delay (so the holder has assigned it to the job),
// spawns a 10-minute-sleeping grandchild and prints its PID, then sleeps too.
const CHILD_SCRIPT =
  'const cp=require("child_process");' +
  'setTimeout(()=>{const g=cp.spawn(process.execPath,["-e","setTimeout(()=>{},600000)"],{stdio:"ignore"});' +
  'process.stdout.write("GPID="+g.pid+"\\n");},300);' +
  "setTimeout(()=>{},600000);";

describe.runIf(RUN)("A10-W.4 Job Object supervision — real host chaos", () => {
  it("reaps the whole tree (child + grandchild) on cancel — kill-on-close", async () => {
    const mp = await platform.createManagedProcess({ executable: NODE, args: ["-e", CHILD_SCRIPT], cwd: os.tmpdir(), env: ENV });
    const line = await readUntil(mp, /GPID=\d+/, 15_000);
    const gpid = Number(/GPID=(\d+)/.exec(line)![1]);
    expect(alive(gpid)).toBe(true);

    await mp.cancel("cancelled");
    const result = await mp.terminal;
    expect(result.reason).toBe("cancelled");

    // The Job Object must have reaped the grandchild. Poll briefly for the OS.
    let stillAlive = true;
    for (let i = 0; i < 40 && stillAlive; i++) {
      stillAlive = alive(gpid);
      if (stillAlive) await sleep(100);
    }
    expect(stillAlive, `grandchild ${gpid} should be reaped by the Job Object`).toBe(false);
  }, 30_000);

  it("captures output and reports a normal exit with its code", async () => {
    const mp = await platform.createManagedProcess({
      executable: NODE,
      args: ["-e", 'process.stdout.write("hello\\n");process.stderr.write("warn\\n");process.exit(3);'],
      cwd: os.tmpdir(),
      env: ENV
    });
    const lines: { stream: string; line: string }[] = [];
    for await (const rec of mp.output) lines.push(rec);
    const result = await mp.terminal;
    expect(result.reason).toBe("exited");
    expect(result.exitCode).toBe(3);
    expect(lines.some((l) => l.stream === "stdout" && l.line === "hello")).toBe(true);
    expect(lines.some((l) => l.stream === "stderr" && l.line === "warn")).toBe(true);
  }, 20_000);

  it("enforces a timeout by reaping the tree", async () => {
    const mp = await platform.createManagedProcess({
      executable: NODE,
      args: ["-e", "setTimeout(()=>{},600000);"],
      cwd: os.tmpdir(),
      env: ENV,
      timeoutMs: 800
    });
    const result = await mp.terminal;
    expect(result.reason).toBe("timeout");
  }, 20_000);

  it("double cancel is idempotent", async () => {
    const mp = await platform.createManagedProcess({
      executable: NODE,
      args: ["-e", "setTimeout(()=>{},600000);"],
      cwd: os.tmpdir(),
      env: ENV
    });
    await mp.cancel("cancelled");
    await mp.cancel("cancelled");
    const result = await mp.terminal;
    expect(result.reason).toBe("cancelled");
  }, 20_000);
});
