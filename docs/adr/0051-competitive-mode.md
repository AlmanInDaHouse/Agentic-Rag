# ADR 0051: Competitive Mode (A7.1)

## Date

2026-06-29

## Status

Accepted

First sub-decision of Milestone A7. Composes the A5 writable-execution stack into a
two-candidate competition. Mandate §9 / §A7. Component spec:
`COMPETITIVE_MODE_SPEC.md`.

## Context

For high-value tasks the owner may want two providers to each attempt the work and pick
the better result. This must be done WITHOUT letting the candidates contaminate each
other, and the winner must be chosen by re-derived evidence — not by which output reads
better or a majority vote. It must be opt-in and budget-gated (it costs ~2× a single
run, with no paid fallback).

## Decision

1. **Reuse A5.9 per candidate, isolated.** Each candidate runs the full
   `runWritableTask` pipeline in its OWN worktree (distinct `runId`), with
   `autoMerge:false`/`autoCleanup:false` so both stay isolated and unmerged until the
   selection. The candidates share the task/spec/policy/gate harness but have
   independent worktrees, ledgers and reviewers — no mutual access, no artifact
   contamination.

2. **Opt-in + budget gate.** The run refuses unless explicitly opted in and the budget
   funds BOTH candidates; no paid fallback.

3. **Select by re-derived evidence.** Each candidate is scored from its governance
   verdict, findings, tampering and change size — never narrative or majority. Only a
   `merge`-verdict candidate is eligible; the higher score wins. The winner's
   `GovernanceDecision` is the selection's evidence.

4. **Merge only the winner; clean up both.** The winner's branch is merged; both
   worktrees are removed (the loser's evidence preserved in its report first).

## Alternatives

1. **Pick by output length / style / a model's opinion.** Rejected by the mandate —
   selection must be evidence-based, not narrative or majority.
2. **Run candidates in a shared worktree.** Rejected: they would contaminate each
   other; isolation is the whole point.
3. **A new spawner for competition.** Rejected: `runWritableTask` already encapsulates
   the safe pipeline; competition composes it.

## Consequences

### Positive

- Two providers can compete safely and the better result is selected by re-derived
  evidence and governed-merged; the loser is discarded with its evidence preserved.

### Negative

- It costs ~2× a single run (budget-gated); the comparative metric set is currently a
  re-derived subset (verdict/findings/size), to be enriched by A6.4 metrics.

## Risks

- **R-GOV-1** (a bad change reaches main) — the same A5 controls apply per candidate;
  only a `merge`-verdict candidate can win.
- **cross-candidate contamination** — prevented by per-candidate isolated worktrees,
  ledgers and reviewers.

## Conditions to Revisit

- A richer comparative metric set is instrumented (A6.4).
- A8 surfaces the competition in the UI.

## References

- `docs/specs/COMPETITIVE_MODE_SPEC.md`
- `docs/adr/0036..0044` (A5 stack), `0050-protected-adaptive-router.md`
- `apps/api/src/execution/competitive/`, `apps/api/src/execution/e2e/writableRun.ts`
