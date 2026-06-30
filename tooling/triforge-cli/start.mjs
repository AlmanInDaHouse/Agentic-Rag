/**
 * `pnpm triforge:start` — bring up the integrated product (backend + frontend) headless.
 *
 * Idempotent-ish: refuses to start if managed services are already running. Applies
 * pending migrations, builds the workspaces, launches the API (node dist) and the web
 * preview server detached with their stdio captured to log files, records pids/ports to
 * the state dir, waits for readiness, and prints the URLs. Fails cleanly (and tears down
 * anything it started) if a service does not become ready.
 */

import path from "node:path";
import {
  REPO_ROOT, resolveStateRoot, runtimeDir, logDir, pidsFilePath, ensureDir, readJsonIfExists,
  writeJson, parseServicesRecord, buildServicesRecord, safeRun, spawnDetached, killManaged, isAlive,
  apiHealthy, webServing, waitFor, readinessFrom, removeIfExists, API_HOST, API_PORT, WEB_PORT, ui
} from "./lib.mjs";

const SKIP_BUILD = process.argv.includes("--no-build");

async function main() {
  const stateRoot = resolveStateRoot();
  const pidsFile = pidsFilePath(stateRoot);

  ui.head("TriForge start");

  // Refuse to double-start.
  const existingText = readJsonIfExists(pidsFile);
  if (existingText) {
    const rec = parseServicesRecord(JSON.stringify(existingText));
    const live = rec ? Object.values(rec.services).filter((s) => isAlive(s.pid)) : [];
    if (live.length > 0) {
      ui.warn(`already running (${live.map((s) => s.pid).join(", ")}). Use pnpm triforge:stop first.`);
      process.exit(1);
    }
  }

  ensureDir(runtimeDir(stateRoot));
  ensureDir(logDir(stateRoot));

  // 1. Migrations.
  ui.head("1/4 Migrations");
  const migrate = safeRun("corepack", ["pnpm", "--filter", "@triforge/api", "db:migrate"], { cwd: REPO_ROOT, timeout: 120000 });
  if (!migrate.ok) { ui.fail(`migrations failed:\n${(migrate.stdout || migrate.stderr).slice(-1000)}`); process.exit(1); }
  ui.ok("migrations up to date");

  // 2. Build (unless skipped for a fast restart on an unchanged tree).
  if (SKIP_BUILD) {
    ui.head("2/4 Build (skipped: --no-build)");
  } else {
    ui.head("2/4 Build");
    const build = safeRun("corepack", ["pnpm", "build"], { cwd: REPO_ROOT, timeout: 300000 });
    if (!build.ok) { ui.fail(`build failed:\n${(build.stdout || build.stderr).slice(-1500)}`); process.exit(1); }
    ui.ok("workspaces built");
  }

  // 3. Launch backend + frontend (detached).
  ui.head("3/4 Launch services");
  const apiLog = path.join(logDir(stateRoot), "api.log");
  const webLog = path.join(logDir(stateRoot), "web.log");
  const childEnv = { ...process.env, HOST: API_HOST, PORT: String(API_PORT) };

  const apiPid = spawnDetached("node", [path.join("apps", "api", "dist", "index.js")], { cwd: REPO_ROOT, env: childEnv, logFile: apiLog });
  ui.info(`backend  pid ${apiPid} -> ${apiLog}`);

  // Web: vite preview serves apps/web/dist on a strict port.
  const webPid = spawnDetached(
    "corepack",
    ["pnpm", "--filter", "@triforge/web", "exec", "vite", "preview", "--host", API_HOST, "--port", String(WEB_PORT), "--strictPort"],
    { cwd: REPO_ROOT, env: childEnv, logFile: webLog }
  );
  ui.info(`frontend pid ${webPid} -> ${webLog}`);

  const services = {
    api: { pid: apiPid, port: API_PORT, command: "node apps/api/dist/index.js" },
    web: { pid: webPid, port: WEB_PORT, command: "vite preview apps/web/dist" }
  };
  writeJson(pidsFile, buildServicesRecord(services, new Date().toISOString()));

  // 4. Readiness.
  ui.head("4/4 Readiness");
  const apiReady = await waitFor(() => apiHealthy(API_PORT), { timeoutMs: 60000, intervalMs: 1000 });
  const webReady = await waitFor(() => webServing(WEB_PORT), { timeoutMs: 60000, intervalMs: 1000 });
  const readiness = readinessFrom({ api: apiReady, web: webReady });

  if (!readiness.ready) {
    ui.fail(`service(s) not ready: ${readiness.missing.join(", ")} — tearing down`);
    if (!apiReady) ui.dim(`  check ${apiLog}`);
    if (!webReady) ui.dim(`  check ${webLog}`);
    for (const s of Object.values(services)) killManaged(s.pid);
    removeIfExists(pidsFile);
    process.exit(1);
  }

  ui.ok(`backend  ready  http://${API_HOST}:${API_PORT}/health`);
  ui.ok(`frontend ready  http://${API_HOST}:${WEB_PORT}/`);
  ui.head("TriForge is up");
  ui.info(`Open the UI:  http://${API_HOST}:${WEB_PORT}/`);
  ui.info("Stop:        pnpm triforge:stop");
  process.exit(0);
}

main().catch((err) => {
  ui.fail(`start crashed: ${err?.message ?? err}`);
  process.exit(1);
});
