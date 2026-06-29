# ADR 0044: Writable E2E (mock-first) — the functional MVP (A5.9)

## Date

2026-06-29

## Status

Accepted

Ninth sub-decision of Milestone A5 and the MVP closure. Composes ADR 0036–0043 (the
A5.1–A5.8 stack) into one orchestrated writable run. Mandate §A5.9. Component spec:
`WRITABLE_EXECUTION_SPEC.md` §A5.9.

## Context

A5.1–A5.8 each delivered one writable-execution control with its own tests. The MVP
requires showing they COMPOSE: a real low-risk task driven from worktree creation to a
governed merge, with the security controls holding at the seams, and with the
providers stubbed (the real pilot is A5.10). The composition is where integration bugs
hide — exactly what the E2E must surface.

## Decision

1. **A single orchestrator wires the whole stack.** `runWritableTask` composes
   WorktreeManager (A5.1), ownership + role gate (A5.4), allowed-path (A5.2) and
   command (A5.3) policies bound to the worktree, the mutation ledger + reconcile
   (A5.5), the quality-gate runner + tampering (A5.6), the repair loop (A5.7) and the
   governance gate (A5.8). The owner and reviewer "intelligence" are INJECTED; the
   infrastructure is real, including a real git worktree, commit and merge.

2. **The owner can only write through a path/role-checked channel.** The owner's
   `write` goes through `RoleEnforcer.authorizeWrite` (owner + lease + writePaths) and
   records every mutation in the ledger; an out-of-bounds write is structurally
   impossible, and an out-of-band write (bypassing the channel) is caught by
   reconciliation as tampering.

3. **Merge only on a re-derived `merge` verdict.** After the loop, the orchestrator
   re-derives the change set, reconciliation, gate result and tampering report and
   asks the governance gate; only `merge` triggers the commit + governed merge into
   the base branch, then cleanup. `main`/the live tree are never written directly.

4. **Fix integration bugs the E2E surfaces in this PR.** The E2E caught a fail-closed
   bug in A5.5 `computeWorktreeChanges` (a wholly-new untracked directory collapsed to
   `dir/`); it is fixed here (`--untracked-files=all`) with a regression test, rather
   than deferred.

## Alternatives

1. **Declare the MVP from the unit tests alone.** Rejected: composition bugs (the
   directory-collapse one) only appear end to end; the mandate requires an executable
   E2E demonstration.
2. **Use real providers now.** Rejected for A5.9: the real pilot is A5.10 and is gated
   on CLI version/auth verification; the MVP is demonstrated mock-first per the mandate
   so it does not depend on unverified provider capability.
3. **Skip the negative cases.** Rejected: the MVP must show the gate BLOCKS tampering /
   failing gates / out-of-bounds writes, not only the happy path.

## Consequences

### Positive

- The functional MVP is demonstrated by executable evidence: a real task completes
  under a single owner, read-only reviewer, repair loop, gates, governance and a
  governed merge; the negatives block; `main` is never touched directly.
- An integration bug in a merged milestone was caught and fixed with a regression test.

### Negative

- Owner/reviewer are mocks; the real provider pilot (A5.10) is still required to close
  the "real writable run" claim, and may stay blocked if CLI capability cannot be
  safely verified.
- The orchestrator is a first composition; A6 routing and A8 UI will wrap/replace parts
  of it.

## Risks

- **R-GOV-1** (a bad change reaches main) — demonstrated controlled: tampering / failing
  gates / out-of-bounds writes all block the merge end to end.
- **R-PRV-1** (provider capability unverified) — the MVP does not depend on it; A5.10
  carries the verification and may remain blocked.

## Conditions to Revisit

- A5.10 wires a real provider as the owner on a controlled fixture.
- A6 routing / A8 UI consume or wrap `runWritableTask`.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.9
- `docs/adr/0036..0043` (the A5.1–A5.8 stack)
- `apps/api/src/execution/e2e/` (orchestrator + E2E tests)
