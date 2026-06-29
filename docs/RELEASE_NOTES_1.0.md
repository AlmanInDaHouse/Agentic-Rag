# TriForge 1.0 — Release Notes & Definition of Done

**Status:** Release candidate. The A1–A9 roadmap is complete; the Definition of Done below
is met with **executable evidence** (green gates + specs/ADRs), not a narrative.

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

## Known non-blocking open items (registered)

- **A5.10 real provider pilot** — gated until a writable provider capability is observed
  (WSL2 substrate + authenticated CLIs; the MVP stands via mocks).
- **PR #26** — legacy 1.x Code Graph ingestion, out of the A1–A9 roadmap, not merged.
- **R-SEC-2** — the owner's external PAT rotation (Git auth via the credential manager is
  unaffected).

## Safety posture (mandate §15 / ADR 0031–0032)

No API keys, no token extraction, no automated login, no direct `main` writes or
force-push, no branch-protection disabling, no check bypass. Writable work is confined to
isolated worktrees; every writable capability carries a
{threat, control, milestone, verification, recovery, residual-risk} closure record.

**TriForge 1.0 Definition of Done: MET** — backed by the green release gate and the
evidence mapped above.
