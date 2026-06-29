# ADR 0032: Untrusted Repository and Provider Boundaries

## Date

2026-06-29

## Status

Accepted

Establishes the security boundaries and the binding closure rule for Milestone
A0.5 (Provider and Repository Threat Model). Complements — does not supersede —
ADR 0011 (Safe Execution Policy), ADR 0030 (WSL2-First Execution Substrate) and
ADR 0031 (Autonomous Loop Governance). The canonical threat catalog is
`docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md`.

## Context

TriForge is being built to coordinate the official Codex CLI and Claude Code to
**read** and, in a later milestone, **write** this repository under the user's
local subscription (ADR 0027/0028/0029). Two facts make the security boundary the
gating concern before any writable execution:

- **Repository content is untrusted.** Files, README/`AGENTS.md`/`CLAUDE.md`/
  `.claude`, code comments, test and package scripts, `.gitattributes`,
  `.gitmodules`, manifests and the lockfile can all carry injected instructions,
  hostile git mechanisms, or supply-chain payloads (Vision §19/§25; mandate §12).
- **Provider output is untrusted.** Proposed diffs, commands, findings, structured
  results and event streams are agent output and a prompt-injection carrier; "Agent
  output is untrusted" is a standing Vision invariant (§19). The provider *process*
  nonetheless runs with the host user's full trust.

Two recent decisions raise the stakes:

- **The substrate is explicitly not a security sandbox.** ADR 0030 chose WSL2-first
  for operational and compatibility reasons and declared, repeatedly, that "WSL2 is
  not treated as the sole security sandbox for untrusted repository content"
  (`WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md` §8.8/§13). The whole Windows volume is
  auto-mounted at `/mnt/c`, so any path escape reaches Windows credential/cookie
  stores Vision §19 declares off-limits. A0.4 deferred the threat model and the
  security sandbox design to A0.5.
- **Governance is now autonomous.** ADR 0031 removed the mandatory human commit gate
  for ordinary in-repository changes; ordinary merges are decided autonomously when
  CI is green and no blocker/critical findings remain. This makes a bad merge — from
  prompt injection, output/approval spoofing, context poisoning, or a compromised
  provider — more consequential, because a human may not see it before it lands on
  `main` (ADR 0031 risks R-GOV-1/R-GOV-5).

The runtime is **mock-only today** (Vision §20; ADR 0011). No real adapter,
allowed-path/command enforcement, worktree manager, mutation ledger, quota manager
or sandbox exists; the only real process-spawning code,
`tooling/harness/src/runner.ts`, already forwards the full environment, pipes
output unredacted, uses `shell:true` on win32, and kills only the lead PID on
POSIX — the exact anti-patterns future writable execution must not inherit. The
threat model must therefore be written **before** the writable surface is built, so
the controls are designed against enumerated threats rather than retrofitted.

## Decision

1. **Treat both repository content and provider output as untrusted** across the
   trust boundaries `TB-1..TB-20` enumerated in
   `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §4. The provider process runs with
   host trust but its inputs (repo content) and outputs (diffs/commands/findings/
   results/events) are untrusted data that must be re-grounded against independent
   evidence, never accepted as authoritative narrative (Vision §4.4, §14).

2. **Adopt the threat model spec as the canonical catalog.**
   `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` is the single source of truth for
   assets, actors, trust boundaries, data flows, the 71 threats (`T-INJ`/`T-FS`/
   `T-GIT`/`T-EXE`/`T-INT`/`T-CMP`), current vs planned controls, residual risks,
   prohibited actions and future security acceptance tests. New threats and controls
   are added there.

3. **Bind every writable capability (the closure rule).** Before any future writable
   capability is enabled it MUST be bound to all six of **{threat, control,
   milestone, verification, recovery, residual risk}**, referencing catalog IDs
   (`T-*`) and register IDs (`R-*`), using the capability-binding template in the
   spec (§11). A capability that cannot fill all six fields is not authorized.

4. **Keep writable provider execution unauthorized** until A0.5 is **merged** AND the
   planned controls for the specific capability are **implemented in their
   milestones** with their security acceptance tests passing. Merging A0.5 records
   the model; it does not by itself switch on any writable execution. This restates
   and tightens ADR 0031 "Relation to A0.5" and mandate §17 (A5 must not start until
   A0.4, Governance Transition, A0.5, A1, A2, A3 and A4 are closed).

5. **Carry the prohibited-action and hard-stop boundaries** (mandate §3.2/§3.3;
   ADR 0031) into the security model as first-class, threat-linked constraints
   (spec §9), including the A0.5-specific hard stops: no agent-driven git command
   without hooks/config/attributes/submodules neutralized; no child spawned with the
   full parent environment or `shell:true` for untrusted argv; no merge decided from
   provider/owner narrative rather than re-derived evidence.

## Alternatives

1. **Build adapters first, harden later.** Rejected. It would inherit the
   `runner.ts` anti-patterns into the writable path and create dangerous side
   effects before the boundary is reasoned about (the exact failure ADR 0011 was
   created to prevent). The mandate sequences A0.5 before A5 for this reason.
2. **Rely on WSL2 as the sandbox.** Rejected and explicitly contradicted by ADR 0030
   §8.8/§13: the VM boundary is operational isolation, not confinement for code
   TriForge launches; `/mnt/c` exposes the whole host.
3. **Rely on autonomous CI + cross-review alone.** Insufficient. Both the required
   `Validate` workflow and branch protection are partially self-modifiable by the
   writable owner (T-INT-07/08/09, T-GIT-07), and review is advisory and itself a
   potentially compromised provider (T-INJ-02, T-INT-02). Integrity must come from
   re-derived evidence and enforced controls, not narrative.
4. **Treat only repository content as untrusted (trust provider output).** Rejected.
   Provider output is the primary injection-laundering and spoofing surface
   (T-INJ-10/11/12, T-CMP-01..04); Vision §19 already declares it untrusted.

## Consequences

### Positive

- The writable surface is designed against an enumerated, repo-grounded threat
  catalog with explicit current-vs-planned control status and per-threat
  acceptance tests.
- Every future writable capability is auditable against a fixed six-field binding,
  making "is this safe to enable yet?" a checkable question, not a judgement call.
- The decision aligns the security model with the autonomous-governance experiment:
  the gate computes its verdict from re-derived evidence, limiting the blast radius
  of injection/spoofing/compromise.

### Negative

- Writable execution is gated behind substantial planned work (allowed-paths,
  Safe Command Policy, worktree manager, mutation ledger, env allowlist, redaction,
  process groups, sandbox/OS isolation), deferring the functional MVP (A5).
- The catalog is large (71 threats) and must be kept current as code lands; a stale
  catalog is itself a risk to the closure rule.
- Several controls have irreducible residual risk (spec §8, RR-1..RR-9), so
  "authorized" never means "risk-free"; the residual must be accepted explicitly per
  capability.

## Risks

- **R-SEC-4** No OS-level sandbox; a path escape reaches `/mnt/c` + `$HOME` →
  host/credential compromise. Mitigation: A5.3 realpath containment + out-of-bounds
  roots; an A0.5/A4 OS-isolation decision; A9 path tests.
- **R-SEC-5** Secret leakage via full-env forwarding + unredacted output (the
  `runner.ts` seed pattern). Mitigation: env allowlist + stream redaction; A2 "no
  secret leakage".
- **R-SEC-6** Forgeable self-certified governance/integrity artifacts under autonomy.
  Mitigation: A5.9 gate re-derives evidence; A5.6 independent ledger; reviewer-owned
  findings.
- **R-SEC-7** Self-modifiable CI/branch-protection gates; protection state
  unverified. Mitigation: workflow-integrity meta-gate; branch-protection probe.
- **R-SEC-8** Git-mechanism code execution on untrusted trees. Mitigation: hardened
  git invocation (hooks/config/attributes/submodules off).
- **R-SEC-9** Approval unauthenticated/self-asserted and unbound to the diff.
  Mitigation: authenticated approver channel; approval↔diff-hash binding.
- **R-SEC-10** Supply-chain install-time RCE / dependency confusion. Mitigation:
  `.npmrc` ignore-scripts + registry/scope pin; non-zero `minimumReleaseAge`;
  full-workspace scan.
- **R-SEC-11** Security-relevant provider/toolchain version drift. Mitigation:
  version-bound capability snapshots; drift detection + re-probe; substrate
  preflight matrix.

These continue from the existing register (`R-GOV-1..5`, `R-SEC-1..3`,
`R-SUB-1..3`, `R-PRV-1..3`) and are proposed for wiring into
`docs/context/TRIFORGE_RISK_REGISTER.md` by the owner; the broad cases R-GOV-5
(spoofing/poisoning → bad merge) and R-SEC-3 (untrusted repo content on writable
runs) remain in force. The full residual set is spec §8 (RR-1..RR-9).

## Conditions to Revisit

- A provider gains (or TriForge adopts) a **verified** native sandbox sufficient to
  contain untrusted repo content, changing the OS-isolation requirement (RR-4).
- The substrate decision changes (ADR 0030 revisited), altering the `/mnt/c`/`$HOME`
  exposure or the process model.
- Autonomous governance is revoked or re-gated by the owner (ADR 0031 "Conditions to
  Revoke Autonomy"), changing the integrity assumptions this model is built on.
- A new attack class emerges that the six analysis buckets do not cover; the catalog
  is extended and this ADR amended.
- Branch-protection configuration and token scope become verifiable in-repo,
  retiring the `REQUIRES_VERIFICATION` items in spec §14.

## References

- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` (canonical catalog)
- `docs/specs/WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md`, ADR 0030 (substrate; not a
  sandbox)
- `docs/specs/SAFE_EXECUTION_POLICY_SPEC.md`, ADR 0011 (action types, risk levels,
  approval/blocking)
- `docs/adr/0031-autonomous-loop-governance.md` (autonomous merge; R-GOV-5)
- `docs/context/TRIFORGE_PROJECT_VISION.md` §13, §18, §19, §25
- `docs/context/TRIFORGE_RISK_REGISTER.md`
- `docs/instrucciones.md` §12 (A0.5 mandate), §17 (A5 prerequisites)
