# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 2, on branch `security/provider-repository-threat-model`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | Governance Transition (ADR 0031) |
| Active milestone | A0.5 — Provider and Repository Threat Model (this PR) |
| `main` SHA | `8d8ee00` |
| Last `main` CI | `Validate` ✅ success (`8d8ee00`) |
| Open PRs | the A0.5 threat-model PR (this branch) |
| Blockers | none |
| Pending decisions | none |
| Next loop | A1 — Provider Contracts (first code milestone) |

## Milestone ladder (mandate / instrucciones.md §9 initial state + §13–§21 A1–A9)

- A0.1 Quota-aware orchestration — **merged**
- A0.2 Canonical project vision — **merged**
- A0.3 Official CLI integration + local auth — **merged**
- A0.4 WSL2-first execution substrate — **merged** (`36f84dc`)
- Governance Transition (Autonomous Loop Governance) — **merged** (`8d8ee00`)
- A0.5 Provider and repository threat model — **active** (this PR; ADR 0032)
- A1 Provider contracts — **next** (first code milestone)
- A2 Mocks, harness, quota manager — pending
- A3 Real read-only adapters — pending
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
| Loops executed | 2 complete (Loop 0, Loop 1); Loop 2 (A0.5) active |
| PRs created | 2 this run (governance, A0.5); PR #31 pre-existed |
| PRs merged | 2 (#31 A0.4, #32 governance) |
| CI failures | 0 |
| Repair rounds | 2 (governance review; A0.5 review) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | Loop 1: 2 critical / 2 major / 6 minor / 4 obs. Loop 2 (A0.5): 0 blocker / 0 critical / 0 major / ~3 minor / ~7 obs — all resolved pre-merge |
| Time-to-merge | Loop 0 & 1: same session; Loop 2: pending |
| Diff size | Loop 1: 8 files docs; Loop 2: 3 files docs (spec 2426L, ADR, register) |
| Coverage | n/a (docs-only; no code touched yet — A1 begins code) |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; owner must rotate) |
| Context recoveries | 0 |

## Exact next loop

```text
Loop 3 — A1 Provider Contracts (mandate §13; first CODE milestone)
1. git checkout main && git pull (ff) ; branch feat/provider-contracts
2. In packages/shared: define ProviderAdapter interface; ProviderEvent contract
   (13 event types); capability snapshot type; Zod-validated artifact contracts
   (TaskSpecification, ContextManifest, AgentPlan, CrossReview, StrategyDecision,
   TaskProfile, RoutingDecision, ImplementationResult, ReviewFindings,
   QualityGateResult, GovernanceDecision, RunFinalReport). No provider-specific logic.
3. Add Vitest schema tests + compatibility rules. Update PROJECT_CONTEXT + Vision §11/§12.
4. Run gates: pnpm typecheck, pnpm test, pnpm build, pnpm lint:deps, pnpm audit.
5. Adversarial review ; commit, push, open PR, verify CI, squash-merge, delete branch.
6. Verify main CI ; update this file ; select A2.
Note: A1 is the first code milestone — bind any future writable capability to the
A0.5 closure rule (threat-model §11). Writable execution stays unauthorized.
```
