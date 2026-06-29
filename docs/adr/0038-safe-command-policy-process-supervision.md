# ADR 0038: Safe Command Policy + Process Supervision (A5.3)

## Date

2026-06-29

## Status

Accepted

Third sub-decision of Milestone A5. Builds on ADR 0036 (worktree — the cwd that
commands are contained to), ADR 0037 (allowed-path policy — the file boundary), ADR
0034 (the A3 `ProcessRunner` process model this reuses) and ADR 0011 (Safe Execution
Policy — the *action-type* policy this complements but does not replace). Threats:
`PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` T-EXE-01/02/09, T-CMP-06; SAT-A5-4.
Component spec: `WRITABLE_EXECUTION_SPEC.md` §A5.3.

## Context

Owner agents will need to run real commands (tests, builds, formatters, local git)
inside a worktree. The two failure modes to design against are (a) running a
*dangerous* command (destructive/privileged/network/unknown) and (b) failing to
*contain and reap* a running command (orphaned process trees, runaway output,
hangs). ADR 0011's `SafeExecutionPolicyService` classifies high-level *action types*
in the mock runtime; it does not look at a concrete binary+argv, and the only real
process-spawning code with a sound model is the A3 `NodeProcessRunner` (process
group, SIGTERM→grace→SIGKILL, env allowlist, output cap, timeout) — which has had no
automated process-group coverage.

## Decision

1. **A deny-by-default command classifier.** Classify a concrete `{bin, args}` into
   one of eight categories; an unknown binary (and bare `node`) is `blocked`. A run
   permits only an explicit set of categories (default
   `read_only`/`test`/`build`/`write_local`); `network`/`destructive`/`privileged`
   are opt-in or refused.

2. **Never use a shell.** Commands are always spawned directly with a separated argv
   (`shell:false`). Shell metacharacters in an argument are therefore inert literal
   data — no command injection is possible — and the classifier inspects the command
   STRUCTURALLY, so it cannot be fooled by metacharacters (T-EXE-01/02, T-CMP-06).

3. **Refine dual binaries by argv; fail closed.** `git` and the node package managers
   map to different categories by subcommand/flags. Unusual flag forms that the
   refiner cannot parse classify as `blocked` (fail closed — never over-allow).

4. **Supervise via the reused A3 `ProcessRunner`, not a new spawner.** The supervisor
   composes the policy gate with `NodeProcessRunner`: a denied command never spawns;
   an allowed one runs with the substrate process model and is reduced to a single
   terminal result with separated/capped stdout-stderr, idempotent cancellation
   (group kill) preserving partial evidence, and an audit record. cwd is contained to
   the worktree.

5. **Add real-process supervision tests.** Cross-platform cancel/timeout against a
   real process, and a POSIX process-GROUP orphan-reaping test (a non-detached child
   is killed with its parent's group, so its delayed sentinel is never written) —
   closing the prior gap where the group model had only manual smoke coverage.

## Alternatives

1. **Extend `SafeExecutionPolicyService` (ADR 0011).** Rejected: that policy is the
   mock-runtime *action-type* classifier; concrete-command classification + real
   supervision is a different concern and a different layer (`execution/`).
2. **Allow a shell with sanitization.** Rejected outright: a shell re-introduces the
   injection surface the no-shell model eliminates (T-CMP-06). Argv is always
   separated.
3. **Allow-list specific argv strings instead of categories.** Rejected: brittle and
   unmaintainable; category classification with conservative fail-closed refinement
   is simpler and safer.
4. **Build a new process spawner for A5.3.** Rejected: the A3 `NodeProcessRunner`
   already implements the substrate process-group model correctly; re-building it
   would duplicate the highest-risk code. A5.3 reuses it and finally tests it.

## Consequences

### Positive

- A dangerous command is refused before any spawn; an unknown binary is denied by
  default; metacharacters cannot inject.
- The process-group orphan-reaping that prevents runaway trees now has executable
  evidence (was manual-smoke only).

### Negative

- Conservative refinement may over-block unusual-but-legitimate invocations (e.g.
  `git -C x status`); it never over-allows. Widening is a deliberate, reviewable
  change to the classification tables.
- `durationMs`-style real timing needs a system clock; the injected `Clock` is
  deterministic, so timing fields are recorded as ISO stamps, not measured millis,
  for now.

## Risks

- **R-SEC-5** (env leakage) — the supervisor forwards only an env allowlist to the
  child (credential names dropped by `NodeProcessRunner`); residual is the allowlist
  being mis-set, reviewed per run.
- **R-SEC-3 / R-SEC-4** (untrusted content / path escape) — a command's cwd is
  contained to the worktree; file effects are still gated by the A5.2 path policy at
  the write sites (A5.4).

## Conditions to Revisit

- A5.4 binds command execution to the single writable owner (reviewer read-only).
- A real need for a category not in the table appears (extend the tables + tests).
- A system clock is introduced for measured command durations.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.3
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-EXE/T-CMP), §10.2 (SAT-A5-4)
- `docs/adr/0011-safe-execution-policy.md`, `0034-real-read-only-provider-adapters.md`,
  `0036-writable-execution-worktree-manager.md`, `0037-allowed-path-policy.md`
- `apps/api/src/execution/command/` (implementation + tests)
