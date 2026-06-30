/**
 * `pnpm triforge:setup` — one-time, non-interactive local preparation.
 *
 * Runs the doctor (blocks on blockers), enforces the dependency policy, checks
 * PostgreSQL reachability, validates configuration, creates the writable state
 * directories, and applies database migrations. It NEVER logs into a provider and
 * NEVER reads tokens or secrets. Exit 0 on success, 1 on any blocking failure.
 */

import path from "node:path";
import {
  REPO_ROOT,
  resolveStateRoot,
  runtimeDir,
  logDir,
  ensureDir,
  safeRun,
  tcpReachable,
  PG_PORT,
  ui
} from "./lib.mjs";

async function main() {
  const stateRoot = resolveStateRoot();
  let blocked = false;

  ui.head("TriForge setup");

  // 1. Doctor — authoritative substrate gate.
  ui.head("1/6 Environment doctor");
  const doctor = safeRun("node", [path.join("tooling", "triforge-cli", "doctor.mjs"), "--json"], {
    cwd: REPO_ROOT,
    timeout: 90000
  });
  let doctorReport = null;
  try { doctorReport = JSON.parse(doctor.stdout); } catch { /* not json */ }
  if (!doctorReport) {
    ui.fail("doctor did not produce a report");
    blocked = true;
  } else {
    const blockers = doctorReport.checks.filter((c) => c.severity === "block");
    if (blockers.length === 0) {
      ui.ok(`doctor: ${doctorReport.checks.length} checks, 0 blockers`);
    } else {
      for (const b of blockers) ui.fail(`doctor blocker: ${b.label} — ${b.detail}`);
      blocked = true;
    }
  }

  // 2. Dependency policy.
  ui.head("2/6 Dependency policy");
  const deps = safeRun("node", [path.join("scripts", "check-dependencies.mjs")], { cwd: REPO_ROOT, timeout: 30000 });
  if (deps.ok) ui.ok("dependency policy clean");
  else { ui.fail(`dependency policy violations:\n${deps.stdout || deps.stderr}`); blocked = true; }

  // 3. PostgreSQL reachability (no credentials probed).
  ui.head("3/6 PostgreSQL");
  if (await tcpReachable("127.0.0.1", PG_PORT)) ui.ok(`localhost:${PG_PORT} reachable (no credentials probed)`);
  else { ui.fail(`localhost:${PG_PORT} not reachable — start PostgreSQL before setup`); blocked = true; }

  // 4. Configuration validation (no secret values printed).
  ui.head("4/6 Configuration");
  const dbUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";
  try {
    const u = new URL(dbUrl);
    ui.ok(`DATABASE_URL valid (host ${u.hostname}:${u.port || "5432"}, db ${u.pathname.slice(1) || "triforge"})`);
  } catch {
    ui.fail("DATABASE_URL is not a valid URL");
    blocked = true;
  }

  // 5. Writable state directories.
  ui.head("5/6 State directories");
  for (const dir of [stateRoot, runtimeDir(stateRoot), logDir(stateRoot), path.join(stateRoot, "ledgers"), path.join(stateRoot, "worktrees")]) {
    ensureDir(dir);
  }
  ui.ok(`state root prepared at ${stateRoot}`);

  // 6. Migrations (only if the substrate is healthy).
  ui.head("6/6 Database migrations");
  if (blocked) {
    ui.warn("skipped migrations — resolve the blockers above first");
  } else {
    const migrate = safeRun("corepack", ["pnpm", "--filter", "@triforge/api", "db:migrate"], {
      cwd: REPO_ROOT,
      timeout: 120000
    });
    if (migrate.ok) ui.ok("migrations applied");
    else { ui.fail(`migrations failed:\n${(migrate.stdout || migrate.stderr).slice(-1200)}`); blocked = true; }
  }

  ui.head(blocked ? "Setup INCOMPLETE" : "Setup complete");
  if (!blocked) {
    ui.info("Next: pnpm triforge:start   (then open the printed UI URL)");
  }
  process.exit(blocked ? 1 : 0);
}

main().catch((err) => {
  ui.fail(`setup crashed: ${err?.message ?? err}`);
  process.exit(1);
});
