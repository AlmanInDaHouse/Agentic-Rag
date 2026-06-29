# ADR 0043: Autonomous Governance Decision (A5.8)

## Date

2026-06-29

## Status

Accepted

Eighth sub-decision of Milestone A5. Realizes ADR 0031's autonomous merge gate as
enforced code, consuming ADR 0040 (ledger reconcile), ADR 0041 (real gate result) and
ADR 0042 (repair terminal state). Threats:
`PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` T-INT-01/02/04/10/11. Component spec:
`WRITABLE_EXECUTION_SPEC.md` §A5.8.

## Context

ADR 0031 removed the mandatory human commit gate for ordinary changes; the merge must
now be decided autonomously, and ADR 0032 requires that decision to be computed from
re-derived evidence rather than provider narrative. The remaining risks are integrity
ones: a self-certified governance artifact (T-INT-01/04), a compromised reviewer
(T-INT-02), and an approval that is not bound to the executed diff or is replayed
(T-INT-10/11).

## Decision

1. **Verdict from re-derived evidence only.** `decideVerdict` consumes the A5.5
   ledger-reconciliation result, the A5.6 real gate status + tampering report, and the
   A5.7 repair terminal state — never a provider's claim. The verdict is
   `merge | reject | repair | block | cancel`.

2. **Hard merge preconditions, failing closed.** `merge` requires ALL of: repair
   `accepted`; gates `passed`; ledger reconciled (not tampered); no gate-tampering; no
   open blocker/critical finding; `gateTestedDiffHash === diffHash`. Any failure
   downgrades to `block`/`reject`. Integrity checks dominate the `accepted` state, so an
   accepted run with a tampered ledger still blocks.

3. **Bind the decision to the exact state; verify before acting.** The record binds the
   diff hash, ledger head hash and gate-result hash. `verifyDecisionBinding` re-checks
   these against the current state before any action, refusing approval replay, a
   decision over a different diff, a diff modified after the decision, and expired
   gates.

4. **Emit the A1 artifact; keep human override available.** `buildGovernanceDecision`
   produces a schema-valid A1 `GovernanceDecision` plus the richer record. Human
   override remains the owner's external authority (stop/reject) but is not required
   for an ordinary merge.

## Alternatives

1. **Trust a provider-emitted `GovernanceDecision`.** Rejected: it is the exact
   self-certification surface (T-INT-01/04). The gate re-derives the verdict.
2. **Decide from gate status alone.** Rejected: a green gate on a tampered ledger or a
   stale diff would merge a bad change; integrity reconciliation and diff binding are
   required preconditions.
3. **Keep a mandatory human approval.** Rejected by ADR 0031 for ordinary changes;
   retained only as a non-mandatory override.

## Consequences

### Positive

- The merge verdict is grounded in re-derived, hash-bound evidence; replay,
  diff-swap and stale-gate attacks are refused; integrity failures dominate.
- The decision is a schema-valid A1 artifact, auditable and bound to its capability.

### Negative

- Actor identities are logical, not yet cryptographically authenticated (R-SEC-9); a
  forged actor id is not yet caught here (the auth milestone closes this).
- The verdict is only as good as the inputs; the wiring (A5.9) must compute them from
  the real components, not pass through provider claims.

## Risks

- **R-GOV-1** (a bad change reaches main) — strongly mitigated: merge requires all hard
  preconditions; integrity violations block.
- **R-SEC-6/R-SEC-9** (forgeable artifacts / unbound approval) — mitigated for replay,
  diff-binding and expired gates; the authenticated approver channel remains future.

## Conditions to Revisit

- An authenticated actor channel is introduced (R-SEC-9).
- A5.9 wires the full pipeline and exercises the gate end-to-end over the mocks.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.8
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-INT-01/02/04/10/11)
- `docs/adr/0031-autonomous-loop-governance.md`, `0040-..`, `0041-..`, `0042-repair-loop.md`
- `apps/api/src/execution/governance/` (implementation + tests)
