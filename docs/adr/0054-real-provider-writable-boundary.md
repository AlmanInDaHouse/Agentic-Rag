# ADR 0054: Real-provider writable boundary + evidence-based release gate (A10)

## Date

2026-06-30

## Status

Accepted

First decision of Milestone A10 (Real Provider Operational Closure). Establishes the
honest boundary between "A1–A9 roadmap complete (release candidate)" and "real-provider
operational (final 1.0)", and the machine-readable evidence model that gates the
difference. Mandate §3–§4, §11, §15. Component spec:
`REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md`.

## Context

A1–A9 is complete with executable evidence, but **every writable execution proof uses a
mock provider**. The real Codex CLI / Claude Code adapters are read-only and refuse
`readOnly:false`. The standing claim "TriForge 1.0 Definition of Done: MET" is therefore
a *roadmap* closure, not evidence of writable operation with the real providers.

Closing the real-provider gap depends on prerequisites the autonomous loop is forbidden
to perform: installing the provider CLIs inside WSL2 is safe, but **authenticating** them
is a hard stop (manual owner login/MFA; no token/credential automation). Reconstruction
on 2026-06-30 confirmed: WSL2 Ubuntu exists but lacks Node/pnpm/PostgreSQL and the
provider CLIs; the repo sits on `/mnt/c`; the providers are present on the Windows host
with auth **unknown**.

We need a structure that (a) lets all auth-independent work proceed and merge
autonomously, (b) represents real-provider capabilities honestly as blocked, and (c)
makes a false "final operational" claim impossible — without weakening CI or touching
`main`.

## Decision

1. **Two-tier release semantics.** A1–A9 = *release candidate*. The *final operational*
   1.0 is a separate bar gated on real-provider verification. The historical A1–A9
   closure is clarified, not deleted.

2. **Machine-readable evidence registry.** `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`
   (Zod-typed in `@triforge/shared`) records every capability's evidence *status*. A
   mandatory capability that requires a real provider is satisfied **only** at
   `verified_real_provider`; `implemented` / `verified_mock` / `blocked*` / `unknown`
   never satisfy it. `blocked_external` is added for capabilities gated on a manual,
   owner-only action.

3. **Evidence-based gate, green by honesty.** The gate evaluates the registry. The gate
   *tests* assert the **current honest state** — today: final-operational not-ready, with
   an explicit machine-readable reason list (Codex/Claude writable not
   `verified_real_provider`, etc.). CI stays green and `main` clean because the tests
   assert reality; they would fail only if a dishonest "final operational MET" claim were
   introduced while the registry still shows real-provider blocked.

4. **Writable adapters are capability-gated profiles.** A separate writable profile is
   added to the real adapters that still refuses `readOnly:false` unless an *observed
   real* writable capability snapshot for the current version, a 6-field
   `CapabilityBinding`, and a worktree `cwd` are all present. No silent permission mixing;
   the read-only adapters are unchanged.

5. **Isolation is not assumed from WSL2.** A real isolation boundary (A10.2) composes the
   existing primitives with `/mnt/c`/`$HOME`/credential-path denial, env allowlist,
   network-deny posture, `.gitattributes` neutralization, process-group kill and resource
   limits, verified by a negative-fixture invariant matrix. The selected mechanism is
   recorded in a follow-up ADR.

## Alternatives

1. **Keep the file-existence gate and the "DoD MET" line.** Rejected: it cannot
   distinguish mock evidence from real evidence and would let a false final claim stand.
2. **Make the gate hard-fail in CI now.** Rejected: it would turn `main` red and block all
   merges, violating "no gate weakening / CI green / main clean". The honest-state test
   approach achieves the same protection without that cost.
3. **Install + authenticate providers automatically.** Forbidden by mandate §18–§19 (no
   automated login, no credential access). Authentication stays a manual owner action.
4. **Fabricate a fixture "real" snapshot.** Rejected: a fixture is not a real observation;
   a version change must invalidate it. Conflating the two is exactly the dishonesty A10
   exists to prevent.

## Consequences

### Positive

- The release claim becomes precise and falsifiable. A single JSON registry is the source
  of truth for what is mock-verified vs real-verified.
- All auth-independent A10 work (adapters, isolation, harness, gate, PR #26, docs) ships
  autonomously and CI-green; the final tag is turnkey once the owner authenticates.

### Negative

- The registry must be kept current as PRs land (a stale entry is a lie). Mitigated by a
  schema + validation test and per-PR updates.

## Risks

- **A capability silently flipped to `verified_real_provider` without real evidence** —
  countered by requiring an `evidence[]` reference, a `providerVersion`, and an
  `environment` of `wsl2-ubuntu` for real entries; reviewed at merge.
- **Final gate drifts from the notes** — countered by the RC-gate test asserting the
  notes' operational-status claim matches the computed readiness.

## Conditions to Revisit

- When the owner completes `docs/runbooks/REAL_PROVIDER_SETUP_WSL2.md`, the real-provider
  entries move to `verified_real_provider` and the final gate flips to ready → `v1.0.0`.
- A follow-up ADR records the selected isolation mechanism (A10.2).

## References

- `docs/specs/REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md`
- `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json`
- `packages/shared/src/provider/evidence.ts`
- `apps/api/src/test/releaseGate.test.ts`, `apps/api/src/test/finalReleaseGate.test.ts`
- ADR 0031 (autonomous governance); ADR 0032 (writable boundary); mandate §3–§4, §11, §15
