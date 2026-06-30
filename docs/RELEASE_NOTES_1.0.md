# TriForge 1.0 — Release Notes & Definition of Done

**Status:** Final operational release — **`v1.0.0`, the Windows Native Operational
Release.** **A1–A9 roadmap complete.** **Windows-native operational closure complete
(A10-W).**

The **A1–A9 roadmap Definition of Done: MET** with **executable evidence** (green gates
+ specs/ADRs), not a narrative. The **TriForge 1.0 operational Definition of Done: MET**
— the real Codex / Claude CLIs are run on a **native Windows 11**
substrate (ADR 0056; WSL2 is reframed optional/future), operated from a **PowerShell
terminal in an integrated IDE**, with no WSL2 / Ubuntu / Linux-path requirement. Both
providers are already installed and **authenticated natively on Windows** (the prior
manual-login hard stop is satisfied), so the remaining work is engineering: the Windows
path policy, worktree manager, Job Object process supervisor, isolation boundary,
adapters, pilots, integrated E2E and packaging. The single machine-readable source of
truth for what is fixture-verified vs real-verified is
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`; run `pnpm triforge:doctor` to verify
the native substrate.

TriForge is a local multi-agent CLI-orchestration runtime (Codex + Claude Code, no API
keys) that takes a task, routes it honestly to a provider, executes it with real
repository writes **confined to isolated git worktrees**, reviews and governs the result
autonomously, and exposes the whole run through a product UI — with a hardened failure
surface and a release-candidate gate.

## What 1.0 delivers

- **Provider contracts (A1)** — Zod-typed task/profile/routing/governance/review/gate/
  mutation artifacts + an error taxonomy (`@triforge/shared`).
- **Mocks, harness, quota (A2)** — a mock provider framework, a reusable conformance
  harness, and a quota manager.
- **Real read-only adapters (A3)** — Codex/Claude adapters (read-only; writable pilot
  A5.10 is gated).
- **Collaboration runtime (A4)** — Specialist / Pair / Full-Debate with authority-order
  resolution.
- **Controlled writable execution — the MVP (A5)** — isolated worktrees, allowed-path
  policy, deny-by-default command policy + process supervision, owner/reviewer
  enforcement, a hash-chained mutation ledger + reconciliation, real quality gates, a
  bounded repair loop, an autonomous governance decision with anti-replay, and a
  mock-first writable E2E. Real writes happen **only inside isolated worktrees**, never on
  `main`.
- **Routing & learning (A6)** — task profiler, honest static + quota-aware + adaptive
  routers (no provider stereotypes; quota/auth-aware; explainable; human-overridable).
- **Competitive mode (A7)** — two isolated candidates, winner selected by re-derived
  evidence, only the winner merged.
- **Product interface (A8)** — 8 panels (provider status, task composer, run timeline,
  artifact explorer, diff/review, governance, budget/quota, recovery); honest states, no
  invented backend state, all untrusted content sanitized.
- **Hardening & release (A9)** — chaos/failure-surface bounding, A0.5 security acceptance
  tests, version drift, recovery-after-restart, observability (no hidden state), packaging
  + install docs, operator documentation, and a release-candidate acceptance index.

## Definition of Done — checklist (each item → its evidence)

| DoD item | Evidence |
|---|---|
| Provider contracts typed + validated | A1 spec `PROVIDER_CONTRACTS_SPEC.md`; ADR 0033 |
| Mocks / harness / quota | A2 spec; quota/harness suites |
| Real read-only adapters | A3 spec; ADR 0034; adapter suites |
| Collaboration runtime | A4 spec; ADR 0035 |
| **Writable MVP — real writes only in isolated worktrees** | A5 spec `WRITABLE_EXECUTION_SPEC.md`; ADRs 0036–0044; `writableRun.e2e.test.ts` (real git) |
| Every writable capability bound (A0.5 6-field closure) | capability bindings in A5 ADRs; `security.acceptance.test.ts` |
| Honest routing (quota/auth-aware, explainable, overridable) | A6 spec `ROUTING_LEARNING_SPEC.md`; ADRs 0045–0050 |
| Competitive selection by evidence | A7 spec `COMPETITIVE_MODE_SPEC.md`; ADR 0051; `competitiveRun.e2e.test.ts` |
| Product UI (8 panels), honest + sanitized | A8 spec `PRODUCT_INTERFACE_SPEC.md`; ADR 0052; 46 web tests |
| Failure surface bounded (no false-green) | `chaos.failureSurface.test.ts` (A9.1) |
| A0.5 security controls hold | `security.acceptance.test.ts` (A9.2) |
| Version/capability drift honest | `versionDrift.test.ts` (A9.3) |
| Recovery after restart | `recovery.restart.test.ts` (A9.4) |
| Observability — run reconstructable, no hidden state | `runReconstruction.test.ts` (A9.5) |
| Buildable/installable from a fresh checkout | `TRIFORGE_INSTALL.md`; `packaging.test.ts`; clean `pnpm -r build` |
| Operator documentation complete | `TRIFORGE_OPERATOR_GUIDE.md`; `docsCompleteness.test.ts` (A9.7) |
| Release-candidate scenarios green | `rc.acceptance.test.ts` (A9.8) |
| **Release gate — all gates green, main green** | CI `Validate` job (build, typecheck, lint:deps, full test suite, code-graph, audit) green on every PR; this PR included |

## Release gate

The `Validate` CI job runs from a clean checkout on every PR: `pnpm install
--frozen-lockfile`, `pnpm -r build`, `pnpm typecheck`, `pnpm lint:deps`, the full `pnpm
test` suite (api incl. chaos / SAT / drift / recovery / observability / packaging / docs /
RC + the real-git E2E, and the 46 web view-model tests), the code-graph checks, and the
dependency audit — **all green**. `main` is always green. There are no open
blockers/criticals.

## A10 / A10-W — Real Provider Operational Closure on native Windows

A1–A9 proved the writable runtime with **mock** providers. A10 added the evidence
model, the capability-gated writable adapters, the real isolation boundary, the
conformance harness, and an **evidence-based release gate** that distinguishes "roadmap
complete (RC)" from "real-provider operational (final)".

**A10-W (native Windows pivot, ADR 0056)** retargets the final operational closure from
a mandatory WSL2 substrate to **native Windows 11**, operated from a PowerShell IDE
terminal. The prior blocker — *install + authenticate the CLIs in WSL2* — is removed:
both providers are already installed and authenticated natively on Windows. The
remaining work is the Windows substrate engineering, split into reviewable PRs A10-W.1…
A10-W.9 (see `docs/specs/NATIVE_WINDOWS_OPERATIONAL_CLOSURE_SPEC.md`):

- **A10-W.1 (landed)** — governance (ADR 0056), the `ExecutionPlatform` boundary, the
  evidence-model extension (`verified_real_environment` + `requiresRealEnvironment`),
  the 14 mandatory native-Windows-final capabilities (12 `windows_*` substrate +
  2 cross-vendor pilot e2e caps re-homed to windows-native), and `pnpm triforge:doctor`.
- **A10-W.2…W.9** — Windows path policy, NTFS worktree manager, Job Object process
  supervisor, isolation boundary + safe command policy, real adapters, real pilots,
  integrated IDE-terminal + UI E2E, and packaging/security-review/release.

Until every mandatory `windows_*` capability reaches its bar
(`verified_real_environment` for real-host OS behavior, `verified_real_provider` for
real CLI runs) in `TRIFORGE_CAPABILITY_EVIDENCE.json`, the final gate reports not-ready
and no `v1.0.0` final tag is created. See ADR 0054, ADR 0056, and
`docs/specs/REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md`.

## Compatibility matrix (observed 2026-06-30 via `pnpm triforge:doctor`)

| Component | Version / target | Status |
|---|---|---|
| OS host | Windows 11 Home (build 26200), x64 | `verified_real_environment` |
| Substrate | **Native Windows on NTFS** (ADR 0056; WSL2 optional/future) | `windows_native_substrate` = `verified_real_environment` |
| Shell | Windows PowerShell 5.1 (pwsh 7 optional) | verified |
| Node | 22 (CI) / 24.12 (dev host) | verified |
| pnpm | 11.5.0 (corepack 0.34.5) | verified |
| PostgreSQL | 18 (native Windows service) / 16 (CI) | running; `localhost:5432` reachable |
| Codex CLI | 0.101.0 (native Windows, **authenticated**) | read-only `verified_fixture`; Windows real run `unknown` (A10-W.6) |
| Claude Code | 2.1.195 (native Windows, **authenticated**: claude.ai, Max) | read-only `verified_fixture`; Windows real run `unknown` (A10-W.6) |
| Long paths | `LongPathsEnabled=0` | warning — `git config core.longpaths true` (no admin) |
| Required CI check | `Validate` (Linux) | verified green on `main` |

The single machine-readable source of truth is
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`. The Windows real-provider runs are
`unknown` (scheduled A10-W.6–W.8), no longer `blocked_external`: the providers are
authenticated, so the closure is engineering, not a manual owner action.

## Known non-blocking open items (registered)

- **A10-W real provider verification** — native-Windows engineering across A10-W.2–W.9
  (path policy, worktree, Job Object supervisor, isolation, adapters, pilots, E2E,
  packaging). Tracked in `TRIFORGE_CAPABILITY_EVIDENCE.json`. No longer gated on a manual
  WSL2 install/auth: both providers are authenticated natively. The MVP stands via mocks.
- **PR #26** — legacy 1.x Code Graph ingestion, out of the A1–A9 roadmap; resolved by
  A10.10.
- **R-SEC-2** — the owner's external PAT rotation (Git auth via the credential manager is
  unaffected).

## Safety posture (mandate §15 / ADR 0031–0032)

No API keys, no token extraction, no automated login, no direct `main` writes or
force-push, no branch-protection disabling, no check bypass. Writable work is confined to
isolated worktrees; every writable capability carries a
{threat, control, milestone, verification, recovery, residual-risk} closure record.

**A1–A9 roadmap Definition of Done: MET** — backed by the green release gate and the
evidence mapped above.

**TriForge 1.0 operational Definition of Done: MET** — the final evidence gate
(`evaluateFinalReleaseReadiness` over `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`,
asserted by `apps/api/src/test/finalReleaseGate.test.ts` + `windowsFinalGate.test.ts`)
reports **ready: true, 39/39** mandatory capabilities at their required bar on a real
Windows 11 host: every `windows_*` substrate capability `verified_real_environment`, and
every real-provider capability — including the **integrated product E2E** (a real Codex
run completed end-to-end through the UI to a governed merge, 2026-06-30) — at
`verified_real_provider`. `v1.0.0` is the Windows Native Operational Release. See ADR 0056
and `docs/specs/NATIVE_WINDOWS_OPERATIONAL_CLOSURE_SPEC.md`.
