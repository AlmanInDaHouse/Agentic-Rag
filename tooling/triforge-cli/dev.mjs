/**
 * `pnpm triforge:dev` — developer foreground mode. Runs the doctor (warn-only: a
 * blocker still stops, but warnings do not), then hands off to the existing parallel
 * watch dev servers (tsx watch + vite). This is the iterate-on-code path; for a headless
 * operated instance with managed pids use `pnpm triforge:start`.
 *
 * It does NOT detach: Ctrl+C stops both watchers (their own SIGINT handling).
 */

import path from "node:path";
import { spawn } from "node:child_process";
import { REPO_ROOT, safeRun, safeInvocation, ui } from "./lib.mjs";

ui.head("TriForge dev");

const doctor = safeRun("node", [path.join("tooling", "triforge-cli", "doctor.mjs"), "--json"], { cwd: REPO_ROOT, timeout: 90000 });
let blockers = [];
try {
  const report = JSON.parse(doctor.stdout);
  blockers = report.checks.filter((c) => c.severity === "block");
} catch { /* doctor unavailable — continue (dev is best-effort) */ }

if (blockers.length > 0) {
  for (const b of blockers) ui.fail(`doctor blocker: ${b.label} — ${b.detail}`);
  ui.fail("resolve blockers before dev");
  process.exit(1);
}
ui.ok("doctor: no blockers — starting watch servers (Ctrl+C to stop)");

const { command, args } = safeInvocation("corepack", ["pnpm", "dev"]);
const child = spawn(command, args, { cwd: REPO_ROOT, stdio: "inherit", shell: false });
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => { try { child.kill("SIGINT"); } catch { /* ignore */ } });
