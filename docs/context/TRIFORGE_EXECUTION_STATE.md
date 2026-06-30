# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-30 (Loop 46 — **A10-W.3 Windows Worktree Manager (NTFS)**: `defaultStateRoot`=`%LOCALAPPDATA%\TriForge`, case-insensitive junction-escape containment, `core.longpaths=true` on win32; real Git for Windows + `mklink /J` host tests; `windows_worktree_manager`=`verified_real_environment`; on branch `feat/a10w-3-windows-worktree-manager`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A10-W.2 (`66e3faf`, PR #82) → Windows path security policy merged |
| Active milestone | **A10-W — Native Windows Operational Closure** (ADR 0056). A10-W.1–W.2 merged; A10-W.3 in flight; A10-W.4–W.9 queued. |
| `main` SHA | `66e3faf` |
| Last `main` CI | `Validate` ✅ success (`66e3faf`) |
| Open PRs | A10-W.3 (this branch). |
| Blockers | none internal; **no external blocker** — both providers are installed AND authenticated natively on Windows (the prior WSL2 manual-login hard stop is satisfied). Native-Windows verification is engineering (A10-W.2–W.9). |
| Pending decisions | none |
| Next loop | **A10-W is the active roadmap.** A1–A9 is a release candidate; the FINAL operational 1.0 is gated on native-Windows verification (`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`, `finalReleaseGate.test.ts`). Mandatory `windows_*` capabilities must reach `verified_real_environment` / `verified_real_provider`. No `v1.0.0` tag until the final gate reports ready. Substrate verified on the real host via `pnpm triforge:doctor` (18 checks, 0 blockers). |

## Follow-ups / tech debt

- **TD-1 — RESOLVED** (`9d1dca2`, PR #40): `Clock`/`ManualClock` extracted to the
  neutral `apps/api/src/providers/clock.ts`; all importers (mock/quota/real + tests)
  re-pointed. Product code no longer depends on the `mock/` tree.
- **TD-2 — RESOLVED** (`afc3607`, PR #41): `request_rejected` added to the A1 error
  taxonomy (additive → contract `1.1.0`); the three A3 adapter refusals re-pointed off
  `provider_unavailable`.
- **TD-3 (new, from A5.1 review — deferred to A5.2/A5.3):** the worktree manager
  applies only a baseline path containment for its OWN state paths. The full
  allowed-path policy (block every worktree's `.git`/`.git/objects`, sibling
  worktrees, the state root, `$HOME`, `/mnt/c`; full normalize→realpath→containment→
  symlink/hardlink/TOCTOU on owner read/write paths) is A5.2/A5.3. `.gitattributes`
  smudge-filter neutralization on managed checkout is A5.4.

## Autonomy rule (Charter §2 / §3.2 correction, 2026-06-29)

> A pending **external** action that does not technically block the next milestone
> does **not** halt the autonomous loop. Register the risk, isolate the affected
> action, continue with safe work; stop only on a real hard stop; persist state
> before the context/session limit. (Triggered by the R-SEC-2 PAT-rotation pause,
> which was a compliance defect: PAT rotation is the owner's external action and
> does not block A2 — Git auth via GCM is unaffected. R-SEC-2 stays open as an
> external pending risk; the loop continues.)

## Milestone ladder (mandate / instrucciones.md §9 initial state + §13–§21 A1–A9)

- A0.1 Quota-aware orchestration — **merged**
- A0.2 Canonical project vision — **merged**
- A0.3 Official CLI integration + local auth — **merged**
- A0.4 WSL2-first execution substrate — **merged** (`36f84dc`)
- Governance Transition (Autonomous Loop Governance) — **merged** (`8d8ee00`)
- A0.5 Provider and repository threat model — **merged** (`e09c4d3`; ADR 0032)
- A1 Provider contracts — **merged** (`5cf7728`; PR #34; ADR 0033)
- A2 Mocks, harness, quota manager — **merged** (A2.1 `98b7c42` #35, A2.2 `ede0d55` #36, A2.3 `2ffa6fb` #37)
- A3 Real read-only adapters — **merged** (`9d5dac4`; PR #38; ADR 0034)
- A4 Collaboration runtime — **merged** (`cc57793`; PR #39; ADR 0035) → A1–A4 complete
- TD-1 Clock extraction — **merged** (`9d1dca2`; PR #40)
- TD-2 `request_rejected` error code — **merged** (`afc3607`; PR #41)
- A5 Controlled writable execution (MVP) — **COMPLETE**, split A5.1–A5.10 (spec `WRITABLE_EXECUTION_SPEC.md`):
  - A5.1 Worktree Manager — **merged** (`909d54c`; PR #42; ADR 0036)
  - A5.2 Allowed-Path Policy — **merged** (`67d5956`; PR #43; ADR 0037)
  - A5.3 Safe Command Policy + Process Supervision — **merged** (`cafca30`; PR #44; ADR 0038)
  - A5.4 Owner/Reviewer enforcement — **merged** (`f2784b4`; PR #45; ADR 0039)
  - A5.5 Diff Capture + Mutation Ledger — **merged** (`31446da`; PR #46; ADR 0040)
  - A5.6 Quality Gate Runner — **merged** (`a604336`; PR #47; ADR 0041)
  - A5.7 Repair Loop — **merged** (`ea36465`; PR #48; ADR 0042)
  - A5.8 Autonomous Governance Decision — **merged** (`3f128bc`; PR #49; ADR 0043)
  - A5.9 Writable E2E (mock-first) — **merged / FUNCTIONAL MVP** (`b041a12`; PR #50; ADR 0044)
  - A5.10 Low-risk real provider pilot — **BLOCKED (documented)**: writable capability not safely verifiable (WSL2 stopped; auth UNKNOWN; A3 adapter read-only). Does not block A6–A9.
- **A5 — functionally COMPLETE** (MVP demonstrated via mocks; real pilot blocked-and-documented)
- A6 Routing and learning — **COMPLETE**:
  - A6.1 Task Profiler — **merged** (`dd2894e`; PR #52; ADR 0045)
  - A6.2 Static capability router — **merged** (`73a8ce2`; PR #53; ADR 0046)
  - A6.3 Quota-aware router — **merged** (`8813d87`; PR #54; ADR 0047)
  - A6.4 Execution metrics — **merged** (`e1b9f90`; PR #55; ADR 0048)
  - A6.5 Repository-specific profiles — **merged** (`77d020c`; PR #56; ADR 0049)
  - A6.6 Protected adaptive router — **merged** (`47c5e36`; PR #57; ADR 0050)
- **A6 — COMPLETE** (`47c5e36`; profiler + static + quota-aware + metrics + repo profiles + protected adaptive)
- A7 Competitive mode — **A7.1 merged** (`0610c54`; PR #58; ADR 0051)
- **A8 — COMPLETE** (`d99b850`; 8 panels A8.1–A8.8: provider status, task composer, run timeline, artifact explorer, diff/review, governance, budget/quota, recovery; ADR 0052; 46 web tests)
- **A9 — COMPLETE** (`13ae669`; PR #75; ADR 0053; chaos/SAT/drift/recovery/observability/packaging/docs/RC/release-gate) → **A1–A9 roadmap Definition of Done MET (release candidate)**
- **A10 — Real Provider Operational Closure (WSL2-framed) — SUBSTRATE COMPLETE; superseded by A10-W (ADR 0056)** (spec `REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md`; ADR 0054):
  - A10-1 Evidence model + honest evidence-based release gate — **this PR** (`TRIFORGE_CAPABILITY_EVIDENCE.json`, `evidence.ts`, `releaseGate.test.ts`, `finalReleaseGate.test.ts`, REQUIRES_VERIFICATION register, owner runbook)
  - A10-2 Real isolation boundary + 13-invariant matrix + ADR 0055 — **this PR** (`execution/isolation/`, `isolation.invariants.test.ts`; closes T-FS-05 .gitattributes filters; `os_isolation_boundary_verified`=verified_fixture)
  - A10-3 Writable provider adapters (capability-gated) — **this PR** (`writableProfile.ts`; codex `workspace-write` / claude `acceptEdits` profiles refuse unless observed write=yes + binding + version + worktree cwd; `writableAdapter.test.ts`; read-only default unchanged)
  - A10-4 Writable adapter conformance harness — **this PR** (`writableConformance.test.ts`: both real adapters through the harness under writable runs across the failure surface; `writable_adapter_conformance_harness`=verified_fixture)
  - A10.5–A10.8 Real pilots / modes / quota / integrated E2E — **re-homed to native Windows under A10-W** (no longer WSL2 `blocked_external`)
  - A10-10 Resolve PR #26 — **merged** (superseded → closed, history preserved; `PR_26_RESOLUTION.md`; `pr_26_resolved`=verified; compatibility matrix; `requires_verification_closed`=verified)
  - A10-11 Honest release gate — delivered in A10-1
  - **A10 AUTONOMOUS SUBSTRATE COMPLETE** (A10-1…A10-4, A10-10, A10-11; `619f02c`, PRs #76–#80).
- **A10-W — Native Windows Operational Closure — ACTIVE** (ADR 0056 supersedes the WSL2-first mandate; spec `NATIVE_WINDOWS_OPERATIONAL_CLOSURE_SPEC.md`):
  - A10-W.1 Governance + `ExecutionPlatform` boundary + evidence-model extension (`verified_real_environment`/`requiresRealEnvironment`) + 14 native-Windows-final capabilities + `pnpm triforge:doctor` — **merged** (`fcfb1e7`, PR #81)
  - A10-W.2 Windows path security policy (`validateContainedPath` + `PathPolicyEngine` Windows hardening; canonical-identity containment, namespaces/ADS/reserved-names/trailing/junction-escape; real-NTFS host tests) → `windows_path_policy`=`verified_real_environment` — **merged** (`66e3faf`, PR #82)
  - A10-W.3 Windows Worktree Manager (NTFS state root `%LOCALAPPDATA%\TriForge`, case-insensitive junction-escape containment, `core.longpaths`, never-main, crash recovery; real Git for Windows + `mklink /J` host tests) → `windows_worktree_manager`=`verified_real_environment` — **this PR**
  - A10-W.4–W.9 Job Object supervisor / isolation + safe command policy / real adapters / real pilots / integrated E2E / packaging + security review + release — **queued**
  - **No external blocker:** Codex 0.101.0 and Claude 2.1.195 are installed AND authenticated **natively on Windows** (`pnpm triforge:doctor`, 2026-06-30); the prior WSL2 manual-login hard stop is satisfied. Remaining work is engineering.
  - **Final operational 1.0 / `v1.0.0`: PENDING native-Windows verification** (`verified_real_environment` / `verified_real_provider` for the mandatory `windows_*` set)

## UNKNOWN

- **Resolved (ADR 0056):** Codex CLI and Claude Code are **authenticated natively on
  Windows** (`codex login status` / `claude auth status`, 2026-06-30 via
  `pnpm triforge:doctor`) — the prior "authenticated inside WSL2" hard stop no longer
  applies. The repo runs on NTFS (no `/mnt/c` requirement).
- The native-Windows OS-isolation effectiveness (ACL / restricted token / Job Object) is
  honest-residual-risk, verified on a real Windows host across A10-W.2–W.5 (not inferred
  from the Linux CI).

> **A10.9 register:** the structured closure of every REQUIRES_VERIFICATION item
> (verified / blocked_external / unsupported / unknown) is
> `docs/evidence/REQUIRES_VERIFICATION_REGISTER.md`; live capability statuses are in
> `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`.

## REQUIRES_VERIFICATION

- **A5.10 real writable pilot (BLOCKED).** Safe probe (2026-06-29, no creds read):
  `codex-cli 0.101.0` + `claude` present on the *Windows host*, but the WSL2 Ubuntu
  substrate is **Stopped**, provider **auth is UNKNOWN** (not probed — would risk
  credential interaction), and the A3 adapter is **read-only** (no writable provider
  adapter). To unblock: start WSL2 + install the toolchain there (A0.4 §5), manually
  authenticate the CLIs (owner action), observe+snapshot the *writable* capability,
  then build a separately-bound writable provider adapter. Until then the pilot stays
  blocked; the MVP stands via the mock owner (A5.9).
- Provider event/usage/quota schemas against installed CLI versions (Vision §12,
  §17; quota spec assumptions, 2026-06-28).
- `localhost` Windows↔WSL2 interop per machine/config (A0.4 spec §8.6).
- Codex `--sandbox` runtime behavior against the installed version (A0.4 spec §8.8;
  threat-model T-CMP-01/02).
- Branch-protection enabled-state and required-check name (asserted in docs only;
  threat-model T-INT-08, R-SEC-7).
- pnpm 11 default dependency-build-script blocking without an `.npmrc`
  (threat-model T-GIT-05/08, R-SEC-10).

## Experiment metrics (running counters)

| Metric | Value |
|---|---|
| Loops executed | …A9.5 (38); A9.6 (39); A9.7 (40); A9.8 (41); A9.9 (42)=ROADMAP COMPLETE |
| PRs created | +36 this session (TD-1 #40 … A9.8 #74, A9.9 this); 44 total since A0.4 |
| PRs merged | 43 (…#72 A9.6, #73 A9.7, #74 A9.8); A9.9 = the 36th of this session on merge |
| CI failures | 1 (A5.3 first run: cross-platform binName — caught + fixed; re-run green) |
| Repair rounds | 11 (A5.9: 1 — E2E surfaced + fixed an A5.5 new-dir reconcile bug, fail-closed) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | A5.4–A5.8: 0; A5.9: 1 major (self-found integration bug in A5.5, fixed + regression test) |
| Time-to-merge | same session per loop |
| Diff size | A9.9: docs/RELEASE_NOTES_1.0.md + apps/api releaseGate.test.ts (3) + HARDENING_SPEC §A9.9 + A9 closure |
| Coverage | api ~716 +3 A9.9 = ~719 (49 api test files); web 46 (8 A8 panels); clean `pnpm -r build` verified; full gate green on CI |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
ROADMAP COMPLETE — TriForge 1.0 Definition of Done MET (Loop 42, A9.9 release gate).
A1-A9 delivered with executable evidence: A1 contracts, A2 mocks/harness/quota, A3
read-only adapters, A4 collaboration, A5 writable MVP (real writes only in isolated
worktrees; mock-first E2E), A6 honest routing+learning, A7 competitive mode, A8 product UI
(8 panels), A9 hardening (chaos/SAT/drift/recovery/observability/packaging/docs/RC) +
release gate. main always green; release gate green on CI; no open blockers/criticals;
every writable capability bound (A0.5 6-field closure). DoD declaration + evidence map:
docs/RELEASE_NOTES_1.0.md (asserted by releaseGate.test.ts).
Maintenance-only / external non-blocking (registered, NOT roadmap loops):
  - A5.10 real provider pilot — gated until a writable provider capability is observed
    (WSL2 substrate + authenticated CLIs; the MVP stands via mocks).
  - PR #26 — legacy 1.x Code Graph ingestion, out of the A1-A9 roadmap; classify, do not
    merge blindly.
  - R-SEC-2 — the owner's external PAT rotation (Git auth via the credential manager is
    unaffected).
If a future session resumes: reconstruct from Git + the 4 canonical docs; the roadmap is
done — only the external items above remain, and only on the owner's action.
```
