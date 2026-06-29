# Writable Execution Spec (A5)

**Status:** Active — grows across A5.1–A5.10.
**Authority:** Owner mandate `docs/instrucciones-a5-a9.md` §6/§7; ADR 0031
(autonomous governance); ADR 0032 + `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md`
(the binding closure rule); ADR 0036 (worktree manager).
**Supersedes:** nothing. Complements ADR 0011 (Safe Execution Policy) and ADR 0030
(WSL2 substrate).

A5 introduces TriForge's **first real repository writes** and defines the functional
MVP. This is the highest-risk milestone: it is split into reviewable sub-PRs, each
keeping `main` green, and **every writable capability is bound to the six-field
closure rule before it is enabled** (`{threat, control, milestone, verification,
recovery, residual risk}`; threat-model §11). A capability that cannot fill all six
fields is not authorized.

## 0. Architecture

Writable-execution runtime lives under `apps/api/src/execution/` (a new domain,
separate from `providers/`). Sub-pieces:

| Piece | Component | Status |
|---|---|---|
| A5.1 | Worktree Manager (`execution/worktree`) | **this PR** |
| A5.2 | Allowed-Path Policy | planned |
| A5.3 | Safe Command Policy + Process Supervision | planned |
| A5.4 | Owner/Reviewer enforcement | planned |
| A5.5 | Diff Capture + Mutation Ledger | planned |
| A5.6 | Quality Gate Runner | planned |
| A5.7 | Repair Loop | planned |
| A5.8 | Autonomous Governance Decision | planned |
| A5.9 | Writable E2E fixture (mock-first) | planned |
| A5.10 | Low-risk real provider pilot | planned (gated on A5.1–A5.9 green) |

Real provider writes remain **unauthorized** until A5.1–A5.9 are merged & green and
the per-capability binding is satisfied. The MVP E2E (A5.9) is demonstrated with the
**mock** adapter first; the real pilot is A5.10.

---

## A5.1 Worktree Manager

### Objective

Administer isolated Git **linked worktrees** so owner agents can make real writes
without ever touching the primary working tree or `main`.

### Scope / non-goals

- **In scope:** worktree lifecycle (create/inspect/list/cleanup/cancel), per-run &
  per-task ownership, persistent metadata, stale detection, crash recovery, disk
  limits, collision prevention, an append-only audit trail, the hardened git
  boundary for the manager's own ops, and the baseline path/symlink containment for
  the manager's own state paths.
- **Non-goals (later sub-pieces):** the full Allowed-Path Policy
  (`readPaths/writePaths/blockedPaths/maxFilesChanged`, `.git`/home/external
  blocking, full TOCTOU) is **A5.2**; Safe Command Policy / `.gitattributes`
  smudge-filter neutralization is **A5.3/A5.4**; the mutation ledger is **A5.5**.

### Design (see ADR 0036)

- **External state root** (substrate §8.4): default
  `${XDG_STATE_HOME:-$HOME/.local/state}/triforge` (injectable; tests use a temp
  dir), **outside** the primary working tree so the Code Graph scanner / Context
  Engine never walk managed state (T-FS-08). Layout:
  `…/worktrees/<runId>/<taskId>/` (the worktree), `…/meta/<runId>/<taskId>.json`
  (metadata, kept OUT of the worktree), `…/audit.log` (append-only JSONL).
- **Never `main`:** every worktree is created on a NEW branch
  `triforge/<runId>/<taskId>` from a base commit (`git worktree add -b …`).
  Protected branch names (`main`/`master`/`HEAD`) are refused.
- **Hardened git** (`GitRunner`/`NodeGitRunner`): every managed git op runs with the
  shell disabled, an explicit argv, an env allowlist (no credential-shaped names),
  an output cap and a timeout — and with git's code-execution mechanisms
  neutralized: `core.hooksPath` → an empty, **user-owned** dir (no hook runs, so the
  checkout `git worktree add` performs cannot fire `post-checkout`),
  `core.fsmonitor=false`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<empty file>`,
  `GIT_TERMINAL_PROMPT=0`.
- **Containment:** ids are charset-validated (`^[A-Za-z0-9][A-Za-z0-9._-]{0,126}…$`,
  no separators / `..`); the resolved worktree path must stay inside the worktrees
  root; an existing ancestor that is a symlink escaping the root is refused.
- **Ownership / recovery:** metadata stamps the owner pid; a worktree whose owner is
  no longer alive is `stale`; `recoverStale()` removes stale worktrees and prunes
  git admin state (crash recovery). Owner-liveness is an injectable predicate.
- **Disk limits / collision / audit:** a create over the managed-byte budget is
  refused; a path present without owning metadata is a collision; a known run/task
  is a reuse refusal; every create/cleanup/cancel/recover/refuse is audited.

### Typed errors

`invalid_id`, `invalid_repo`, `dirty_base`, `branch_conflict`, `worktree_exists`,
`collision`, `unsafe_path`, `symlink_escape`, `protected_branch`, `disk_limit`,
`git_failed`, `not_found`, `fs_failed`.

### Acceptance criteria (all demonstrated by `worktreeManager.test.ts`, 19 tests)

create · inspect · list · reuse rejection · collision · cleanup (idempotent) ·
branch conflict · dirty base (refused when required / allowed by default) · invalid
id (path-escape) · protected branch (never `main`) · symlink escape · hardened-git
hook NON-execution (positive+negative control) · audit trail · stale detection ·
crash recovery (idempotent) · invalid repo · git-failure mapping + partial cleanup ·
disk-limit refusal.

### Capability binding (threat-model §11.2)

A5.1 does **not** itself enable a provider write; it enables the **managed
worktree-lifecycle capability** the writable MVP builds on. Binding:

| Field | Content |
|---|---|
| **Capability** | TriForge creates/administers an isolated linked worktree on a new branch in an external state root, via hardened git, for an owner agent to later write into. |
| **Threat(s)** | T-FS-08 (worktree under `$HOME`, shared object store), T-GIT-01 (hook on `git worktree add` checkout), T-GIT-02/03 (execute-on-read fsmonitor/global config), T-FS-03/07 (path traversal / out-of-workspace) — baseline for the manager's own paths. |
| **Control(s)** | External state root outside the working tree (`defaultStateRoot`, injectable); new-branch-only + protected-branch refusal; hardened `NodeGitRunner` (hooks→empty user-owned dir, fsmonitor off, system/global config stripped, no credential env, output cap, timeout); id charset validation + path containment + symlink-escape refusal. **Implemented** in `execution/worktree/{gitRunner,worktreeManager}.ts`. |
| **Milestone** | A5.1 (this PR). |
| **Verification** | `worktreeManager.test.ts` (19): real-git lifecycle, the hook-non-execution SAT (SAT-A5-5 baseline), the protected-branch / never-main guard (SAT-A5-10 partial), symlink-escape and out-of-base isolation (SAT-A5-2/3 baseline). |
| **Recovery** | `cleanup`/`cancel` remove the worktree + branch (git-consistent) and metadata; `recoverStale` reaps dead-owner worktrees and prunes; partial `git worktree add` failures are cleaned up before surfacing a typed error; the audit log records every action. |
| **Residual risk** | RR-2 (TOCTOU between the symlink check and `git worktree add`); RR-4 (no OS sandbox — a path escape still reaches the host). The worktree's `.git` + shared object store and the full allowed-path policy are **A5.2/A5.3**; `.gitattributes` smudge-filter neutralization is **A5.4**; owner-pid reuse can mask a stale worktree (conservative: it is never deleted as live). Accepted for the MVP, owner. |

### Open follow-ups for later A5 sub-pieces

- A5.2/A5.3: block every worktree's `.git`/`.git/objects`, sibling worktrees, the
  state root, `$HOME` and `/mnt/c`; full normalize→realpath→containment→symlink/
  hardlink/TOCTOU on owner read/write paths.
- A5.4: `.gitattributes` filter/diff/merge-driver neutralization on managed checkout.
- A5.5: the mutation ledger computed from the real worktree (supersedes the A5.1
  audit log for write attribution).
