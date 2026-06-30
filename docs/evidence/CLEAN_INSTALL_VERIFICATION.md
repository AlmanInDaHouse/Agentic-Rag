# Clean-install verification (A10-W.9 / `windows_clean_install` = verified_real_environment)

**Date:** 2026-06-30 · **Host:** Windows 11 Home 10.0.26200 (x64), NTFS · **Tooling:**
Node v24.12.0, pnpm 11.5.0, corepack 0.34.5, Git 2.52.0.

A clean install + the **entire documented PowerShell quick start** was performed from a
**fresh checkout in a separate NTFS path** (`C:\tmp\triforge-ci2`, HEAD `1f0dc7c`), with no
copying of `node_modules`, `.env`, the database, artifacts, credentials, or caches from
the development checkout.

## Full quick start — result

| Step | Command | Result |
|---|---|---|
| 1. Fresh clone | `git clone` to a separate NTFS path | ✅ |
| 2. No dev-checkout dependence | no `node_modules` / `.env` present | ✅ |
| 3. Frozen install | `corepack pnpm install --frozen-lockfile` | ✅ exit 0 |
| 4. Setup | `pnpm triforge:setup` (doctor 0 blockers + dep policy + PostgreSQL reachability + config validation + state dirs + **migrations**) | ✅ exit 0 |
| 5. Start | `pnpm triforge:start` (migrations + **build** of api+web + **backend** `node dist` on :3001 + **frontend** vite preview on :5173, both readiness-probed) | ✅ exit 0 — "TriForge is up" |
| 6. Status | `pnpm triforge:status --check` (PostgreSQL + backend + frontend up; managed pids alive) | ✅ exit 0 |
| 7. Stop | `pnpm triforge:stop` | ✅ both services stopped |
| 8. Clean | `pnpm triforge:clean` | ✅ worktrees pruned, runtime cleared, persistent data preserved |

This was also the **first full end-to-end exercise of `triforge:start`** (build → detached
backend+frontend → PID tracking → readiness → URLs), and of `setup`/`status`/`stop`/`clean`
in sequence.

## Status

`windows_clean_install` = **`verified_real_environment`**. A fresh NTFS checkout completes
the entire operate-from-PowerShell quick start with no dependence on the original checkout;
backend + frontend + native PostgreSQL all come up and are readiness-verified.

**DB note:** the application database was a **native Windows PostgreSQL 18** cluster
provisioned for the verification — a dedicated throwaway cluster (alternate port, trust
auth, isolated data dir), the same engine/host as `windows_native_substrate`; the owner's
existing 5432 service was untouched. A future operator points `DATABASE_URL` at any
reachable Postgres (the default `postgres://triforge:triforge@localhost:5432/triforge`
works once that role/db exists).
