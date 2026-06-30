/**
 * Shared, dependency-free helpers for the TriForge lifecycle CLIs
 * (setup / dev / start / stop / status / clean).
 *
 * Design rules (mirrors tooling/triforge-cli/doctor.mjs):
 *  - No npm dependencies; runnable from Windows PowerShell 5.1 before any build.
 *  - Safe command discipline: resolve via `where` (prefer .exe, then .cmd); a .cmd
 *    shim runs through `cmd /d /c <resolved> <args>` with shell:false (no string
 *    concatenation, no .cmd argument-injection, no DEP0190); the npm `.ps1` shim is
 *    never used. Args are validated to reject shell metacharacters.
 *  - No secrets: never read tokens, credential stores, passwords, or env values that
 *    look credential-shaped.
 *
 * The PURE helpers (path resolution, pid-file (de)serialization, readiness/clean
 * policy) are exported and unit-tested under tooling/triforge-cli/*.test.mjs; the
 * process-orchestration helpers (spawnDetached, waitFor, probes) are exercised by the
 * real host runs.
 */

import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { request as httpRequest } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export const API_PORT = Number(process.env.PORT ?? 3001);
export const WEB_PORT = Number(process.env.TRIFORGE_WEB_PORT ?? 5173);
export const API_HOST = "127.0.0.1";
export const PG_PORT = Number((process.env.DATABASE_URL?.match(/:(\d+)\//) ?? [])[1] ?? 5432);

/* ------------------------------------------------------------------ *
 * PURE helpers (unit-tested)
 * ------------------------------------------------------------------ */

/** Resolve the writable TriForge state root (no I/O). %LOCALAPPDATA%\TriForge on
 *  Windows, $XDG_STATE_HOME/triforge or ~/.triforge elsewhere. */
export function resolveStateRoot(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA && env.LOCALAPPDATA.trim() !== ""
      ? env.LOCALAPPDATA
      : path.join(homedir, "AppData", "Local");
    return path.join(base, "TriForge");
  }
  const xdg = env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() !== "" ? env.XDG_STATE_HOME : null;
  return xdg ? path.join(xdg, "triforge") : path.join(homedir, ".triforge");
}

export function runtimeDir(stateRoot) {
  return path.join(stateRoot, "runtime");
}
export function pidsFilePath(stateRoot) {
  return path.join(runtimeDir(stateRoot), "services.json");
}
export function logDir(stateRoot) {
  return path.join(stateRoot, "logs");
}

/** A managed-services record. `services` maps a label to { pid, port, command }. */
export function buildServicesRecord(services, startedAtIso) {
  return { schemaVersion: 1, startedAt: startedAtIso, services };
}

/** Parse + validate a services.json text. Returns null on any malformation (fail-safe:
 *  callers treat null as "no managed services" rather than crashing). */
export function parseServicesRecord(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.services !== "object" || parsed.services === null) {
    return null;
  }
  const services = {};
  for (const [label, entry] of Object.entries(parsed.services)) {
    if (!entry || typeof entry !== "object") return null;
    const pid = Number(entry.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    services[label] = {
      pid,
      port: Number.isInteger(Number(entry.port)) ? Number(entry.port) : null,
      command: typeof entry.command === "string" ? entry.command : ""
    };
  }
  return { schemaVersion: 1, startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "", services };
}

/** Overall readiness from individual probe booleans. Ready iff every required probe ok. */
export function readinessFrom(probes) {
  const required = ["api", "web"];
  const missing = required.filter((k) => !probes[k]);
  return { ready: missing.length === 0, missing };
}

/** Decide which clean actions run given the flags. Pure policy — no I/O.
 *  Persistent stores (DB, ledgers, evidence) are NEVER touched unless `all` is set. */
export function cleanPlan({ all = false } = {}) {
  return {
    staleWorktrees: true, // `git worktree prune` is always safe (only removes already-deleted worktrees)
    managedProcesses: true, // stop processes recorded in services.json
    transientLogs: true, // rotate/remove runtime logs
    runtimeState: true, // remove runtime/ (pid files) — re-created on next start
    persistentState: all // ledgers / state data only with explicit --all
  };
}

/** Reject obviously unsafe argv tokens (defense-in-depth; we never use shell:true). */
export function isSafeArg(arg) {
  return typeof arg === "string" && !/[\r\n\0]/.test(arg);
}

/* ------------------------------------------------------------------ *
 * Safe command resolution + execution (mirrors doctor.mjs)
 * ------------------------------------------------------------------ */

/** Resolve a command on Windows via `where`, preferring .exe then .cmd/.bat. */
export function whichWin(cmd) {
  const res = spawnSync("where", [cmd], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return null;
  const matches = res.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return (
    matches.find((m) => m.toLowerCase().endsWith(".exe")) ??
    matches.find((m) => /\.(cmd|bat)$/i.test(m)) ??
    matches[0] ??
    null
  );
}

/** Build a [command, args] pair that runs safely with shell:false on every platform. */
export function safeInvocation(cmd, args) {
  if (process.platform !== "win32") return { command: cmd, args };
  const resolved = whichWin(cmd) ?? cmd;
  if (/\.(cmd|bat)$/i.test(resolved)) {
    for (const a of args) {
      if (!isSafeArg(a)) throw new Error(`unsafe argument for .cmd invocation: ${JSON.stringify(a)}`);
    }
    return { command: "cmd", args: ["/d", "/c", resolved, ...args] };
  }
  return { command: resolved, args };
}

/** Synchronous safe run; returns { ok, code, stdout, stderr }. */
export function safeRun(cmd, args, { cwd, timeout = 20000, env } = {}) {
  const { command, args: finalArgs } = safeInvocation(cmd, args);
  const res = spawnSync(command, finalArgs, { cwd, timeout, encoding: "utf8", shell: false, env });
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? ""
  };
}

/* ------------------------------------------------------------------ *
 * Probes
 * ------------------------------------------------------------------ */

export function tcpReachable(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

/** GET a URL; resolves { ok, status } (ok iff a 2xx/3xx/4xx response was received —
 *  i.e. something is listening and speaking HTTP). For /health we additionally check 200. */
export function httpGet(url, timeout = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = httpRequest(url, { method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c) => { if (body.length < 4096) body += c; });
        res.on("end", () => finish({ ok: true, status: res.statusCode ?? 0, body }));
      });
      req.setTimeout(timeout, () => { try { req.destroy(); } catch { /* ignore */ } finish({ ok: false, status: 0, body: "" }); });
      req.on("error", () => finish({ ok: false, status: 0, body: "" }));
      req.end();
    } catch {
      finish({ ok: false, status: 0, body: "" });
    }
  });
}

export async function apiHealthy(port = API_PORT) {
  const r = await httpGet(`http://${API_HOST}:${port}/health`);
  return r.ok && r.status === 200;
}
export async function webServing(port = WEB_PORT) {
  const r = await httpGet(`http://${API_HOST}:${port}/`);
  return r.ok; // any HTTP response means the static server is up
}

/** Poll `predicate` until it resolves truthy or the timeout elapses. */
export async function waitFor(predicate, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/* ------------------------------------------------------------------ *
 * Process lifecycle
 * ------------------------------------------------------------------ */

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM"; // exists but not ours to signal
  }
}

/** Spawn a long-lived background process, detached, with stdio redirected to a log
 *  file. Returns the child pid. The parent can exit while the child keeps running. */
export function spawnDetached(cmd, args, { cwd, env, logFile } = {}) {
  const { command, args: finalArgs } = safeInvocation(cmd, args);
  const out = logFile ? openSync(logFile, "a") : "ignore";
  const child = spawn(command, finalArgs, {
    cwd,
    env,
    detached: true,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", out, out]
  });
  child.unref();
  return child.pid;
}

/** Terminate a managed process (and its child tree) by pid. Idempotent: a missing
 *  process is treated as success. Only the pids we recorded are ever touched. */
export function killManaged(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: true, note: "no pid" };
  if (process.platform === "win32") {
    const res = safeRun("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 10000 });
    // exit 128 / "not found" => already gone => success
    if (res.ok || /not found|no running instance|128/i.test(`${res.stdout}${res.stderr}`)) {
      return { ok: true };
    }
    return { ok: false, note: res.stderr.trim() || `taskkill exit ${res.code}` };
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Small fs helpers + logging
 * ------------------------------------------------------------------ */

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}
export function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}
export function removeIfExists(target) {
  try { rmSync(target, { recursive: true, force: true }); return true; } catch { return false; }
}

const COLORS = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bold: "\x1b[1m" };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (useColor ? `${COLORS[c]}${s}${COLORS.reset}` : s);
export const ui = {
  ok: (s) => console.log(`${paint("green", "OK")}   ${s}`),
  warn: (s) => console.log(`${paint("yellow", "WARN")} ${s}`),
  fail: (s) => console.log(`${paint("red", "FAIL")} ${s}`),
  info: (s) => console.log(`     ${s}`),
  head: (s) => console.log(`\n${paint("bold", s)}`),
  dim: (s) => console.log(paint("dim", s))
};

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
