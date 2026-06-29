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
| A5.1 | Worktree Manager (`execution/worktree`) | merged (ADR 0036) |
| A5.2 | Allowed-Path Policy (`execution/path`) | merged (ADR 0037) |
| A5.3 | Safe Command Policy + Process Supervision (`execution/command`) | merged (ADR 0038) |
| A5.4 | Owner/Reviewer enforcement (`execution/role`) | merged (ADR 0039) |
| A5.5 | Diff Capture + Mutation Ledger (`execution/ledger`) | merged (ADR 0040) |
| A5.6 | Quality Gate Runner (`execution/gates`) | **this PR** (ADR 0041) |
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

---

## A5.2 Allowed-Path Policy

### Objective

The first owner-facing security boundary: decide whether an owner agent may READ or
WRITE a given path inside an isolated worktree, enforcing
`{readPaths, writePaths, blockedPaths, maxFilesChanged}`.

### Model — allow-list by containment

The worktree lives under `$HOME` (the state root), so "block `$HOME`" cannot be a
blanket rule (T-FS-08). The model is therefore a precise allow-list carved INSIDE an
otherwise-blocked filesystem: the **only** thing allowed is a path that, after full
canonicalization, stays inside the workspace root **and** clears the per-policy
gates. Everything else — `/mnt/c`, `$HOME`, sibling worktrees, the state root, the
shared `.git` object store — is outside the workspace and denied by **containment**,
not by enumerating blocked roots.

### Resolution pipeline (`execution/path/pathPolicy.ts`)

1. validate raw input (no NUL, bounded length);
2. `path.resolve(realWorkspaceRoot, input)` then lexical containment — an absolute or
   `..`-escaping input lands outside → `traversal` (covers prefix confusion, SAT-A5-2);
3. realpath the **nearest existing ancestor**; require it inside
   `realpath(workspaceRoot)` — catches a symlinked ancestor and safely validates a
   not-yet-existing target via its existing ancestor → `symlink_escape` (T-FS-01/02);
4. if the target exists, realpath it and re-check (symlinked leaf); for a WRITE refuse
   a multiply-linked file → `hardlink` (T-FS-04, conservative: a fresh worktree has no
   legitimate hardlinks);
5. refuse any `.git` path segment, case-insensitively → `blocked_git` (the gitdir link
   + shared object store, T-FS-08, SAT-A5-3);
6. `blockedPaths` match → `blocked_path` (always wins);
7. read/write gating (segment-aware prefix match, no prefix confusion); `writePaths`
   miss → `not_writable`, `readPaths` miss → `not_readable`; enforce
   `maxFilesChanged` over distinct canonical write targets → `max_files`.

Returns the canonical `realPath`; **callers MUST open that**, not re-resolve the
input (limits the check→open TOCTOU window). Every decision is audited.

### Capability binding (threat-model §11.2)

| Field | Content |
|---|---|
| **Capability** | The owner reads/writes only paths the policy allows inside the worktree; all else is denied. |
| **Threat(s)** | T-FS-01/02 (symlink read/write escape), T-FS-03 (traversal/prefix confusion), T-FS-04 (hardlink clobber), T-FS-07 (`/mnt/c`+`$HOME` out-of-bounds), T-FS-08 (`.git`/object store, cross-worktree). |
| **Control(s)** | Canonicalize→realpath→containment; nearest-existing-ancestor validation for non-existent targets; symlinked-ancestor + symlinked-leaf refusal; hardlink-write refusal; `.git`-segment + `blockedPaths` + read/write gating + `maxFilesChanged`. **Implemented** in `execution/path/pathPolicy.ts`. |
| **Milestone** | A5.2 (this PR). |
| **Verification** | `pathPolicy.test.ts` (16): SAT-A5-1 (symlink ancestor/leaf + non-existent-via-symlink + hardlink), SAT-A5-2 (`/mnt/c`/`$HOME`/`/etc` out-of-bounds), SAT-A5-3 (`.git`/`.git/objects` + cross-worktree), gating, prefix-confusion, maxFilesChanged, invalid input, audit. |
| **Recovery** | Pure decision function — a denied access never reaches `open()`; the caller surfaces the typed reason; decisions are audited for after-the-fact review. |
| **Residual risk** | RR-2 (TOCTOU between check and the caller's `open` — mitigated by returning `realPath`; full O_NOFOLLOW-style hardening is A9). Hardlink **read** leak is not blocked (only writes), noted. Case-insensitive containment beyond the `.git` block is POSIX/WSL2-targeted (the substrate is Linux). Accepted for the MVP, owner. |

### Open follow-ups

- Wire the engine onto the A5.1 worktree at the call sites that perform owner writes
  (A5.3/A5.4 process + owner enforcement).
- A9: stronger TOCTOU (open-time `O_NOFOLLOW`/`openat`), hardlink read-leak handling.

---

## A5.3 Safe Command Policy + Process Supervision

### Objective

Classify a concrete command (binary + argv) into a risk category and decide,
DENY-BY-DEFAULT, whether the runtime may run it inside a worktree; then run an
approved command under process supervision and reduce it to a single terminal result.

### Command policy (`execution/command/commandPolicy.ts`)

- **Categories:** `read_only`, `test`, `build`, `write_local`, `network`,
  `destructive`, `privileged`, `blocked`. Default-allowed:
  `read_only`/`test`/`build`/`write_local` (a run may widen, e.g. opt-in `network`).
- **No shell, ever.** Commands are spawned directly with a separated argv
  (`shell:false`), so shell metacharacters in an argument are inert literal DATA —
  they cannot inject a second command, and the structural classifier is never fooled
  by them (T-EXE-01/02, T-CMP-06; SAT-A5-4).
- **Deny by default.** An unknown binary → `blocked`. Bare `node` → `blocked`.
- **Dual binaries refined by argv:** `git` (`status`→read_only, `add/commit`→
  write_local, `push`→network, `push --force[-with-lease]` / `reset --hard` /
  `clean -f` / `branch -D`→destructive) and `npm`/`pnpm`/`yarn` (`install`→network,
  `test`→test, `run build`→build, arbitrary `run <script>`→blocked). Unusual flag
  forms (e.g. `git -C x …`) fail **closed** (→blocked).
- **cwd containment:** the working directory must be the workspace root or inside it
  (canonicalized), else `cwd_outside_workspace`.
- Typed `CommandDecision` with `denyReason ∈ {category_not_allowed, blocked_command,
  cwd_outside_workspace, invalid_command}`.

### Process supervision (`execution/command/commandSupervisor.ts`)

Composes the policy with the A3 `ProcessRunner` boundary (reused, not re-built): a
denied command NEVER spawns; an allowed command runs with the substrate process model
— direct binary, shell off, curated env allowlist (credential names dropped), explicit
cwd, output cap, timeout, and a process GROUP so cancellation/timeout signal the whole
tree (`detached`+negative-PID kill / `taskkill /T`), reaping orphans (substrate §8.5).
The supervisor adds: stdout/stderr kept SEPARATE and capped (truncation flag), a single
terminal `SupervisedCommandResult`, idempotent cancellation yielding partial evidence,
and an audit record per run.

### Capability binding (threat-model §11.2)

| Field | Content |
|---|---|
| **Capability** | The runtime executes only policy-approved commands inside the worktree, under process supervision. |
| **Threat(s)** | T-EXE-01/02 (command/argument injection), T-CMP-06 (`shell:true` metachar), T-EXE process-tree orphan / output flood / timeout, T-EXE-09 (env leakage). |
| **Control(s)** | Deny-by-default category classifier (no shell; structural; dual-binary refinement; cwd containment); supervision via the A3 `NodeProcessRunner` (process group, SIGTERM→grace→SIGKILL, output cap, timeout, env allowlist). **Implemented** in `execution/command/`. |
| **Milestone** | A5.3 (this PR). |
| **Verification** | `commandPolicy.test.ts` (14: classification incl. shell-metachar-as-literal SAT-A5-4, git/npm refinement, deny-by-default, cwd containment, supervisor composition/cancel/output/single-terminal via the fake runner); `commandSupervision.real.test.ts` (real `NodeProcessRunner` cancel+timeout cross-platform; POSIX supervisor `tail` cancel/timeout + process-group **orphan reaping** — sentinel never written). |
| **Recovery** | A denied command never reaches a spawn; a running command is cancellable (group kill) with partial evidence preserved; timeout/output-limit terminate deterministically; every run audited. |
| **Residual risk** | Unusual git flag forms fail closed (may over-block, never over-allow); `--force-with-lease` now detected. Network is opt-in only. Real provider command execution is gated on A5.4 (owner enforcement) + A5.9/A5.10. Accepted, owner. |

### Open follow-ups

- A5.4 binds command execution to the single writable OWNER; the reviewer is
  read-only and may run only `read_only` validations.
- A5.5 records each command + its mutations in the ledger.

---

## A5.4 Owner/Reviewer enforcement

### Objective

Enforce exactly one writable OWNER per unit of work and a strictly read-only
REVIEWER, composing the A5.2 path policy and A5.3 command policy behind a role gate.

### Ownership (`execution/role/ownership.ts`)

A per-unit (run+task) lease is the single source of truth for "who may write".
`acquire` grants it only if unowned (or re-acquired by the same actor); a different
actor is refused (two-owner race blocked). Ownership changes ONLY through an
explicit, audited `reassign` by the current owner — never implicitly — so a reviewer
can never silently become the owner. `release` is owner-only and idempotent. Typed
results; every transition audited.

### Role gate (`execution/role/roleEnforcer.ts`)

- **Owner** (must hold the lease): READ, WRITE within `writePaths` (A5.2), run any
  command the command policy (A5.3) permits.
- **Reviewer** (no lease): READ, run ONLY `read_only` commands. A reviewer WRITE →
  `reviewer_cannot_write`; a reviewer non-read-only command →
  `reviewer_command_not_read_only`. It cannot modify files, run `write_local`, or
  mutate via a side tool.
- An owner-role actor that does not hold the lease → `not_owner`.
- Every decision carries `{actorId, role, unit}` (role binding for events/artifacts)
  and is audited; underlying path/command decisions are attached.

### Capability binding (threat-model §11.2)

| Field | Content |
|---|---|
| **Capability** | Exactly one owner writes/executes within a unit; the reviewer is read-only. |
| **Threat(s)** | T-INT-14 (reviewer writes), T-INT-15 (two simultaneous owners / write race), implicit-owner escalation. |
| **Control(s)** | Single owner lease (two-owner race blocked); explicit-only audited reassignment; role gate denying reviewer write / non-read-only command and lease-less owner actions; role binding on every decision. **Implemented** in `execution/role/`. |
| **Milestone** | A5.4 (this PR). |
| **Verification** | `roleEnforcer.test.ts` (10): single-owner + two-owner block, explicit/audited reassignment, owner write in/out of writePaths, reviewer-write denied, not_owner, both-roles read, owner command allowed/destructive denied, reviewer read_only allowed / write_local+build denied, role binding present. (SAT-A5-8.) |
| **Recovery** | A denied action never reaches the path/command effect; ownership is explicit and auditable; the lease can be reassigned or released. |
| **Residual risk** | The lease is role-agnostic (a reviewer could hold a lease, but the role gate still denies its writes — harmless; the run wiring acquires the lease for the owner). Accepted, owner. |

### Open follow-ups

- A5.5 ledger attributes each mutation to the owner + the authorizing decision.
- A5.9 wires acquire(owner) at run start and binds the reviewer for the review phase.

---

## A5.5 Diff Capture + Mutation Ledger

### Objective

Record every file mutation in an append-only, tamper-evident ledger, and re-ground it
against the REAL worktree so an unrecorded change (a forged structured result or an
out-of-band mutation) is detected and blocks the merge.

### Ledger (`execution/ledger/mutationLedger.ts`)

Append-only, **hash-chained** entries: each records run/task/owner/worktree/branch,
file, operation (create/modify/delete/rename), hash-before/after, command, tool,
reason, tests, the authorizing policy/role decision ref, timestamp and sequence;
`entryHash = H(canonical(entry) || prevHash)` chains the history so any alteration or
reorder is detected by `verifyChain`. `headHash` binds the recorded diff to the
`GovernanceDecision` (A5.8). Secrets are **redacted** before persistence (key
prefixes, `key/token/secret/password` assignments, PEM blocks), with a
`reasonFullHash` over the original; oversized reasons are safely truncated. Entries
persist to JSONL; `MutationLedger.load` reconstructs the ledger after a crash and
**rejects a broken chain**.

### Real worktree state (`execution/ledger/worktreeState.ts`)

`computeWorktreeChanges` reads the real changes (working tree vs HEAD) via the
hardened `GitRunner` (A5.1) using NUL-delimited porcelain (`-z`, so hostile filenames
are literal), with a sha256 content hash per non-deleted file. `diffHash` is an
order-independent hash of the change set — the "reviewed diff hash"; a later
recomputation that differs proves the worktree changed after review.

### Reconciliation (`execution/ledger/reconcile.ts`)

`reconcile(ledgerEntries, worktreeChanges)` compares the ledger's last-recorded
post-hash per file against the real worktree: a changed file with NO ledger entry, or
a post-hash mismatch, is **unattributed** → `tampered = true` (the gate refuses the
merge); reverted recorded files are `stale`, not tampering. This is the integrity
re-grounding the governance gate consults (SAT-A5-6).

### Capability binding (threat-model §11.2)

| Field | Content |
|---|---|
| **Capability** | Every mutation is recorded and reconciled against the real worktree; an unrecorded change blocks the merge. |
| **Threat(s)** | T-INJ-11 (injected/forged result claims a different change set), T-INT-04 (self-certified integrity artifact). |
| **Control(s)** | Append-only hash-chained ledger (tamper-evident); secret redaction before persistence; real-worktree reconciliation from git (not narrative); diff-hash binding + modification-after-review detection; crash recovery rejecting a broken chain. **Implemented** in `execution/ledger/`. |
| **Milestone** | A5.5 (this PR). |
| **Verification** | `mutationLedger.test.ts` (13): hash-chain + tamper detection, redaction, persist/load crash recovery + broken-chain rejection, reconcile clean/unattributed/hash-mismatch/stale, diff-hash order-independence + change detection, and **real-git** computeWorktreeChanges + reconcile-vs-empty-ledger = tampered (SAT-A5-6). |
| **Recovery** | Tampered runs are flagged for the gate to block; the ledger reloads from JSONL after a crash; a broken persisted chain is rejected, not silently trusted. |
| **Residual risk** | The ledger redactor is focused (high-value shapes), not the full harness secretScan corpus — a novel secret shape could slip; the harness NO_SECRET_LEAKAGE gate remains the detection backstop. Accepted, owner. |

### Open follow-ups

- A5.6 quality gates + A5.8 governance consume `reconcile`/`headHash`/`diffHash`.
- Consider sharing secret patterns with `providers/harness/secretScan` (small TD).

---

## A5.6 Quality Gate Runner

### Objective

Run the project's quality gates and report a STRUCTURED result computed from the REAL
exit codes — never from a provider's claim that "the tests pass" — and detect runs
that weaken their own checks.

### Gate runner (`execution/gates/qualityGateRunner.ts`)

Gate commands come from TRUSTED configuration (`GateSpec[]`: an A1 `QualityGateName` +
a `CommandSpec`), not from provider output, and run through the A5.3
`CommandSupervisor` (command policy + supervision). A gate is `passed` iff its command
exits 0; a denied / timed-out / output-flooded / non-zero command is `failed` (a gate
that cannot run is never silently passed). Each `GateOutcome` carries the exit code,
an output-artifact hash (sha256 of captured streams, not raw output) and timestamps;
the result aligns with the A1 `QualityGateResult` (`overallStatus` + `gates[]`) and is
bound to the A5.5 `testedDiffHash` so it cannot be replayed against a different diff.
The overall status is `failed` if any gate failed, `passed` only if all passed, else
`unknown` (an empty gate set is `unknown`, never `passed`).

### Gate-tampering detection (`execution/gates/gateTampering.ts`)

`detectGateTampering(worktreeChanges)` flags runs that would pass by WEAKENING checks:
deleted (or renamed-away) test files, and changes to CI workflows / gate config
(`.github/workflows/*`, `vitest`/`tsconfig`/`eslint` configs, the root `package.json`
gate scripts). A positive report is a governance blocker (A5.8). It operates on the
A5.5 real-worktree change set, so it is provider-narrative-independent.

### Capability binding (threat-model §11.2)

| Field | Content |
|---|---|
| **Capability** | Quality gates run from trusted config and produce a verdict from real exit codes; check-weakening is detected. |
| **Threat(s)** | T-INT-04 (self-certified gate result / gate spoofing), T-INT-07/08 + T-GIT-07 (CI/gate-script weakening), test deletion. |
| **Control(s)** | Trusted-config gate commands run via the supervised command boundary; verdict = real exit code (not narrative); result bound to the tested diff hash; output captured as a hashed artifact; deleted-test + CI-config-change detection. **Implemented** in `execution/gates/`. |
| **Milestone** | A5.6 (this PR). |
| **Verification** | `qualityGates.test.ts` (7): all-pass → passed + diff-hash bound, a failing command → failed (real exit code authority), a policy-denied gate → failed (not silently passed); tampering: deleted test, renamed-away test, CI-workflow + root `package.json` change flagged, ordinary source change not flagged. |
| **Recovery** | A failing/uncertain gate blocks the merge at A5.8; tampering reports are blockers; results are diff-hash-bound so a stale result cannot be reused. |
| **Residual risk** | Tampering detection is heuristic (path patterns); a gate hidden by a novel config path could be missed — the trusted-config gate set + CODEOWNERS on CI files are the backstop. Accepted, owner. |

### Open follow-ups

- A5.7 repair loop reruns the gates after each owner repair.
- A5.8 governance consumes the `QualityGateRunResult` + tampering report as merge
  preconditions, bound to the tested diff hash.
