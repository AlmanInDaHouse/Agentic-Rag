# ADR 0041: Quality Gate Runner (A5.6)

## Date

2026-06-29

## Status

Accepted

Sixth sub-decision of Milestone A5. Builds on ADR 0038 (the supervised command
boundary the gates run through) and ADR 0040 (the diff hash / worktree change set the
result binds to and tampering is detected from). Threats:
`PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` T-INT-04/07/08, T-GIT-07. Component spec:
`WRITABLE_EXECUTION_SPEC.md` §A5.6.

## Context

Under autonomous governance, the merge verdict is computed from re-derived evidence
(ADR 0032). "The tests pass" is a frequent provider claim and a prime spoofing target:
a compromised/confused provider can assert a green result it never produced
(T-INT-04), or make the run pass by DELETING tests or WEAKENING CI/gate scripts rather
than satisfying them (T-INT-07/08, T-GIT-07). The runtime therefore needs to (a) run
the gates itself from trusted config and read the real exit codes, and (b) detect
check-weakening in the change set.

## Decision

1. **Gate commands come from trusted configuration, never from provider output.** A
   `GateSpec` pairs an A1 `QualityGateName` with a `CommandSpec` from the repo/run
   config; the runner executes it through the A5.3 supervised command boundary.

2. **The verdict is the real exit code.** A gate is `passed` iff its command exits 0;
   a denied / timed-out / output-flooded / non-zero command is `failed`. A gate that
   cannot run is never silently passed. The overall status is `failed` if any gate
   failed, `passed` only if all passed, else `unknown` — an empty gate set is
   `unknown`, not `passed`.

3. **Bind the result to the tested diff.** The result carries the A5.5
   `testedDiffHash` and a per-gate output-artifact hash, so a green result cannot be
   replayed against a different diff and the captured output is referenceable without
   storing raw (possibly secret-bearing) streams.

4. **Detect check-weakening separately.** `detectGateTampering` flags deleted /
   renamed-away test files and changes to CI workflows / gate config / the root
   `package.json` gate scripts in the real worktree change set; a positive report is a
   governance blocker.

## Alternatives

1. **Accept the provider's `QualityGateResult`/`ImplementationResult.tests`.**
   Rejected: that is the exact self-certification surface (T-INT-04). The runner
   re-derives the verdict by executing the gates.
2. **A bespoke spawner for gates.** Rejected: the A5.3 `CommandSupervisor` already
   provides policy + supervision; gates reuse it so the same safety controls apply.
3. **Block on ANY CI/config change.** Rejected as too blunt — legitimate CI
   improvements happen. A5.6 SURFACES such changes as a tampering signal for the gate
   to weigh; the hard "no weakening" decision is the governance/CODEOWNERS layer.

## Consequences

### Positive

- A green verdict is grounded in real exit codes the runtime observed, not a claim;
  test deletion and CI weakening are surfaced as blockers.
- Results are diff-hash-bound, preventing stale-result replay (feeds A5.8).

### Negative

- Tampering detection is heuristic (path patterns); a check hidden behind a novel
  config path could be missed — the trusted gate set + CODEOWNERS on CI files are the
  backstop.
- Running gates is as expensive as the real commands; the runner is sequential for
  determinism (parallelism is a later optimization).

## Risks

- **R-GOV-3** (silent weakening of gates) — directly mitigated: weakening is detected
  and surfaced, and the verdict cannot be self-asserted.
- **R-SEC-7** (self-modifiable CI/gates) — partially mitigated in-tree (change
  detection); the branch-protection/workflow-integrity probe remains A9.

## Conditions to Revisit

- A5.8 consumes the result + tampering report as hard merge preconditions.
- A9 adds the workflow-integrity / branch-protection probes (R-SEC-7).
- Gate parallelism is introduced once determinism needs are met.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.6
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-INT-04/07/08, T-GIT-07)
- `docs/adr/0038-safe-command-policy-process-supervision.md`, `0040-diff-capture-mutation-ledger.md`
- `apps/api/src/execution/gates/` (implementation + tests)
