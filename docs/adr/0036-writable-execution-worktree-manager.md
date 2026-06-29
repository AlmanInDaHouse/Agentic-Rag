# ADR 0036: Writable-Execution Worktree Manager (A5.1)

## Date

2026-06-29

## Status

Accepted

First sub-decision of Milestone A5 (Controlled Writable Execution). Builds on
ADR 0030 (WSL2-first substrate; §8.4 worktrees), ADR 0031 (autonomous governance),
ADR 0032 + `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` (the six-field binding closure
rule) and ADR 0034 (real read-only adapters' hardened `ProcessRunner`). The
component spec is `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.1.

## Context

A5 is the first milestone with real repository writes. Before any owner agent
writes a byte, TriForge needs a place for it to write that is **isolated from the
primary working tree and from `main`**, and the machinery that creates, owns, tracks
and tears down that place must itself be safe against the repository being untrusted
(ADR 0032). The substrate decision (ADR 0030 §8.4) already `DECIDED` that work never
happens on `main`, each implementation gets an isolated worktree, and worktrees live
in an **external, TriForge-managed state root** — but left the mechanism `PLANNED`
for A5.

Two facts shape the design:

- **A managed git operation is itself an attack surface.** `git worktree add`
  performs a checkout, which fires the `post-checkout` hook and applies
  execute-on-read config (`core.fsmonitor`, global/system config) — so creating a
  worktree on an untrusted tree can execute repository-controlled code
  (T-GIT-01/02/03) before the owner has written anything.
- **Worktree isolation is not object-store isolation.** Git linked worktrees share
  the canonical `.git` object store (T-FS-08); the state root sits under `$HOME`,
  which the allowed-path policy otherwise blocks, so the location needs a precise,
  external carve-out — and the worktree's `.git` must later be blocked by A5.2/A5.3.

## Decision

1. **An external, manager-owned state root.** Worktrees live at
   `${XDG_STATE_HOME:-$HOME/.local/state}/triforge/worktrees/<runId>/<taskId>`
   (injectable; tests inject a temp dir), with metadata in a sibling `meta/` tree
   (kept OUT of the worktree so it is never staged) and an append-only `audit.log`.
   This keeps managed state out of the working tree so the Code Graph scanner and
   Context Engine never walk it (T-FS-08; substrate §8.4).

2. **New-branch-only; never `main`.** Every worktree is created with
   `git worktree add -b triforge/<runId>/<taskId> <path> <baseCommit>`. The base
   repo's checked-out branch is never touched, and protected branch names
   (`main`/`master`/`HEAD`) are refused (SAT-A5-10 baseline).

3. **A hardened, injectable git boundary (`GitRunner`).** All managed git ops go
   through `NodeGitRunner` (the production impl) or `FakeGitRunner` (tests). Every
   invocation is hardened identically — hardening is intrinsic, not opt-in: shell
   disabled, explicit argv, env allowlist (credential-shaped names dropped),
   output cap, timeout, and git code-execution neutralized via
   `core.hooksPath=<empty user-owned dir>`, `core.fsmonitor=false`,
   `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<empty file>`,
   `GIT_TERMINAL_PROMPT=0` (T-GIT-01/02/03; T-CMP-07/08). The hardening dir is
   user-owned, never world-writable temp, so it cannot be used to plant a hook.

4. **Ownership, lifecycle, recovery.** Persistent metadata stamps the owner pid;
   stale = dead owner (injectable liveness predicate); `recoverStale()` reaps stale
   worktrees and prunes git admin state (crash recovery). Reuse/collision/disk-limit
   refusals, id charset validation, path containment and symlink-escape refusal, and
   an append-only audit trail complete the lifecycle. All failures are typed errors.

## Alternatives

1. **Nested worktrees under the working tree** (`.triforge/worktrees/...`). Rejected
   by substrate §8.4: the Code Graph scanner walks the tree recursively and would
   ingest managed state; nested linked worktrees risk git confusion and accidental
   cross-worktree staging.
2. **Shell out to `git` directly from the manager.** Rejected. It would inherit the
   `runner.ts` anti-patterns (full env, no hook neutralization) and make the
   highest-risk op untestable for failure injection. The injectable `GitRunner`
   mirrors the A3 `ProcessRunner` boundary and lets tests inject disk/fs failures.
3. **`rm -rf` for cleanup.** Rejected. `git worktree remove` keeps the shared object
   store and admin files consistent; a raw delete leaves dangling admin state that
   corrupts later worktree ops. The manager uses `git worktree remove` then `prune`,
   with a best-effort raw delete only as a fallback.
4. **Disable hooks with `core.hooksPath=/dev/null`.** Works on POSIX but not
   portably on win32 (local dev). Rejected in favor of an empty, user-owned hooks
   directory, which disables hooks identically on both platforms.

## Consequences

### Positive

- TriForge can create real, isolated worktrees on new branches without touching
  `main`, with crash recovery and an audit trail — the foundation the rest of A5
  builds on.
- The highest-risk git op (`worktree add` checkout) cannot execute
  repository-controlled hooks/config, demonstrated by a positive+negative SAT.
- The injectable boundary makes disk/fs/git failures deterministically testable.

### Negative

- Worktree isolation is not object-store isolation: the worktree's `.git` and the
  shared store still need A5.2/A5.3 path blocking. A5.1 alone is not a security
  boundary for owner writes — it is the substrate for one.
- A precise allowlisted carve-out inside an otherwise-blocked `$HOME` is
  error-prone (one normalization bug re-opens `$HOME`); the full enforcement is
  A5.2/A5.3.
- Owner-pid liveness can be fooled by pid reuse (conservative failure: a stale
  worktree is not deleted as live, never the reverse).

## Risks

- **R-SEC-4** (no OS sandbox; path escape → host) — A5.1 contains the manager's own
  paths; the owner-facing path policy is A5.2/A5.3; residual RR-4 accepted.
- **R-SEC-8** (git-mechanism code execution) — neutralized for managed worktree ops
  (hooks/global/system config); `.gitattributes` smudge filters remain A5.4.
- **R-GOV-1** (a defective change reaches `main`) — bounded: A5.1 writes only to
  external worktrees and new branches, never `main`.

## Conditions to Revisit

- The substrate decision (ADR 0030) changes the state-root location or the `$HOME`/
  `/mnt/c` exposure.
- A provider/TriForge gains a verified OS sandbox, changing RR-4.
- A5.2/A5.3 land and subsume the baseline path containment here (then this ADR's
  containment notes defer to the allowed-path policy).

## References

- `docs/specs/WRITABLE_EXECUTION_SPEC.md` §A5.1
- `docs/specs/WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md` §8.4 (worktrees)
- `docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §6 (T-FS-08, T-GIT-01/02/03),
  §10.2 (SAT-A5-2/3/5/10), §11 (binding closure rule)
- `docs/adr/0030-wsl2-first-local-execution-substrate.md`,
  `docs/adr/0032-untrusted-repository-and-provider-boundaries.md`,
  `docs/adr/0034-real-read-only-provider-adapters.md`
- `apps/api/src/execution/worktree/` (implementation + tests)
