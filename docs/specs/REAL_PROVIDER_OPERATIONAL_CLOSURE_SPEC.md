# A10 — Real Provider Operational Closure (Spec)

**Status:** Active. **Milestone:** A10. **Owners:** Autonomous loop (ADR 0031 governance).
**Supersedes nothing.** Clarifies the A1–A9 closure: A1–A9 is a *release candidate*; the
*final operational* 1.0 is gated on the real-provider verification defined here.

---

## 1. Problem statement

A1–A9 delivered, with executable evidence, a complete TriForge runtime: provider
contracts, mocks/harness/quota, read-only real adapters, the collaboration runtime,
the controlled writable MVP (real writes confined to isolated git worktrees), honest
routing, competitive mode, the product UI, and hardening + a release-candidate gate.

**Every writable execution proof to date uses a *mock* provider.** The real Codex CLI
and Claude Code adapters are **read-only** and refuse `readOnly:false`. Therefore the
claim "TriForge operates writable with the real providers" is **not yet evidenced**.

A10 closes that gap honestly. It does **not** re-open A1–A9; it adds the substrate,
the writable real adapters, the isolation boundary, the pilots, and an evidence-based
release gate that distinguishes "roadmap complete (RC)" from "real-provider operational
(final)".

## 2. Non-negotiable honesty constraints (mandate §18–§19)

- No API keys, no token/cookie extraction, no automated login, no reading credential
  stores, no copying auth state from Windows.
- Provider authentication is performed **manually by the owner** via the official CLIs.
- A capability that integrates the real providers in a writable path may be reported
  satisfied for the final release **only** when its evidence status is
  `verified_real_provider`. `implemented`, `verified_mock`, `blocked`, `unknown` are
  never sufficient (see §4).
- Blocked/unknown states are surfaced, never hidden. `unknown` stays `unknown`.
- No direct `main` writes, no force-push, no branch-protection changes, no gate
  weakening, no check bypass.

## 3. Sub-milestones

| ID | Title | Independent of provider auth? |
|---|---|---|
| A10.1 | Evidence model + honest release gate + spec/ADR + doc correction | yes |
| A10.2 | Real isolation boundary + invariant matrix | yes |
| A10.3 | Writable provider adapters (capability-gated profiles) | yes |
| A10.4 | Writable adapter conformance harness | yes |
| A10.5 | Real provider pilots (Codex/Claude owner ↔ reviewer) | **no — needs auth** |
| A10.6 | Real collaboration modes (specialist/pair/debate/competitive) | **no — needs auth** |
| A10.7 | Quota & usage reality | **no — needs auth** |
| A10.8 | Integrated product E2E (real run) | **no — needs auth** |
| A10.9 | Resolve REQUIRES_VERIFICATION register | mixed |
| A10.10 | Resolve PR #26 | yes |
| A10.11 | Honest, evidence-based release gate | yes |

The independent work (A10.1–A10.4, A10.10, A10.11, and the in-process parts of A10.9)
proceeds autonomously and lands first. The auth-dependent work (A10.5–A10.8, the real
parts of A10.7/A10.9, and the final tag) resumes when the owner completes the manual
provisioning + authentication runbook (`docs/runbooks/REAL_PROVIDER_SETUP_WSL2.md`).

## 4. Evidence model

`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`, validated against
`capabilityEvidenceRegistrySchema` (`@triforge/shared`,
`packages/shared/src/provider/evidence.ts`).

Status ladder: `implemented` < `verified_unit` < `verified_mock` < `verified_fixture`
< `verified_real_provider`, plus `blocked`, `blocked_external` (gated on a manual
owner-only action), `unknown`, `not_applicable`.

Each entry carries: `capability`, `status`, `mandatoryForFinal`, `requiresRealProvider`,
`provider`, `providerVersion`, `environment`, `evidence[]`, `verifiedAt`, `risks[]`,
`notes`.

**Final-operational readiness** (`evaluateFinalReleaseReadiness`): every
`mandatoryForFinal` capability must be satisfied —
- `requiresRealProvider:true` → status must be exactly `verified_real_provider`;
- otherwise → status ∈ {verified_unit, verified_mock, verified_fixture,
  verified_real_provider, not_applicable}.

If any mandatory capability is unsatisfied, the registry yields `ready:false` with a
machine-readable list of reasons. This is the single source of truth for the
final-operational gate (§11).

## 5. A10.2 — Real isolation boundary (invariants)

Worktrees alone are not a sandbox. The boundary composes the existing primitives
(`pathPolicy`, `commandPolicy`, `processRunner`/env allowlist, git hardening) with the
A10.2 additions and is verified against real-OS fixtures. Invariants:

1. No write outside the worktree. 2. No read of credential stores. 3. No inherited
sensitive env. 4. No access to other worktrees. 5. No `.git` modification. 6. No `main`
modification. 7. Extra network denied by default. 8. Required service network explicitly
delimited. 9. Child commands supervised. 10. Cancellation kills the process group.
11. CPU/memory/time/output limits defined. 12. Artifacts retained without secrets.
13. **WSL2 is not, by itself, a sufficient sandbox.**

Negative fixtures (must all be denied/contained): path traversal, symlink escape,
hardlink abuse, `/mnt/c` escape, `$HOME` escape, credential-path access, environment
leakage, process orphan, fork behaviour, output flood, unauthorized network,
destructive command, privileged command, `.git` modification. The selected mechanism is
recorded in an ADR.

## 6. A10.3 — Writable provider adapters

A `read-only execution profile` and a `controlled writable execution profile`, with no
silent permission mixing. The writable profile **refuses** `readOnly:false` exactly like
A3 **unless all** hold: (a) an observed *real* writable capability snapshot for the
*current* CLI version authorizes it; (b) a `CapabilityBinding` (6-field A0.5 closure) is
present; (c) `cwd` is inside a worktree. A version change invalidates the snapshot.
Requirements: sanitized argv, shell disabled, env allowlist, timeout, cancel, event
stream, raw evidence, usage, quota-or-unknown, output limit, single terminal event, no
events after terminal, role binding, mutation-ledger/quality-gate/governance integration.

## 7. A10.5–A10.8 — Real pilots, modes, quota, integrated E2E

Executed on fixture repos with low-risk changes; the TriForge repo's `main` is never
touched by a provider. Negative cases are run with harmless fixtures (never instruct a
real provider to steal credentials or harm the host). Competitive mode may be excluded
from 1.0 by formal decision if blocked by real quota — recorded as `blocked_by_quota`,
never falsified.

## 8. A10.11 — Honest release gate

The gate is **evidence-based**, not file-existence-based. Two distinct assertions:

- **RC gate** (`releaseGate.test.ts`): A1–A9 evidence index present + the registry is
  well-formed + the release notes' operational-status claim *matches* the registry's
  computed readiness. Green today (the notes honestly say RC, not final).
- **Final-operational gate** (`finalReleaseGate.test.ts`): asserts
  `evaluateFinalReleaseReadiness` and the v1.0.0 tag policy. It fails to declare the
  final release when any mandatory writable real-provider capability is not
  `verified_real_provider`, the integrated E2E has not passed, isolation is unverified,
  a blocker/critical exists, CI is red, a roadmap PR is unresolved, the clean install
  fails, or the UI E2E fails.

Crucially, CI stays green and `main` stays clean: the gate **tests** assert the *honest
current state* (today: not-ready, with explicit reasons). They would only fail if a
dishonest claim (final-operational MET while real-provider is blocked) were introduced.

## 9. Definition of Done (A10)

See mandate §17. In short: WSL2 operational; repo on Linux fs; Codex + Claude installed
and **authenticated** in WSL2; both writable adapters implemented and passing the
conformance harness with current snapshots; Codex-owner and Claude-owner E2E pass;
specialist/pair/full-debate pass real (competitive passes or is formally excluded);
isolation, allowed paths, safe commands, supervision, cancellation, ledger, gates, repair,
governance-bound-to-diff all verified; quota/usage honest; UI+backend complete a real run;
recovery works; clean install in WSL2 works; all REQUIRES_VERIFICATION closed/excluded;
PR #26 resolved; no blockers/criticals; CI green; evidence-based release gate passes;
`main` clean; `v1.0.0` represents the real operational release.

The project is **not** done by PR/test/ADR count — only when real operation with both
providers is demonstrated.
