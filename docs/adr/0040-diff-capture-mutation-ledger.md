# ADR 0040: Diff Capture + Mutation Ledger (A5.5)

## Date

2026-06-29

## Status

Accepted

Fifth sub-decision of Milestone A5. Builds on ADR 0036 (worktree + hardened
`GitRunner`, reused to read the real tree) and ADR 0039 (owner attribution). Threats:
`PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` T-INJ-11, T-INT-04; SAT-A5-6. Component
spec: `WRITABLE_EXECUTION_SPEC.md` §A5.5.

## Context

Under autonomous governance the integration gate (A5.8) must decide a merge from
**re-derived evidence**, not from the provider's own narrative (ADR 0032). A provider
could emit a structured result claiming "I changed files X" while the worktree
actually changed Y — a forged/injected result (T-INJ-11), or a self-certified
integrity artifact the gate would wrongly trust (T-INT-04). The runtime therefore
needs (a) an independent, tamper-evident record of what it recorded changing, and (b)
a way to compare that record against the REAL worktree.

## Decision

1. **An append-only, hash-chained mutation ledger.** Each entry records the full
   provenance (run/task/owner/worktree/branch/file/operation/hash-before/after/
   command/tool/reason/tests/policy-decision/sequence/timestamp) and is chained:
   `entryHash = H(canonical(entry) || prevHash)`. `verifyChain` recomputes the chain
   so any in-place alteration or reorder is detected; `headHash` binds the recorded
   diff to the `GovernanceDecision`.

2. **Redact before persisting; truncate safely.** Secret-shaped content in the reason
   is masked before anything is written (key prefixes, `key/token/secret/password`
   assignments, PEM blocks), with a `reasonFullHash` over the original so integrity is
   preserved; oversized reasons are truncated with a marker, not dropped.

3. **Re-ground against the real worktree from git.** `computeWorktreeChanges` reads
   the working-tree-vs-HEAD changes via the hardened `GitRunner` with NUL-delimited
   porcelain (`-z`) and a content hash per file; `reconcile` flags any worktree change
   with no ledger entry, or a post-hash mismatch, as **unattributed → tampered**. The
   gate refuses a tampered run. `diffHash` gives a stable reviewed-diff hash so a
   post-review modification is detectable.

4. **Crash recovery that does not trust a broken chain.** The ledger persists to JSONL
   and `load` reconstructs it after a crash, **throwing** if the persisted chain fails
   verification rather than silently continuing.

## Alternatives

1. **Trust the provider's `ImplementationResult.filesChanged`.** Rejected: that is
   provider narrative and the exact spoofing surface (T-INJ-11, T-INT-04). Integrity
   must be re-derived from git.
2. **A plain (unchained) log.** Rejected: a plain log can be edited in place without
   detection; the hash chain makes the append-only history tamper-evident.
3. **Reuse the harness `secretScan` redactor.** It detects secrets in events and does
   not export a general-text redactor; extracting/sharing patterns is a worthwhile but
   separate refactor (noted as a small follow-up). A focused ledger redactor keeps
   A5.5 self-contained; `secretScan`'s NO_SECRET_LEAKAGE gate remains the backstop.
4. **`git diff` text as the unit of record.** Rejected as the primary key: a
   path+content-hash set is order-independent and cheap to reconcile; the raw diff can
   be referenced (`diffRef`) but the hashes drive integrity.

## Consequences

### Positive

- The governance gate can compute "does the recorded change set match the real
  worktree?" from independent evidence — a forged result or out-of-band mutation is
  caught and blocks the merge.
- The ledger is tamper-evident and crash-recoverable; secrets are redacted before
  they can be persisted.

### Negative

- The ledger redactor covers high-value secret shapes, not the full corpus; a novel
  shape could be persisted (the harness gate remains the detection backstop).
- `computeWorktreeChanges` shells out to git per reconcile; for very large trees this
  is O(changed files) hashing work (acceptable for the MVP's bounded changes).

## Risks

- **R-SEC-6** (forgeable self-certified integrity artifacts) — directly mitigated:
  integrity is re-derived from git and chained, not self-asserted.
- **R-GOV-1** (a bad change reaches main) — reduced: a tampered/unattributed run is
  blockable by the gate before merge.

## Conditions to Revisit

- A5.8 consumes `reconcile`/`headHash` as a hard merge precondition.
- The secret patterns are consolidated with `providers/harness/secretScan`.
- A content-addressed object store replaces per-file hashing for large trees.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.5
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-INJ-11, T-INT-04), §10.2 (SAT-A5-6)
- `docs/adr/0036-writable-execution-worktree-manager.md`, `0039-owner-reviewer-enforcement.md`
- `apps/api/src/execution/ledger/` (implementation + tests)
