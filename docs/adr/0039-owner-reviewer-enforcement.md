# ADR 0039: Owner/Reviewer Enforcement (A5.4)

## Date

2026-06-29

## Status

Accepted

Fourth sub-decision of Milestone A5. Composes ADR 0037 (allowed-path policy) and ADR
0038 (command policy) behind a role gate, and realizes Charter §4.7 ("one writable
owner") as enforced code. Threats: `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md`
T-INT-14/15; SAT-A5-8. Component spec: `WRITABLE_EXECUTION_SPEC.md` §A5.4.

## Context

The collaboration model (A4) and the autonomy charter both require that, within a
unit of work, exactly one agent has write authority and the other is a read-only
reviewer that can only produce findings. Until A5.4 this was a documented invariant
with no enforcement: any actor could, in principle, call the write/command paths. A
compromised or confused reviewer that writes — or two actors racing to own the same
unit — would defeat the attribution and integrity the governance gate (A5.8) depends
on (T-INT-14/15).

## Decision

1. **A per-unit owner lease is the single source of truth for write authority.**
   `acquire` grants it only when unowned (idempotent for the same actor); a different
   actor is refused (two-owner race blocked). It is stored per `(runId, taskId)`.

2. **Ownership changes only explicitly and audited.** The current owner may
   `reassign` to another actor with a reason; a non-owner cannot. There is no
   implicit transfer, so a reviewer never silently becomes the owner. `release` is
   owner-only and idempotent.

3. **A role gate composes the path + command policies.** The owner (holding the
   lease) may read, write within `writePaths`, and run any command the command policy
   permits. The reviewer may read and run only `read_only` commands; a reviewer write
   or non-read-only command is denied with a typed reason, and an owner-role actor
   without the lease is denied `not_owner`. Defense in depth: the role check precedes
   the lease check, so even a reviewer that somehow held a lease cannot write.

4. **Every decision is role-bound.** Each decision carries `{actorId, role, unit}`
   and the underlying path/command decision, and is audited — so events, artifacts
   and the future mutation ledger (A5.5) / governance decision (A5.8) can attribute
   each effect to an authenticated role.

## Alternatives

1. **Trust the orchestrator to call only the right paths.** Rejected: the invariant
   must be enforced at the boundary, not assumed by the caller, because the caller
   (a provider-driven runtime) is itself untrusted output (Vision §19).
2. **Bake the role into the lease (a "reviewer lease").** Rejected as the primary
   mechanism: roles are per-action declarations, and the role gate already denies
   reviewer writes regardless of lease; a role-typed lease adds state without closing
   a hole. Left as a possible future hardening.
3. **Separate write-token per file.** Rejected as over-engineered for the MVP; a
   single per-unit owner lease matches the collaboration model and is auditable.

## Consequences

### Positive

- "One writable owner / read-only reviewer" is now enforced and tested, not just
  documented — a reviewer write and a two-owner race are both blocked and audited.
- The role binding gives the governance gate (A5.8) an attributable chain from each
  effect back to an owner identity and an authorizing decision.

### Negative

- The lease is role-agnostic, so the run wiring (A5.9) must acquire the lease for the
  owner actor at run start; a stray reviewer `acquire` would hold a harmless lease
  (its writes are still denied) but could block the real owner until reassigned.
- Actor identity here is a logical id, not yet an authenticated channel; binding the
  approval to an authenticated approver is the auth-milestone concern (R-SEC-9).

## Risks

- **R-GOV-1 / R-SEC-6** (a bad change reaches main / forgeable governance) — reduced:
  every mutating action is owner-gated and role-bound, feeding attributable evidence
  to the A5.8 gate.
- **R-SEC-9** (approval unauthenticated) — not yet closed; A5.4 binds a logical role,
  the authenticated approver channel is a later auth milestone.

## Conditions to Revisit

- A5.5/A5.8 land and consume the role binding (mutation attribution, governance).
- An authenticated actor channel is introduced (then the logical actor id becomes an
  authenticated identity, closing part of R-SEC-9).

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.4
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-INT-14/15), §10.2 (SAT-A5-8)
- `docs/adr/0037-allowed-path-policy.md`, `0038-safe-command-policy-process-supervision.md`
- `docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §4.7
- `apps/api/src/execution/role/` (implementation + tests)
