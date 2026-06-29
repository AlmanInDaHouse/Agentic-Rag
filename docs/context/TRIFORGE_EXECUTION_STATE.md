# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 4, on branch `feat/a2-mock-provider-framework`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A1 — Provider Contracts (`5cf7728`, PR #34) |
| Active milestone | A2 — Mocks, Adapter Harness, Quota Manager (split A2.1/A2.2/A2.3) |
| `main` SHA | `5cf7728` |
| Last `main` CI | `Validate` ✅ success (`5cf7728`) |
| Open PRs | A2.1 (this branch, in progress). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is from the legacy 1.x line, out of the A1–A9 roadmap, not blocking — left as-is. |
| Blockers | none |
| Pending decisions | none |
| Next loop | A2.1 → A2.2 → A2.3, then A3 |

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
- A2 Mocks, harness, quota manager — **active** (split: A2.1 mock framework + adapters; A2.2 adapter harness; A2.3 quota manager)
- A3 Real read-only adapters — **next**
- A4 Collaboration runtime — pending
- A5 Controlled writable execution (MVP) — pending (gated on A0.4+Gov+A0.5+A1–A4)
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
| Loops executed | 4 complete (Loop 0 A0.4, Loop 1 Gov, Loop 2 A0.5, Loop 3 A1); Loop 4 (A2) active |
| PRs created | 3 this run (governance, A0.5, A1); PR #31 pre-existed |
| PRs merged | 4 (#31 A0.4, #32 governance, #33 A0.5, #34 A1) |
| CI failures | 0 |
| Repair rounds | 3 (governance, A0.5, A1 reviews) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | Gov: 2 crit/2 maj/6 min/4 obs. A0.5: 0/0/0/~3 min/~7 obs. A1: 0/0/0/~3 min/~3 obs — all resolved pre-merge |
| Time-to-merge | Loops 0–3: same session |
| Diff size | A0.4/Gov/A0.5 docs; A1: 11 files (~1900 LoC, contracts+51 tests) |
| Coverage | A1: 51 schema tests (apps/api/src/test) |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 4 — A2 Mocks, Adapter Harness, Quota Manager (mandate §14), split in 3 PRs:
A2.1 (this PR, branch feat/a2-mock-provider-framework):
  - A2 spec (PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md): scenarios, determinism,
    lifecycle, temporal model, events, errors, cancellation/timeout/output limits,
    quota, harness, invariants, acceptance, failure modes, relations A1/A3/A0.5.
  - Deterministic scenario engine + injectable clock/scheduler + predictable IDs.
  - MockCodexAdapter + MockClaudeAdapter implementing ProviderAdapter (A1), sharing
    the scenario engine; provider differences via identity/capability fixtures only.
  - 35-scenario catalog (covers + exceeds the ~19 mandated A2.1 scenarios); direct
    tests (event streams, terminal semantics).
  - Tests in apps/api/src/test (pure, no DB, no net, no creds). Gates green.
A2.2 (next, branch feat/a2-adapter-harness):
  - Reusable black-box adapter conformance harness (works for mocks now, real
    adapters in A3); detects non-conformant adapters; verifies the §10 invariants.
A2.3 (next, branch feat/a2-quota-manager):
  - Quota Manager: per-provider budgets, reservations, commit/release, warnings,
    hard stops, unknown state, rate-limit, max turns/loops/wall-time, manual resume,
    no paid fallback; auditable accounting invariants; typed errors.
Each PR: spec/impl → gates (typecheck, tests, lint:deps, build) → adversarial
review → repair → commit/push/PR(draft→ready) → CI → squash-merge → delete branch
→ verify main → update this file. Then A3.
Bind any writable capability to the A0.5 closure rule (threat-model §11). Writable
execution stays unauthorized.
```
