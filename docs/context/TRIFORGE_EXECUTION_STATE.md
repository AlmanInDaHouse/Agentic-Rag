# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-30 (Loop 33 — A8.8 / A8 CLOSED, on branch `feat/a8-8-recovery-ui`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A8.7 — Budget & Quota (`ef42e04`, PR #65; ADR 0052 arch) |
| Active milestone | **A8.8 — Recovery UI** (this PR; `apps/web` recovery view-model + panel) → **A8 COMPLETE** |
| `main` SHA | `ef42e04` |
| Last `main` CI | `Validate` ✅ success (`ef42e04`) |
| Open PRs | A8.8 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is legacy 1.x, out of the A1–A9 roadmap, not blocking — still to be classified in a low-priority loop. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A9.1 — Failure & Chaos testing** (`apps/api`), mandate §11. Simulate the failure surface (provider crash, malformed/duplicate events, sequence gaps, auth expiry, quota exhaustion, rate limit, timeout, ignored cancellation, orphan process, disk full, output flood, corrupted artifact, worktree failure, stale worktree, git conflict, test hang, runtime restart, unknown CLI version, unsupported capability) and assert the runtime detects/bounds/recovers without a false-green narrative. Reuse the A5 components + the A2 mock scenario engine. Then A9.2 security acceptance tests (A0.5), A9.3 version drift, A9.4 recovery, A9.5 observability, A9.6 packaging, A9.7 docs, A9.8 RC cases, A9.9 release gate → TriForge 1.0 DoD. |

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
- A5 Controlled writable execution (MVP) — **active**, split A5.1–A5.10 (spec `WRITABLE_EXECUTION_SPEC.md`):
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
- A6 Routing and learning — **active**:
  - A6.1 Task Profiler — **merged** (`dd2894e`; PR #52; ADR 0045)
  - A6.2 Static capability router — **merged** (`73a8ce2`; PR #53; ADR 0046)
  - A6.3 Quota-aware router — **merged** (`8813d87`; PR #54; ADR 0047)
  - A6.4 Execution metrics — **merged** (`e1b9f90`; PR #55; ADR 0048)
  - A6.5 Repository-specific profiles — **merged** (`77d020c`; PR #56; ADR 0049)
  - A6.6 Protected adaptive router — **merged** (`47c5e36`; PR #57; ADR 0050)
- **A6 — COMPLETE** (`47c5e36`; profiler + static + quota-aware + metrics + repo profiles + protected adaptive)
- A7 Competitive mode — **A7.1 merged** (`0610c54`; PR #58; ADR 0051)
- A8 Product Interface (UI) — A8.1–A8.7 merged (`ef42e04`); **A8.8 active** (this PR; ADR 0052) → A8 COMPLETE
- A9 Hardening and release candidate — pending

## UNKNOWN

- Whether Node/pnpm/Git/Codex CLI/Claude Code are installed and authenticated
  inside the Ubuntu WSL2 distro (distro not started; A0.4 spec §5).
- The concrete OS-isolation mechanism for untrusted provider/repo code on WSL2
  (requirement recorded; design deferred to A4/A5; threat-model §14, RR-4).

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
| Loops executed | …A8.4 (29); A8.5 (30); A8.6 (31); A8.7 (32); A8.8 (33) active=A8 done |
| PRs created | +27 this session (TD-1 #40 … A8.7 #65, A8.8 this); 35 total since A0.4 |
| PRs merged | 34 (…#63 A8.5, #64 A8.6, #65 A8.7) |
| CI failures | 1 (A5.3 first run: cross-platform binName — caught + fixed; re-run green) |
| Repair rounds | 11 (A5.9: 1 — E2E surfaced + fixed an A5.5 new-dir reconcile bug, fail-closed) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | A5.4–A5.8: 0; A5.9: 1 major (self-found integration bug in A5.5, fixed + regression test) |
| Time-to-merge | same session per loop |
| Diff size | A8.8: web recovery lib+test + RecoveryPanel.tsx + dashboard wire + PRODUCT_INTERFACE_SPEC §A8.8 + A8 closure |
| Coverage | api ~660; web suite +6 recovery tests → 46 web tests (8 A8 panels) (CI runs `@triforge/web test`) |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 34 — A9.1 Failure & Chaos testing (mandate §11 A9.1). Branch off main AFTER A8.8
merges. Build a chaos/failure test suite (apps/api) that simulates the mandate's failure
surface and asserts the runtime DETECTS / BOUNDS / RECOVERS (no false-green): provider
crash, malformed events, duplicate events, sequence gaps, auth expiry, quota exhaustion,
rate limit, timeout, ignored cancellation, orphan process, disk full, output flood,
corrupted artifact, worktree failure, stale worktree, git conflict, test hang, runtime
restart, unknown CLI version, unsupported capability. Reuse the A2 mock scenario engine +
the A5 components (worktree/command supervisor/ledger/gates/repair/governance) + A6 quota.
Deterministic where possible; real-process chaos guarded (POSIX). Each chaos case asserts
a bounded, recorded outcome, not a crash or a fabricated success.
  Tests: malformed/duplicate/sequence-gap events flagged (not silently accepted); an
  ignored cancellation still terminates via the group kill; a corrupted ledger chain is
  rejected; a stale worktree is recovered; quota exhaustion hard-stops.
Loop shape unchanged. Then A9.2 security acceptance tests (A0.5 threat model), A9.3
version drift, A9.4 recovery, A9.5 observability, A9.6 packaging/installation, A9.7 docs,
A9.8 release-candidate cases, A9.9 release gate → TriForge 1.0 Definition of Done.
```
