# Clean-install verification (A10-W.9 / `windows_clean_install`)

**Date:** 2026-06-30 · **Host:** Windows 11 Home 10.0.26200 (x64), NTFS · **Tooling:** Node v24.12.0, pnpm 11.5.0, corepack 0.34.5, Git 2.52.0.

A clean install was performed from a **fresh checkout in a separate NTFS path**
(`C:\tmp\triforge-cleaninstall`), with no copying of `node_modules`, `.env`, the
database, artifacts, credentials, or caches from the development checkout.

## Steps run + result

| Step | Command | Result |
|---|---|---|
| 1. Fresh clone | `git clone --depth 1 …/Agentic-Rag.git` (HEAD `32f7b17`) | ✅ |
| 2. No dev-checkout dependence | assert no `node_modules` / `.env` present | ✅ (both absent) |
| 3. Frozen install | `corepack pnpm install --frozen-lockfile` | ✅ exit 0 |
| 4. Doctor | `pnpm triforge:doctor` | ✅ 18 checks, **0 blockers**, 1 warn (long-paths) — "native Windows substrate READY" |
| 5. Build | `corepack pnpm build` | ✅ exit 0 (`@triforge/api` + `@triforge/web`) |

## Status

`windows_clean_install` is **partially verified** on the real Windows host: the
checkout → frozen install → doctor → build path is reproducible from a clean NTFS
location with no dependence on the original checkout.

The remaining steps of the documented quick start — `pnpm triforge:setup` (migrations)
and `pnpm triforge:start` (backend + frontend) — additionally require a reachable
**application database**. On this host the default `triforge` Postgres role is not yet
provisioned (PostgreSQL 18 is running and SCRAM-authenticated; the role/db creation is a
one-time owner action). Until that is done, the cap stays **`unknown`** in the evidence
registry rather than `verified_real_environment` (no false green): the install/build/
doctor evidence above is recorded, but the full operate-from-PowerShell flow is not yet
closed.

**To close:** provision the local DB (one owner action — see
`docs/context/TRIFORGE_EXECUTION_STATE.md` § blockers), then re-run
`pnpm triforge:setup && pnpm triforge:start && pnpm triforge:status` from the fresh
checkout and flip `windows_clean_install` to `verified_real_environment` with the run log
as evidence.
