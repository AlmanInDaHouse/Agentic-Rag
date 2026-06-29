# Competitive Mode Spec (A7)

**Status:** Active.
**Authority:** Owner mandate `docs/instrucciones-a5-a9.md` §9; ADR 0051. Composes the A5
writable-execution stack (ADR 0036–0044) and the A6 routing.

A7 runs the SAME task through two ISOLATED candidate worktrees (one per provider) and
selects the winner by re-derived comparative evidence — never by narrative or majority.
It is opt-in by policy and gated on sufficient budget.

## A7.1 Competitive run

### Objective

Given a task and two providers, produce two independent candidate implementations under
identical conditions, compare them on re-derived evidence, and merge only the winner.

### Design (`execution/competitive/competitiveRun.ts`; ADR 0051)

`runCompetitive(config)`:

1. **Policy + budget gate** — refuses unless `budget.optIn` and `availableUnits ≥
   requiredUnitsPerCandidate × 2` (the competition needs to fund BOTH candidates); no
   paid fallback.
2. **Two isolated candidates** — each runs the A5.9 `runWritableTask` pipeline (worktree
   → owner → path/command policy → ledger → gates → review → governance) with a DISTINCT
   `runId` (→ a distinct worktree), `autoMerge:false` and `autoCleanup:false`. The
   candidates share the SAME TaskSpecification, allowed-path policy, gate set and
   acceptance harness, but have INDEPENDENT worktrees, ledgers and reviewers (the
   reviewer is the OTHER provider) — no mutual access, no artifact contamination.
3. **Comparative selection** — each candidate is scored from RE-DERIVED evidence
   (governance verdict, findings by severity, tampering, change size), never narrative.
   Only a candidate whose governance verdict is `merge` is eligible; among those the
   higher score (fewer/lighter findings, smaller diff) wins.
4. **Governed merge of the winner only** — the winner's branch is merged into the base
   via the hardened GitRunner; its re-derived `GovernanceDecision` IS the selection's
   evidence. If neither candidate reaches a merge verdict, there is no selection.
5. **Cleanup both** — both candidate worktrees are removed (the loser's evidence is
   preserved in its report/ledger before cleanup).

### Capability binding (threat-model §11.2)

Competitive Mode adds no new writable primitive — it composes the already-bound A5
capabilities (worktree isolation A5.1, path/command policy A5.2/A5.3, ledger A5.5, gates
A5.6, governance A5.8) per candidate. Net-new control: **candidate isolation** (distinct
worktrees/ledgers/reviewers; no mutual access or artifact contamination) and **budget
gating** (opt-in; both candidates funded; no paid fallback). Threats: cross-candidate
contamination, selection-by-narrative. Verification: `competitiveRun.e2e.test.ts`.
Residual: the same RR-2/RR-4 as A5; the comparison metric set is a re-derived subset.

### Verification

`competitiveRun.e2e.test.ts` (3, real git): refuses when not opted-in or under-budget;
runs two isolated candidates and selects the better by re-derived evidence (smaller
diff), merging only the winner (the loser's extra file never reaches the base; both
worktrees cleaned up); selects NO winner when neither candidate reaches a merge verdict
(both tampered) — base unchanged.

### Open follow-ups

- A richer comparative metric set (security, complexity, maintainability, performance,
  wall-time) once those are instrumented (A6.4 metrics feed).
- A8 exposes the comparative report + selection in the UI.