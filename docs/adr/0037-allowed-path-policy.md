# ADR 0037: Allowed-Path Policy (A5.2)

## Date

2026-06-29

## Status

Accepted

Second sub-decision of Milestone A5. Builds on ADR 0036 (worktree manager — the
workspace the policy contains) and ADR 0032 + `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md`
(T-FS-01..08, SAT-A5-1/2/3, the binding closure rule). Component spec:
`docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.2.

## Context

A5.1 gives the owner an isolated worktree; A5.2 must decide which paths inside it the
owner may read or write. The threat model already `DECIDED` the controls
(normalize→realpath→containment, symlink/hardlink/traversal handling, `.git`
blocking) but left them `PLANNED`. The defining tension is T-FS-08: the worktree
lives **under `$HOME`** (the managed state root), so a naive "block `$HOME`,
`/mnt/c`, other worktrees" enumeration would either be self-defeating (it would
block the workspace itself, which is under `$HOME`) or leave gaps (any root not
enumerated is reachable).

## Decision

1. **Allow-list by containment, not block-list by enumeration.** The single positive
   rule is: a path is allowed only if, after `path.resolve` against the canonical
   workspace root **and** realpath canonicalization, it stays inside
   `realpath(workspaceRoot)` and clears the per-policy gates. `/mnt/c`, `$HOME`,
   sibling worktrees, the state root and the shared `.git` object store are all
   *outside* the workspace and therefore denied by containment — no blanket-`$HOME`
   block (which would block the workspace) is needed.

2. **Canonicalize before deciding; validate non-existent targets via their ancestor.**
   Resolve `..` lexically, then realpath the nearest existing ancestor and require
   containment (catches a symlinked ancestor and safely handles a not-yet-created
   write target); if the full target exists, realpath it and re-check (symlinked
   leaf). Return the canonical `realPath`; callers MUST open that, not re-resolve the
   input, to shrink the check→open TOCTOU window.

3. **Conservative hardlink-write refusal.** A write to a multiply-linked file
   (`nlink > 1`) is refused (T-FS-04): a freshly checked-out worktree has no
   legitimate hardlinks, so a hardlinked write target is treated as a clobber attempt.

4. **`.git` is never accessible; `blockedPaths` always win; gating is segment-aware.**
   Any `.git` path segment is blocked case-insensitively (the gitdir link + the shared
   object store). `blockedPaths` override read/write. `readPaths`/`writePaths` match by
   path **segment** prefix (`src` does not match `srcfoo`). `maxFilesChanged` bounds
   distinct canonical write targets. Every decision is audited; all denials are typed.

## Alternatives

1. **Block-list of dangerous roots (`$HOME`, `/mnt/c`, `.ssh`, …).** Rejected: the
   workspace is *under* `$HOME`, so a `$HOME` block is self-defeating, and any
   un-enumerated root is a gap. Containment is complete by construction.
2. **String/lexical containment only (no realpath).** Rejected: a symlinked ancestor
   or leaf escapes lexical containment (T-FS-01/02). Realpath of the existing chain is
   required.
3. **Glob-based path matching.** Rejected for the MVP: globs add ReDoS/ambiguity
   surface; segment-aware prefix matching is sufficient and unambiguous. Globs can be
   revisited if a real need appears.
4. **Block all hardlinks (read + write).** Rejected: read-through-hardlink leak is
   rarer and blocking all `nlink>1` reads is over-broad; the write clobber is the
   high-impact case. The read-leak residual is recorded for A9.

## Consequences

### Positive

- A single, auditable positive rule (containment) closes the whole class of
  out-of-workspace escapes, including the T-FS-08 `$HOME` carve-out, without a
  brittle block-list.
- Symlink ancestor/leaf, traversal, prefix-confusion, hardlink-write and `.git`
  access are all refused with executable SAT evidence.

### Negative

- A check→open TOCTOU window remains (RR-2): returning `realPath` shrinks but does
  not close it; open-time `O_NOFOLLOW`/`openat` hardening is A9.
- Hardlink **read** leak is not blocked (only writes).
- Case-insensitive containment beyond the `.git` block is not enforced; the substrate
  target is Linux/WSL2 (case-sensitive), so this is acceptable for the MVP.

## Risks

- **R-SEC-4** (path escape → host) — directly mitigated for owner reads/writes by
  containment; residual RR-4 (no OS sandbox) accepted.
- **R-SEC-3** (untrusted repo content) — a symlink/hardlink planted in the tree
  cannot be used to escape the workspace on read/write.

## Conditions to Revisit

- A9 adds open-time TOCTOU hardening, superseding the `realPath`-return mitigation.
- A case-insensitive substrate is supported, requiring case-folding containment.
- A real need for glob path policies appears.

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.2
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-FS-01..08),
  §10.2 (SAT-A5-1/2/3), §11 (binding)
- `docs/adr/0036-writable-execution-worktree-manager.md`
- `apps/api/src/execution/path/` (implementation + tests)
