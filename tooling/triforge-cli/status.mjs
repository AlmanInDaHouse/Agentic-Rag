/**
 * `pnpm triforge:status` — report the operational state: PostgreSQL, backend, frontend,
 * Codex/Claude (version + auth, via the doctor's non-invasive probes), ports, managed
 * run state, and tool versions. Prints NO secrets. `--json` for machine output.
 * Exit 0 always (status is informational), unless `--check` is passed (exit 1 if the
 * integrated product is not fully up).
 */

import path from "node:path";
import {
  REPO_ROOT, resolveStateRoot, pidsFilePath, readJsonIfExists, parseServicesRecord, isAlive,
  safeRun, tcpReachable, apiHealthy, webServing, API_HOST, API_PORT, WEB_PORT, PG_PORT, ui
} from "./lib.mjs";

const JSON_MODE = process.argv.includes("--json");
const CHECK_MODE = process.argv.includes("--check");

async function main() {
  const stateRoot = resolveStateRoot();
  const rec = (() => {
    const raw = readJsonIfExists(pidsFilePath(stateRoot));
    return raw ? parseServicesRecord(JSON.stringify(raw)) : null;
  })();

  const pgUp = await tcpReachable("127.0.0.1", PG_PORT);
  const apiUp = await apiHealthy(API_PORT);
  const webUp = await webServing(WEB_PORT);

  // Provider/version/auth from the doctor (no token reads, PII redacted there).
  const doctor = safeRun("node", [path.join("tooling", "triforge-cli", "doctor.mjs"), "--json"], { cwd: REPO_ROOT, timeout: 90000 });
  let providers = { codex: null, claude: null };
  try {
    const report = JSON.parse(doctor.stdout);
    const find = (id) => report.checks.find((c) => c.id === id);
    providers = {
      codex: { version: find("codex")?.detail ?? "unknown", auth: find("codex_auth")?.detail ?? "unknown" },
      claude: { version: find("claude")?.detail ?? "unknown", auth: find("claude_auth")?.detail ?? "unknown" }
    };
  } catch { /* doctor unavailable */ }

  const managed = rec
    ? Object.fromEntries(Object.entries(rec.services).map(([k, v]) => [k, { pid: v.pid, port: v.port, alive: isAlive(v.pid) }]))
    : {};

  const snapshot = {
    postgres: { reachable: pgUp, port: PG_PORT },
    backend: { up: apiUp, url: `http://${API_HOST}:${API_PORT}/health` },
    frontend: { up: webUp, url: `http://${API_HOST}:${WEB_PORT}/` },
    providers,
    managedServices: managed,
    startedAt: rec?.startedAt ?? null
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    ui.head("TriForge status");
    (pgUp ? ui.ok : ui.fail)(`PostgreSQL    localhost:${PG_PORT} ${pgUp ? "reachable" : "unreachable"}`);
    (apiUp ? ui.ok : ui.warn)(`Backend       ${snapshot.backend.url} ${apiUp ? "up" : "down"}`);
    (webUp ? ui.ok : ui.warn)(`Frontend      ${snapshot.frontend.url} ${webUp ? "up" : "down"}`);
    ui.info(`Codex         ${providers.codex?.version ?? "?"} — ${providers.codex?.auth ?? "?"}`);
    ui.info(`Claude        ${providers.claude?.version ?? "?"} — ${providers.claude?.auth ?? "?"}`);
    if (Object.keys(managed).length > 0) {
      ui.head("Managed services");
      for (const [label, m] of Object.entries(managed)) {
        (m.alive ? ui.ok : ui.warn)(`${label.padEnd(8)} pid ${m.pid} port ${m.port ?? "-"} ${m.alive ? "alive" : "dead"}`);
      }
    } else {
      ui.info("No managed services recorded (use pnpm triforge:start).");
    }
  }

  if (CHECK_MODE) {
    const fullyUp = pgUp && apiUp && webUp;
    process.exit(fullyUp ? 0 : 1);
  }
  process.exit(0);
}

main().catch((err) => {
  ui.fail(`status crashed: ${err?.message ?? err}`);
  process.exit(1);
});
