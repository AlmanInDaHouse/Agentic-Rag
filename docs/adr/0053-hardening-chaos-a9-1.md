# ADR 0053: Hardening approach + A9.1 failure & chaos testing (A9)

## Date

2026-06-30

## Status

Accepted

First decision of Milestone A9 (Hardening + release candidate). Establishes the hardening
approach and delivers A9.1 Failure & Chaos testing. Mandate §11. Component spec:
`HARDENING_SPEC.md`.

## Context

The A5–A8 runtime + UI are functionally complete. Before a release candidate, the runtime
must be shown to survive its failure surface (mandate §11) — provider crashes, malformed
events, auth/quota failures, timeouts, ignored cancellation, corrupted artifacts, stale
worktrees, etc. — by DETECTING, BOUNDING and RECOVERING, never crashing or fabricating a
success (no false-green). Many failure modes are already covered by per-component tests;
A9.1 adds a focused, composed chaos suite that injects failures into the real components
and asserts bounded terminal outcomes.

## Decision

1. **Compose real components under injected failure.** A9.1's chaos suite drives the real
   A5 repair loop + ledger reconciliation, A6 quota-aware routing, and the A1 event
   contract with failure injections, asserting a bounded, recorded terminal state.

2. **Deterministic-first, real-process chaos guarded.** Chaos cases use the injected
   `ManualClock` and in-memory stubs so they are deterministic and host-independent.
   Real-process chaos (orphan reaping, group-kill on ignored cancellation) stays in the
   POSIX-guarded supervisor tests that run on CI Linux.

3. **No false-green is the invariant.** Every chaos case asserts the runtime reaches a
   bounded failure state (`failed`/`cancelled`/`rejected`/`exhausted`/`blocked`/
   `hard_stop`/`paused`/`tampered`) — never `accepted`/a fabricated route under failure.

4. **Coverage map maintained.** `HARDENING_SPEC.md` keeps a failure-surface → assertion
   map so A9 can show the full mandate §11 surface is covered (here or in a referenced
   component test).

## Alternatives

1. **Re-test each failure inside each component only.** Rejected: the composed chaos suite
   adds end-to-end "the runtime as a whole bounds this" assurance that isolated unit tests
   do not.
2. **Real-process chaos on every host.** Rejected: non-deterministic and unsupported on
   the Windows dev host; the POSIX-guarded supervisor tests already cover real processes
   on CI.

## Consequences

### Positive

- The runtime's failure handling is demonstrated end-to-end, deterministically, with a
  maintained coverage map — a prerequisite for the A9.9 release gate.

### Negative

- Deterministic chaos uses stubs for the failing component; real-process edge cases rely
  on the POSIX CI tests. The coverage map makes that split explicit.

## Risks

- **False-green (a fabricated success hiding a failure)** — directly countered: every
  chaos case asserts a bounded failure state, never acceptance.

## Conditions to Revisit

- A9.2–A9.9 extend hardening (security SATs, drift, recovery, observability, packaging).
- A real writable provider pilot (A5.10) would add live failure modes to chaos-test.

## References

- `docs/specs/HARDENING_SPEC.md` §A9 + §A9.1
- `apps/api/src/test/chaos.failureSurface.test.ts`
- A0.5 threat model; mandate §11
