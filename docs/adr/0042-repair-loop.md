# ADR 0042: Repair Loop (A5.7)

## Date

2026-06-29

## Status

Accepted

Seventh sub-decision of Milestone A5. Composes ADR 0039 (owner/reviewer), ADR 0041
(quality gates) and ADR 0040 (diff hash for progress detection) into the bounded
implement→gate→review→repair loop. Mandate §A5.7. Component spec:
`WRITABLE_EXECUTION_SPEC.md` §A5.7.

## Context

A writable run iterates: the owner implements, the gates run, the reviewer raises
findings, the owner repairs, and the gates run again. Without hard bounds this loop
can run forever — a provider that never converges, or a repeated-finding stalemate —
burning quota and wall-time. The mandate requires the loop to be bounded on every
axis and to ALWAYS terminate in a defined state.

## Decision

1. **Injected steps, loop-owned control.** The owner `implement`, `runGates` and
   reviewer `review` steps are injected; the loop owns only the control flow, the
   limits and the terminal-state decision. This lets the mock-first E2E (A5.9) wire
   real-ish mock providers while unit tests inject deterministic steps.

2. **Six terminal states, always reached.** Each run ends in exactly one of
   `accepted | rejected | blocked | exhausted | cancelled | failed`. `accepted` = gates
   passed and no blocker/critical/major; `blocked` = a blocker finding; `rejected` =
   no-progress; `exhausted` = a round/resource limit; `cancelled`/`failed` as named.

3. **Bounded on every axis + no-progress detection.** Hard caps on rounds, wall-time,
   commands, files changed, output bytes and quota; plus no-progress detection (the
   same diff hash, or the same finding signature, recurring for `noProgressLimit`
   rounds). The `for` loop is itself bounded by `maxRounds`, so termination is
   structural, not merely policy.

## Alternatives

1. **A `while (!done)` loop with ad-hoc breaks.** Rejected: easy to leave an
   unbounded path. A `for`-over-`maxRounds` with explicit limit checks makes
   termination structural.
2. **Bake the gate runner / providers into the loop.** Rejected: injection keeps the
   loop pure and testable, and lets A5.9 wire mocks and A6 wire routing without
   touching the loop.
3. **No no-progress detection (rely on the round cap).** Rejected: a stalemate would
   still burn the full round budget and quota; detecting a repeated diff/finding stops
   it early (mandate "repeated-finding / no-progress detection").

## Consequences

### Positive

- A run cannot loop forever; it converges, is rejected, is blocked, or hits a bound —
  always with a recorded terminal state and usage totals for the governance gate.
- The injected-step shape composes cleanly with A5.6 gates and the A5.9 mock E2E.

### Negative

- Wall-time uses the injected clock; production must inject a real clock for wall-time
  bounds to be meaningful (deterministic tests advance a manual clock).
- The no-progress heuristic could stop a run that was about to converge on the next
  round; `noProgressLimit` is tunable and the governance gate sees the history.

## Risks

- **R-PRV-2** (quota / runaway cost) — mitigated: quota and wall-time are hard caps.
- **R-GOV-1** (a bad change reaches main) — supported: an unresolved run terminates as
  rejected/blocked/exhausted, never silently accepted.

## Conditions to Revisit

- A5.8 consumes the terminal state as a governance precondition.
- A6 routing wires provider selection into the injected steps.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.7
- `docs/adr/0039-owner-reviewer-enforcement.md`, `0040-diff-capture-mutation-ledger.md`,
  `0041-quality-gate-runner.md`
- `apps/api/src/execution/repair/` (implementation + tests)
