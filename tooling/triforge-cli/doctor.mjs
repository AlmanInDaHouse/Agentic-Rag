#!/usr/bin/env node
/**
 * TriForge doctor (A10-W.1, mandate §4) — native Windows operational diagnostic.
 *
 * Verifies the native Windows 11 substrate TriForge runs on, straight from a
 * PowerShell terminal in an integrated IDE (VS Code / Antigravity). No WSL2.
 *
 * Dependency-free: Node built-ins only, so it runs even when workspace builds are
 * broken or before `pnpm -r build`. Run it with:
 *
 *   node tooling/triforge-cli/doctor.mjs           # human-readable
 *   node tooling/triforge-cli/doctor.mjs --json     # machine-readable
 *
 * Safety: this NEVER reads tokens, credential stores, or auth files. It probes
 * only observable CLI state via official, non-interactive status commands, and
 * redacts PII (email / org id) from provider auth output.
 *
 * Each check is classified as one of:
 *   verified_environment | verified_version | requires_manual_auth | unknown | unsupported
 * and carries a severity: ok | warn | block.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const JSON_MODE = process.argv.includes("--json");
const REPO_ROOT = process.cwd();

/* ----------------------------- small utilities ----------------------------- */

/**
 * Resolve a command to a concrete path on Windows, preferring a real executable
 * (`.exe`) over a shim, then `.cmd`/`.bat`. Returns null if not on PATH. This is
 * the deterministic-resolution discipline the safe-command policy (A10-W.5/§10)
 * mandates — never trust a bare name to PATHEXT ambiguity (the `.ps1` npm shim
 * swallows piped stdout; the `.cmd` is the one that works).
 */
function whichWin(name) {
  const r = spawnSync("where", [name], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  if (r.status !== 0 || !r.stdout) return null;
  const paths = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const byExt = (ext) => paths.find((p) => p.toLowerCase().endsWith(ext));
  return byExt(".exe") || byExt(".cmd") || byExt(".bat") || paths[0] || null;
}

/**
 * Run a command capturing stdout/stderr — WITHOUT `shell:true`. Real executables
 * are spawned directly; `.cmd`/`.bat` shims go through `cmd.exe /d /c` with the
 * resolved path passed as a separate argv element (Node quotes it, so paths with
 * spaces survive and there is no string concatenation → no argument-injection
 * class, no DEP0190). Args are fixed literals supplied by this tool only.
 */
function run(cmd, args = [], { timeout = 15_000 } = {}) {
  try {
    let exe = cmd;
    let finalArgs = args;
    if (IS_WINDOWS) {
      const resolved = whichWin(cmd);
      if (!resolved) return { ok: false, code: null, stdout: "", stderr: `${cmd} not found on PATH` };
      if (/\.(cmd|bat)$/i.test(resolved)) {
        // `cmd /d /c <prog> <args>` WITHOUT /s: cmd preserves the quotes Node
        // adds around a program path containing spaces (the documented `cmd /?`
        // rule: exactly two quotes around an executable file name are kept). That
        // invariant requires the args to be space/metachar-free literals — enforce
        // it explicitly so a future caller cannot silently break it into an
        // argument-injection vector.
        if (args.some((a) => /[\s"&<>()@^|%!]/.test(String(a)))) {
          return { ok: false, code: null, stdout: "", stderr: "doctor: refusing cmd-shim args with spaces/metacharacters" };
        }
        exe = process.env.ComSpec || "cmd.exe";
        finalArgs = ["/d", "/c", resolved, ...args];
      } else {
        exe = resolved;
        finalArgs = args;
      }
    }
    const res = spawnSync(exe, finalArgs, { encoding: "utf8", timeout, windowsHide: true, shell: false });
    if (res.error) return { ok: false, code: null, stdout: "", stderr: String(res.error.message ?? res.error) };
    return {
      ok: res.status === 0,
      code: res.status,
      stdout: (res.stdout ?? "").trim(),
      stderr: (res.stderr ?? "").trim()
    };
  } catch (err) {
    return { ok: false, code: null, stdout: "", stderr: String(err?.message ?? err) };
  }
}

/** PowerShell one-liner (Windows only). Returns trimmed stdout or "". */
function ps(script) {
  if (!IS_WINDOWS) return { ok: false, code: null, stdout: "", stderr: "not windows" };
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

/** TCP reachability check (no auth, no password) — resolves a boolean. */
function tcpReachable(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* noop */ }
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

const checks = [];
function record(id, label, status, severity, detail, value = null) {
  checks.push({ id, label, status, severity, detail, value });
}

/* --------------------------------- checks --------------------------------- */

function checkOs() {
  if (!IS_WINDOWS) {
    record("os", "Operating system", "unsupported", "block",
      `process.platform=${process.platform}; the native target is Windows 11 (ADR 0056). POSIX is future/optional.`);
    return;
  }
  const rel = os.release(); // e.g. 10.0.26200
  const build = Number(rel.split(".")[2] ?? 0);
  const detail = `${os.version?.() ?? "Windows"} (${rel}, ${process.arch})`;
  // Windows 11 is build >= 22000.
  if (build >= 22000) record("os", "Operating system", "verified_environment", "ok", detail, { release: rel, arch: process.arch });
  else record("os", "Operating system", "verified_environment", "warn", `${detail} — Windows 11 (build ≥ 22000) recommended`, { release: rel });
}

function checkShell() {
  // Windows PowerShell 5.1 OR pwsh 7 both acceptable.
  const psv = ps("$PSVersionTable.PSVersion.ToString()");
  const pwsh = run("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
  if (pwsh.ok && pwsh.stdout) {
    record("shell", "PowerShell", "verified_version", "ok", `pwsh ${pwsh.stdout}`, { pwsh: pwsh.stdout, windowsPowerShell: psv.stdout || null });
  } else if (psv.ok && psv.stdout) {
    record("shell", "PowerShell", "verified_version", "ok", `Windows PowerShell ${psv.stdout} (pwsh 7 not installed — optional)`, { windowsPowerShell: psv.stdout });
  } else {
    record("shell", "PowerShell", "unknown", "warn", "could not determine PowerShell version");
  }
}

function checkNodeToolchain() {
  const node = process.versions.node;
  const [maj, min] = node.split(".").map(Number);
  const nodeOk = maj > 20 || (maj === 20 && min >= 11);
  if (nodeOk) record("node", "Node.js", "verified_version", "ok", `v${node}`, { version: node });
  else record("node", "Node.js", "verified_version", "block", `v${node} — TriForge requires Node >= 20.11`, { version: node });

  const pnpm = run("pnpm", ["--version"]);
  if (pnpm.ok && pnpm.stdout) record("pnpm", "pnpm", "verified_version", "ok", pnpm.stdout, { version: pnpm.stdout });
  else record("pnpm", "pnpm", "unknown", "block", "pnpm not found — run `corepack enable`");

  const corepack = run("corepack", ["--version"]);
  if (corepack.ok && corepack.stdout) record("corepack", "corepack", "verified_version", "ok", corepack.stdout, { version: corepack.stdout });
  else record("corepack", "corepack", "unknown", "warn", "corepack not found — needed to pin pnpm");

  const git = run("git", ["--version"]);
  if (git.ok && git.stdout) record("git", "Git", "verified_version", "ok", git.stdout.replace(/^git version /, ""), { version: git.stdout });
  else record("git", "Git", "unknown", "block", "Git not found — install Git for Windows");
}

function checkRepo() {
  const gitDir = path.join(REPO_ROOT, ".git");
  if (!existsSync(gitDir)) {
    record("repo", "Repository", "unknown", "warn", `no .git at ${REPO_ROOT} — run the doctor from the repo root`, { root: REPO_ROOT });
    return;
  }
  record("repo", "Repository", "verified_environment", "ok", REPO_ROOT, { root: REPO_ROOT });

  // Filesystem of the repo drive (NTFS expected on Windows).
  if (IS_WINDOWS) {
    const drive = path.parse(REPO_ROOT).root.replace(/\\$/, "").replace(":", "");
    // Only a validated single drive letter is interpolated into the PowerShell
    // -Command script (defense in depth: the script is evaluated as PS code, and
    // a UNC/odd root must never reach it).
    if (!/^[A-Za-z]$/.test(drive)) {
      record("fs", "Filesystem", "unknown", "warn", `non-letter drive root (${path.parse(REPO_ROOT).root}) — UNC or unusual path; filesystem not probed`);
    } else {
      const fsType = ps(`(Get-Volume -DriveLetter ${drive} -ErrorAction SilentlyContinue).FileSystem`);
      const fst = (fsType.stdout || "").trim();
      if (/ntfs/i.test(fst)) record("fs", "Filesystem", "verified_environment", "ok", `${drive}: ${fst}`, { fileSystem: fst });
      else if (fst) record("fs", "Filesystem", "verified_environment", "warn", `${drive}: ${fst} (NTFS recommended)`, { fileSystem: fst });
      else record("fs", "Filesystem", "unknown", "warn", `could not determine filesystem for ${drive}:`);
    }
  }

  // git worktree support
  const wt = run("git", ["-C", REPO_ROOT, "worktree", "list"]);
  if (wt.ok) record("worktree", "git worktree support", "verified_environment", "ok", "worktree subcommand available");
  else record("worktree", "git worktree support", "unknown", "warn", "git worktree unavailable");
}

function checkLongPaths() {
  if (!IS_WINDOWS) return;
  const reg = run("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"]);
  const enabled = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(reg.stdout);
  const gitLong = run("git", ["-C", REPO_ROOT, "config", "--get", "core.longpaths"]);
  const gitLongOn = /true/i.test(gitLong.stdout);
  if (enabled) {
    record("longpaths", "Long path support", "verified_environment", "ok", "HKLM LongPathsEnabled=1");
  } else if (gitLongOn) {
    record("longpaths", "Long path support", "verified_environment", "warn",
      "OS LongPathsEnabled=0 but git core.longpaths=true (git ops mitigated; deep node_modules in worktrees may still hit MAX_PATH)");
  } else {
    record("longpaths", "Long path support", "unknown", "warn",
      "OS LongPathsEnabled=0 and git core.longpaths unset — run `git config core.longpaths true` (no admin); enabling the OS flag needs admin");
  }
}

function checkPostgres(reachable) {
  if (reachable) {
    record("postgres", "PostgreSQL", "verified_environment", "ok", "localhost:5432 reachable (no credentials probed)", { port: 5432 });
  } else {
    record("postgres", "PostgreSQL", "unknown", "block",
      "localhost:5432 not reachable — start a native PostgreSQL service or `pnpm triforge:setup` (no password is read or logged)", { port: 5432 });
  }
  if (IS_WINDOWS) {
    const svc = ps("(Get-Service postgresql* -ErrorAction SilentlyContinue | Select-Object -First 1).Status");
    if (svc.stdout) record("postgres_service", "PostgreSQL service", "verified_environment", svc.stdout.trim() === "Running" ? "ok" : "warn", `service status: ${svc.stdout.trim()}`, { status: svc.stdout.trim() });
  }
}

function classifyCodexAuth() {
  // `codex login status` prints "Logged in using ChatGPT" on success (exit 0).
  const ver = run("codex", ["--version"]);
  if (!ver.ok || !ver.stdout) {
    record("codex", "Codex CLI", "unsupported", "warn", "codex not on PATH (install the official Codex CLI)");
    return;
  }
  record("codex", "Codex CLI", "verified_version", "ok", ver.stdout, { version: ver.stdout });
  const status = run("codex", ["login", "status"]);
  // `codex login status` prints to STDERR (exit 0); inspect both streams.
  const codexStatus = `${status.stdout}\n${status.stderr}`;
  // Detect the NEGATIVE first: "Not logged in" CONTAINS the substring "logged in",
  // so a bare /logged in/ match would be a false-green on the auth signal. Mirror
  // the real adapter's negative-first check; only an affirmative (and not a
  // negative) is recorded as authenticated.
  const codexNotLoggedIn = /not logged in|logged out|login required|please (run|sign)|unauthenticated/i.test(codexStatus);
  const codexLoggedIn =
    !codexNotLoggedIn && (/logged in using/i.test(codexStatus) || (status.ok && /chatgpt/i.test(codexStatus)));
  if (codexLoggedIn) {
    record("codex_auth", "Codex authentication", "verified_environment", "ok", "logged in (observable CLI state; no token read)");
  } else {
    record("codex_auth", "Codex authentication", "requires_manual_auth", "warn",
      "not logged in — run `codex` and complete the official ChatGPT sign-in (manual; never automated)");
  }
}

function classifyClaudeAuth() {
  const ver = run("claude", ["--version"]);
  if (!ver.ok || !ver.stdout) {
    record("claude", "Claude Code CLI", "unsupported", "warn", "claude not on PATH (install Claude Code)");
    return;
  }
  record("claude", "Claude Code CLI", "verified_version", "ok", ver.stdout.replace(/\s*\(Claude Code\)\s*$/, ""), { version: ver.stdout });
  // `claude auth status` emits JSON: { loggedIn, authMethod, subscriptionType, email, orgId, ... }
  const status = run("claude", ["auth", "status"]);
  let parsed = null;
  try { parsed = JSON.parse(status.stdout); } catch { /* not json */ }
  if (parsed && parsed.loggedIn === true) {
    // Redact PII: report method + plan only, never email/orgId.
    const method = String(parsed.authMethod ?? "");
    const plan = String(parsed.subscriptionType ?? "");
    record("claude_auth", "Claude authentication", "verified_environment", "ok",
      `logged in${method ? ` via ${method}` : ""}${plan ? ` (${plan})` : ""}`, { authMethod: method, subscriptionType: plan });
  } else {
    // Trust ONLY the structured `loggedIn === true`. An unparseable or false
    // payload → requires_manual_auth (the safe, no-false-green direction); never
    // infer "logged in" from a loose substring (a logged-out JSON contains
    // other `true` fields).
    record("claude_auth", "Claude authentication", "requires_manual_auth", "warn",
      "not logged in (or status unreadable) — run `claude` and complete the official Anthropic sign-in (manual; never automated)");
  }
}

function canWrite(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function checkStateRoot() {
  const base = IS_WINDOWS ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")) : path.join(os.homedir(), ".triforge");
  const stateRoot = path.join(base, "TriForge");
  let detail;
  let severity = "ok";
  if (existsSync(stateRoot)) {
    // Probe real write access (accessSync W_OK), not mere existence.
    const writable = canWrite(stateRoot);
    if (!writable) severity = "warn";
    detail = `${stateRoot} (exists, ${writable ? "writable" : "NOT writable — fix ACL/permissions"})`;
  } else {
    // Not created yet — the parent must be writable for first-run creation.
    const parentWritable = canWrite(base);
    if (!parentWritable) severity = "warn";
    detail = `${stateRoot} (will be created on first run${parentWritable ? "" : "; parent NOT writable"})`;
  }
  record("state_root", "Writable state root", severity === "ok" ? "verified_environment" : "unknown", severity, detail, { stateRoot });
}

function checkIdeTerminal() {
  const tp = process.env.TERM_PROGRAM ?? "";
  let detail;
  if (/vscode/i.test(tp)) detail = "VS Code integrated terminal";
  else if (process.env.WT_SESSION) detail = "Windows Terminal";
  else if (process.env.ANTIGRAVITY || /antigravity/i.test(tp)) detail = "Antigravity integrated terminal";
  else detail = tp || "standalone console";
  record("ide_terminal", "Terminal", "verified_environment", "ok", detail, { termProgram: tp || null });
}

/* --------------------------------- output --------------------------------- */

const SEV_ICON = { ok: "OK ", warn: "WARN", block: "BLOCK" };

function printHuman() {
  const blockers = checks.filter((c) => c.severity === "block");
  const warnings = checks.filter((c) => c.severity === "warn");
  const line = "─".repeat(72);
  console.log(line);
  console.log("TriForge doctor — native Windows operational diagnostic (A10-W.1)");
  console.log(line);
  for (const c of checks) {
    console.log(`[${SEV_ICON[c.severity].padEnd(5)}] ${c.label.padEnd(26)} ${c.status.padEnd(22)} ${c.detail}`);
  }
  console.log(line);
  console.log(`Checks: ${checks.length}  |  blockers: ${blockers.length}  |  warnings: ${warnings.length}`);
  if (blockers.length) {
    console.log("\nBlockers (must fix before a real run):");
    for (const b of blockers) console.log(`  - ${b.label}: ${b.detail}`);
  }
  if (warnings.length) {
    console.log("\nWarnings (degraded; review):");
    for (const w of warnings) console.log(`  - ${w.label}: ${w.detail}`);
  }
  console.log(line);
  console.log(blockers.length ? "RESULT: NOT READY — resolve the blockers above." : "RESULT: native Windows substrate READY.");
}

async function main() {
  checkOs();
  checkShell();
  checkNodeToolchain();
  checkRepo();
  checkLongPaths();
  const pgReachable = await tcpReachable("127.0.0.1", 5432);
  checkPostgres(pgReachable);
  classifyCodexAuth();
  classifyClaudeAuth();
  checkStateRoot();
  checkIdeTerminal();

  const blockers = checks.filter((c) => c.severity === "block");
  if (JSON_MODE) {
    console.log(JSON.stringify({
      tool: "triforge:doctor",
      schemaVersion: "1.0.0",
      platform: process.platform,
      ready: blockers.length === 0,
      checks
    }, null, 2));
  } else {
    printHuman();
  }
  process.exit(blockers.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("triforge:doctor crashed:", err?.message ?? err);
  process.exit(2);
});
