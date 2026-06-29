# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 6, on branch `feat/a4-collaboration-runtime`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A3 — Real read-only adapters (`9d5dac4`, PR #38) |
| Active milestone | A4 — Collaboration runtime (this PR) → completes A1–A4 |
| `main` SHA | `9d5dac4` |
| Last `main` CI | `Validate` ✅ success (`9d5dac4`) |
| Open PRs | A4 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is from the legacy 1.x line, out of the A1–A9 roadmap, not blocking — left as-is. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A5 — Controlled Writable Execution (MVP)** — UNLOCKED once A4 merges (gate A0.5 + A1–A4 satisfied). First milestone with REAL repository writes; gated per the A0.5 capability-binding rule. |

## Follow-ups / tech debt

- **TD-1 (from A2.3 review F5):** the deterministic `Clock`/`ManualClock` primitive lives
  in `apps/api/src/providers/mock/clock.ts` and is imported by the product `quota/`
  manager and the `harness/` (which also imports `deriveProviderResult` from `mock/`).
  A product/domain component depending on the `mock/` (test-double) tree is a layering
  smell. Extract `Clock`/`ManualClock` to a neutral `apps/api/src/providers/clock.ts`
  (and a stream→result util out of `mock/`) and re-point `mock`/`harness`/`quota`. Low
  effort, non-blocking; do before deeper runtime wiring.
- **TD-2 (from A3 review):** the A1 error taxonomy has no `request_rejected`/`unauthorized`
  code, so the A3 adapters' refusals (writable `readOnly:false`; hyphen-leading
  objective/arg) reuse `provider_unavailable` with the distinction carried in the
  message. Add a precise code to the taxonomy (additive → schema-version bump) in a
  later contract revision and re-point the refusals.

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
- A4 Collaboration runtime — **active** (this PR; ADR 0035) → completes A1–A4
- A5 Controlled writable execution (MVP) — **next / UNLOCKED** (gate A0.4+Gov+A0.5+A1–A4 satisfied once A4 merges)
- A6 Routing and learning — pending
- A7 Competitive mode — pending (not required for MVP)
- A8 Product interface — pending
- A9 Hardening and release — pending

## UNKNOWN

- Whether Node/pnpm/Git/Codex CLI/Claude Code are installed and authenticated
  inside the Ubuntu WSL2 distro (distro not started; A0.4 spec §5).
- The concrete OS-isolation mechanism for untrusted provider/repo code on WSL2
  (requirement recorded; design deferred to A4/A5; threat-model §14, RR-4).

## REQUIRES_VERIFICATION

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
| Loops executed | Loops 0–4 complete (A0.4, Gov, A0.5, A1, A2); Loop 5 (A3) active |
| PRs created | 7 this run (Gov, A0.5, A1, A2.1, A2.2, A2.3, A3); PR #31 pre-existed |
| PRs merged | 8 (#31 A0.4, #32 Gov, #33 A0.5, #34 A1, #35 A2.1, #36 A2.2, #37 A2.3, #38 A3) |
| CI failures | 0 |
| Repair rounds | 8 (Gov, A0.5, A1, A2.1, A2.2, A2.3, A3, A4 reviews) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | Gov: 2 crit/2 maj/6 min/4 obs. A0.5: 0/0/0/~3 min/~7 obs. A1: 0/0/0/~3 min/~3 obs — all resolved pre-merge |
| Time-to-merge | Loops 0–3: same session |
| Diff size | A0.4/Gov/A0.5 docs; A1: 11 files (~1900 LoC, contracts+51 tests) |
| Coverage | provider+orchestration suite 379 tests (51 contracts + 108 mock/engine + 91 harness + 46 quota + 50 real + 33 collaboration), pure/no-DB; full api suite ~513 |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 7 — A5 Controlled Writable Execution (MVP) (mandate §17). UNLOCKED: A0.4 + Gov
+ A0.5 + A1–A4 are closed. This is the FIRST milestone with REAL repository writes —
the highest-risk milestone; split into reviewable sub-PRs, each keeping main green.
Bind EVERY writable capability to the A0.5 closure rule (threat-model §11:
{threat,control,milestone,verification,recovery,residual risk}) BEFORE enabling it.
Sub-pieces (mandate §A5.1–§A5.10), suggested order:
  A5.1 Worktree Manager (create/branch/ownership/lifecycle/cleanup/stale-detection/
       recovery/disk-limits/crash-recovery/auditability; NEVER work on main directly).
  A5.2 Owner/reviewer enforcement (owner writes only authorized paths; reviewer
       read-only, produces findings, modifies nothing).
  A5.3 Allowed-paths (readPaths/writePaths/blockedPaths/maxFilesChanged; normalize→
       realpath→containment→symlink/hardlink/TOCTOU; .git/home/external/secrets blocked).
  A5.4 Safe Command Policy (categories; shell disabled by default; explicit binary+argv+
       cwd+env-allowlist+timeout+output-limits+process-ownership).
  A5.5 Process supervision (cancel→stop→SIGTERM group→grace→SIGKILL→partial evidence→
       single terminal) — reuse the A3 NodeProcessRunner process-group model.
  A5.6 Mutation ledger (files created/modified/deleted, before/after hashes, commands,
       timestamps, owner, diff, tests, reasons).
  A5.7 Quality Gate Runner (unit/integration/e2e/typecheck/lint/build/deps/security/
       code-graph/custom) — wraps the existing gates.
  A5.8 Repair loop (implement→gates→findings→repair→gates) with round/quota/walltime/
       output/failure-threshold limits.
  A5.9 Autonomous integration gate — produce a GovernanceDecision (A1 contract) with
       the capability binding; replaces the old human commit gate (ADR 0031).
  A5.10 Writable E2E on a FIXTURE repo: create worktree→implement→tests→review→repair→
       governance decision→commit→controlled merge→cleanup.
Each sub-PR: spec/impl (mock-first where possible; real writes confined to an isolated
worktree/fixture, NEVER the live working tree or main) → gates → adversarial review →
repair → PR → CI → squash-merge → verify main → update this file. Closure of A5 = the
MVP: TriForge completes a real low-risk task with single owner, read-only reviewer,
tests, repair and a governed merge. Then A6 routing.
First consider TD-1 (extract Clock from mock/) + TD-2 (error code) as tiny chore PRs.
```
