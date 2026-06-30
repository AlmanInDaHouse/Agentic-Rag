# REQUIRES_VERIFICATION register (A10.9)

Each open verification item is closed as one of: `verified` · `blocked_external`
(owner-only manual prerequisite) · `unsupported` · `unknown`. Mandate §13: **no
1.0-mandatory capability may remain `unknown`** at the final release. Items here are
the durable register; live capability statuses are in
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`.

| # | Item | Status | Evidence / note |
|---|---|---|---|
| 1 | Node/pnpm/Git inside WSL2 | `blocked_external` | git 2.43.0 present; node/pnpm absent. Runbook §1. |
| 2 | Codex installed in WSL2 | `blocked_external` | Present on Windows host only. Runbook §3. |
| 3 | Claude installed in WSL2 | `blocked_external` | Present on Windows host only. Runbook §3. |
| 4 | Auth of both providers | `blocked_external` | Manual owner login/MFA (hard stop). Runbook §4. |
| 5 | Provider event schemas (real) | `blocked_external` | Verified vs mock; real pending auth (A10.5). |
| 6 | Provider usage schemas (real) | `blocked_external` | Real signals pending auth (A10.7). |
| 7 | Provider quota schemas (real) | `blocked_external` | Real signals pending auth (A10.7). |
| 8 | localhost Windows↔WSL2 interop | `unknown` | Per-machine; verified during integrated E2E (A10.8). Not 1.0-mandatory in isolation. |
| 9 | Codex `--sandbox` runtime behaviour (real) | `blocked_external` | Read-only flag documented; writable observed under A10.3/A10.5. |
| 10 | Claude permission/sandbox behaviour (real) | `blocked_external` | Read-only flag documented; writable observed under A10.3/A10.5. |
| 11 | Branch-protection enabled-state + required-check name | `verified` | Required check `Validate`; `Validate` = success on `main` 13ae669 (GitHub check-runs, 2026-06-30). |
| 12 | pnpm 11 dependency build-script policy | `verified` | Repo builds CI-green from a clean `pnpm install --frozen-lockfile`; build-scripts not auto-run for untrusted deps. Tracked R-SEC-10. |
| 13 | OS isolation mechanism (untrusted code) | `unknown→verified_fixture` (A10-2) | A10.2 boundary + invariant matrix; recorded in the isolation ADR. |
| 14 | Writable capability (real) | `blocked_external` | A10.3 adapter is capability-gated; real snapshot pending auth. |
| 15 | Cancellation (real) | `blocked_external` | Mock-verified; real pending auth. |
| 16 | Cleanup (real) | `blocked_external` | Mock/fixture-verified; real pending auth. |
| 17 | Version drift (real) | `blocked_external` | Mock-verified (`versionDrift.test.ts`); real re-probe pending auth. |

**Closure rule:** items 1–7, 9, 10, 14–17 are `blocked_external` on the single owner
action in `docs/runbooks/REAL_PROVIDER_SETUP_WSL2.md`. Items 11, 12 are `verified`. Item
13 becomes `verified_fixture` when A10-2 lands. Item 8 is verified during the integrated
E2E and is not mandatory in isolation. No 1.0-mandatory item is left silently `unknown`.
