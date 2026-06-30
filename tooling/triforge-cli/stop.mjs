/**
 * `pnpm triforge:stop` — stop the services this CLI started. Idempotent: stopping when
 * nothing is running is a success. Only the pids recorded in the state dir are touched
 * (never an unrelated node process); their child trees are reaped.
 */

import {
  resolveStateRoot, pidsFilePath, readJsonIfExists, parseServicesRecord, killManaged, isAlive,
  removeIfExists, ui
} from "./lib.mjs";

async function main() {
  const stateRoot = resolveStateRoot();
  const pidsFile = pidsFilePath(stateRoot);

  ui.head("TriForge stop");

  const raw = readJsonIfExists(pidsFile);
  const rec = raw ? parseServicesRecord(JSON.stringify(raw)) : null;
  if (!rec || Object.keys(rec.services).length === 0) {
    ui.ok("nothing to stop (no managed services recorded)");
    removeIfExists(pidsFile);
    process.exit(0);
  }

  let allOk = true;
  for (const [label, svc] of Object.entries(rec.services)) {
    if (!isAlive(svc.pid)) {
      ui.ok(`${label} (pid ${svc.pid}) already stopped`);
      continue;
    }
    const res = killManaged(svc.pid);
    if (res.ok) ui.ok(`${label} (pid ${svc.pid}) stopped`);
    else { ui.fail(`${label} (pid ${svc.pid}) could not be stopped: ${res.note}`); allOk = false; }
  }

  if (allOk) removeIfExists(pidsFile);
  ui.head(allOk ? "Stopped" : "Stop INCOMPLETE");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  ui.fail(`stop crashed: ${err?.message ?? err}`);
  process.exit(1);
});
