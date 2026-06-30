# TriForge 1.0 — Release Notes & Definition of Done

**Status:** Release candidate. The **A1–A9 roadmap Definition of Done: MET** with
**executable evidence** (green gates + specs/ADRs), not a narrative. The **Final
operational Definition of Done (A10): PENDING** — writable operation with the *real*
Codex / Claude CLIs is not yet verified. The providers must be installed and
**manually authenticated by the owner** inside WSL2 (see §A10 and
`docs/runbooks/REAL_PROVIDER_SETUP_WSL2.md`). The single machine-readable source of
truth for what is mock-verified vs real-verified is
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`.

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

## A10 — Real Provider Operational Closure (the path to the final operational release)

A1–A9 proved the writable runtime with **mock** providers. The final operational 1.0
requires verifying it with the **real** Codex CLI and Claude Code. A10 adds the
evidence model, the capability-gated writable adapters, the real isolation boundary,
the conformance harness, the pilots, and an **evidence-based release gate** that
distinguishes "roadmap complete (RC)" from "real-provider operational (final)".

The auth-independent substrate (A10.1–A10.4, A10.10, A10.11) ships autonomously and
CI-green. The auth-dependent verification (A10.5–A10.8: real pilots, real collaboration
modes, real quota, integrated real E2E) is **blocked on one owner-only manual action**:
install + authenticate the provider CLIs in WSL2 per
`docs/runbooks/REAL_PROVIDER_SETUP_WSL2.md`. Until then those capabilities are
`blocked_external` in `TRIFORGE_CAPABILITY_EVIDENCE.json`, the final gate reports
not-ready, and no `v1.0.0` final tag is created. See
`docs/specs/REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md` and ADR 0054.

## Compatibility matrix (observed 2026-06-30)

| Component | Version / target | Status |
|---|---|---|
| OS host | Windows 11 (build 26200) | verified |
| Substrate | WSL2 Ubuntu (v2) | present; Node/pnpm/PostgreSQL toolchain `blocked_external` (runbook) |
| Repo location (real run) | Linux filesystem (not `/mnt/c`) | `blocked_external` (owner moves the repo) |
| Node | 22 (CI) / 24.12 (dev host) | verified |
| pnpm | 11.5.0 | verified |
| PostgreSQL | 16 (CI service) | verified |
| Codex CLI | 0.101.0 (Windows host; auth unknown) | read-only `verified_fixture`; writable real `blocked_external` |
| Claude Code | 2.1.195 (Windows host; auth unknown) | read-only `verified_fixture`; writable real `blocked_external` |
| Required CI check | `Validate` | verified green on `main` |

The single machine-readable source of truth is
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`. "writable real `blocked_external`"
means the writable *adapter* + conformance are verified against fixtures, but the
end-to-end writable run with the **authenticated** CLI awaits the owner runbook.

## Known non-blocking open items (registered)

- **A5.10 / A10 real provider verification** — gated on the owner's manual WSL2
  install + authentication; tracked in `TRIFORGE_CAPABILITY_EVIDENCE.json` and the
  REQUIRES_VERIFICATION register (A10.9). The MVP stands via mocks.
- **PR #26** — legacy 1.x Code Graph ingestion, out of the A1–A9 roadmap; resolved by
  A10.10.
- **R-SEC-2** — the owner's external PAT rotation (Git auth via the credential manager is
  unaffected).

## Safety posture (mandate §15 / ADR 0031–0032)

No API keys, no token extraction, no automated login, no direct `main` writes or
force-push, no branch-protection disabling, no check bypass. Writable work is confined to
isolated worktrees; every writable capability carries a
{threat, control, milestone, verification, recovery, residual-risk} closure record.

**A1–A9 roadmap Definition of Done: MET** (release candidate) — backed by the green
release gate and the evidence mapped above.

**Final operational Definition of Done (A10): PENDING** — gated on real-provider
verification, evaluated from `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` by
`apps/api/src/test/finalReleaseGate.test.ts`. The final-operational declaration and the
`v1.0.0` tag are set only when that gate reports ready (every mandatory writable
real-provider capability at `verified_real_provider`).
