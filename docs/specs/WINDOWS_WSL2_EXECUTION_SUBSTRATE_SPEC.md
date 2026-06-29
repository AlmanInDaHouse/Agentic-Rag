# Windows and WSL2 Execution Substrate Spec

**Milestone:** A0.4 — Windows and WSL2 Execution Substrate Decision
**Status:** Documentation only. No code, tests, migrations, endpoints, runtime,
dependency or CI changes.
**Related:** `docs/adr/0030-wsl2-first-local-execution-substrate.md`,
`docs/context/TRIFORGE_PROJECT_VISION.md` (Section 18),
`docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md` (ADR 0028, ADR 0029),
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` (ADR 0027),
`docs/specs/SAFE_EXECUTION_POLICY_SPEC.md` (ADR 0011).

This milestone decides **where** TriForge and its provider CLIs run before any
writable provider integration is built. It is architectural and documentary. No
adapter, no process execution, no worktree manager, no cancellation mechanism and
no path-enforcement code is implemented here.

### Evidence classification

Every substantive claim carries one tag:

- `VERIFIED_FROM_REPOSITORY` — confirmed by reading this repository's code/config.
- `VERIFIED_FROM_INSTALLED_VERSION` — confirmed against an installed CLI version.
- `VERIFIED_FROM_ENVIRONMENT` — observed on the local machine on 2026-06-29 by a
  non-destructive read-only probe; a single machine is not a universal guarantee.
- `DECIDED` — the architectural decision recorded by this milestone (ADR 0030).
- `PLANNED` — named future work.
- `REQUIRES_VERIFICATION` — must be confirmed (e.g. against an installed version or
  a started distribution) before it is relied upon.
- `UNKNOWN` — not established; deliberately left open.

---

## 1. Objective

Decide the local execution substrate for the TriForge MVP: the operating
environment in which the TriForge runtime, Git, Node, pnpm, the official provider
CLIs (Codex CLI, Claude Code), the working repository, worktrees and quality gates
run. The decision must be unambiguous and must precede any writable provider
integration.

## 2. Scope

- The substrate for **local, single-user** development (consistent with ADR 0027 /
  ADR 0028 / ADR 0029).
- Where each component runs; where the repository and worktrees live; the
  conceptual process, path, filesystem, Git, lifecycle, cancellation, cleanup,
  recovery, network and observability models.
- A decision matrix across Windows-native, WSL2-first and hybrid.
- Failure modes and acceptance criteria.

## 3. Non-Goals

This milestone does not:

- implement `ProviderAdapter`, Codex/Claude adapters or any provider execution,
- run providers in writable mode,
- create functional worktrees,
- implement cancellation, process groups, allowed-path enforcement or command
  policy,
- modify the runtime, CI, dependencies, versions or authentication,
- decide native-Windows support (explicitly deferred),
- define the full provider/repository **threat model** (that is Milestone A0.5),
- install, update, log into, or start any distribution or tool.

The complete security/threat analysis and the security sandbox design are **not**
in A0.4. A0.4 chooses an operational and compatibility substrate; A0.5 owns the
threat model.

## 4. Terminology

- **Substrate** — the operating environment that hosts the runtime and provider
  processes.
- **WSL2** — Windows Subsystem for Linux v2; a real Linux kernel in a managed VM.
- **Distribution / distro** — a Linux userland running on WSL2 (e.g. Ubuntu).
- **Windows filesystem** — NTFS volumes such as `C:` (`/c` under MSYS, `/mnt/c`
  inside WSL).
- **Linux filesystem** — the distro's native ext4-backed filesystem (e.g. paths
  under `/home/<user>`).
- **Worktree** — a Git linked working tree created with `git worktree add`.
- **Operational isolation** — separation of work (per-run worktree, per-process
  group) that prevents accidental interference. It is **not** a security sandbox.
- **Security sandbox** — confinement of untrusted code; defined and owned by A0.5
  and later phases, not by A0.4.

## 5. Current Environment (observed)

Recorded 2026-06-29 by a non-destructive, read-only probe of the local machine.
`VERIFIED_FROM_ENVIRONMENT` unless noted. A single machine is not a universal
guarantee; provider- and distro-internal facts that were not started or installed
remain `REQUIRES_VERIFICATION` / `UNKNOWN`.

- Host OS: Windows 11, build `10.0.26200.8655`. The current TriForge/dev shell is
  **native Windows** (MSYS/MinGW; `uname` → `MINGW64_NT-10.0-26200 ... x86_64`),
  **not** inside WSL2.
- WSL present: version `2.6.3.0`, kernel `6.6.87.2-1`, WSLg `1.0.71`.
- Default distribution: **Ubuntu** (WSL version 2), currently **Stopped**. A
  `docker-desktop` distribution (WSL version 2) is also present.
- Repository location today: `C:\Users\manul\Agentic-Rag` on **NTFS** (`/c`, the
  Windows filesystem) — i.e. **not** on the Linux filesystem.
- Toolchain on the Windows side: Node `v24.12.0`, pnpm `11.5.0` (matches the
  `packageManager: pnpm@11.5.0` pin — `VERIFIED_FROM_REPOSITORY`), Git
  `2.52.0.windows.1`.
- Provider CLIs installed on the **Windows** side (npm global,
  `AppData/Roaming/npm`): Codex CLI `0.101.0`, Claude Code `2.1.195`
  (`VERIFIED_FROM_INSTALLED_VERSION`).

**Honest gap.** The current dev environment does **not** yet satisfy this
milestone's target: the repository sits on NTFS, the toolchain and both provider
CLIs are installed on the Windows side, and the Ubuntu distro is stopped. Whether
Node, pnpm, Git, Codex CLI and Claude Code are installed and authenticated
**inside** the Ubuntu WSL2 distribution is `REQUIRES_VERIFICATION` (the distro was
not started and nothing was installed). The decision below is therefore a
**target substrate** that requires a one-time migration, not a description of the
current state.

## 6. Chosen Architecture

`DECIDED` (ADR 0030):

```text
WSL2-first
Repository on the Linux filesystem
Codex CLI and Claude Code executed inside the same WSL2 distribution
Native Windows execution deferred
```

For the MVP, the TriForge runtime, Git, Node, pnpm, the provider CLIs, the working
repository, worktrees and quality gates all run **inside one WSL2 distribution**,
on its Linux filesystem. Windows hosts only the editor and the browser, which
reach the runtime across a clearly defined boundary (Section 8.6).

This is an operational and compatibility decision. **WSL2 is not, by itself, the
security sandbox for untrusted repository content** (Section 13). Operational
isolation (worktrees, process groups), path restrictions, command policy, verified
provider sandbox capabilities, OS isolation and human approval remain separate,
later concerns; A0.4 does not authorize writable execution.

### 6.1 Components that run inside WSL2 (invariant: co-location)

`DECIDED`. For the MVP these run inside the same WSL2 distribution:

- TriForge runtime,
- Git,
- Node and pnpm,
- Codex CLI,
- Claude Code,
- the working repository,
- worktrees,
- quality gates (typecheck, tests, harness, build, audit).

Rationale (`VERIFIED_FROM_REPOSITORY`): the repository's only process-spawning
code already diverges by platform (`tooling/harness/src/runner.ts` uses
`corepack.cmd` vs `corepack` and `shell: process.platform === "win32"`), and CI
already runs on `ubuntu-latest`. A single Linux substrate removes the
Windows/Linux split and aligns local execution with the reproducible CI
environment.

An architecture in which Windows partially launches Linux processes and partially
launches Windows processes within the same run is **rejected**: it produces an
ill-defined boundary, inconsistent process and signal semantics, and a silent
path-translation surface. Any exception to co-location must be explicitly
justified, scoped to the Windows↔WSL boundary (Section 8.6), and must never split a
single run across both worlds.

## 7. Mandatory Decisions

This milestone answers each of the following unambiguously.

1. **Where does the TriForge runtime run?** Inside the WSL2 distribution. `DECIDED`.
2. **Where does Codex CLI run?** Inside the same WSL2 distribution. `DECIDED`
   (today it is installed on the Windows side — `REQUIRES_VERIFICATION` /
   migration; Section 5).
3. **Where does Claude Code run?** Inside the same WSL2 distribution. `DECIDED`
   (same migration caveat).
4. **Where is the repository stored?** On the Linux filesystem, e.g.
   `/home/<user>/projects/Agentic-Rag`; **not** under `/mnt/c`. `DECIDED`
   (Section 8.2).
5. **How are paths represented/persisted?** POSIX `/`, workspace-relative where
   possible, normalized and `realpath`-contained before authorization; no implicit
   Windows↔Linux translation in the core. `DECIDED` (Section 8.3).
6. **How are child processes created/supervised?** Direct binary execution, shell
   disabled by default, explicit argv, environment allowlist, explicit working
   directory, in a dedicated process group, with a supervision contract.
   `DECIDED` / `PLANNED` (Section 8.5).
7. **How is a whole process tree cancelled?** Signal the owned **process group**
   (`SIGTERM` → bounded grace → `SIGKILL`), not only the lead PID. `DECIDED` /
   `PLANNED` (Section 8.5).
8. **Where are Git worktrees created?** In an external, TriForge-managed state
   root on the Linux filesystem, **outside** the active working tree. `DECIDED`
   (Section 8.4).
9. **How will allowed paths be enforced?** Conceptually: normalize → resolve
   symlinks → check containment after `realpath` → reject traversal; not by a
   textual prefix comparison alone. Enforcement code is `PLANNED` (A4), not built
   here.
10. **What does "sandbox" mean in this phase?** Operational isolation only.
    Security sandboxing is `PLANNED` and owned by A0.5+ (Section 8.8 / 13).
11. **How is WSL2 prevented from being mistaken for a sufficient security
    boundary?** By the explicit declaration that WSL2 is not the sole security
    sandbox for untrusted content (Section 13), and by keeping the threat model in
    A0.5.
12. **How does the Windows UI/browser talk to the runtime?** Over `localhost`/loopback
    to a service exposed by the runtime inside WSL2 (`REQUIRES_VERIFICATION` per
    machine/config). `DECIDED` boundary (Section 8.6).
13. **How does a Windows editor integrate with the WSL2 repository?** Through an
    official remote-WSL editor integration; the editor runs on Windows, the files
    and operations stay in WSL2. `DECIDED` boundary (Section 8.6).
14. **What native-Windows support is deferred?** All of it — native process
    control (e.g. Windows Job Objects), native-path execution and a Windows-only
    run path. `PLANNED` / postponed (Section 14, ADR 0030).
15. **What conditions would force revisiting the decision?** Section 12 and ADR
    0030 ("Conditions to revisit").

## 8. Technical Invariants

### 8.1 Co-location

`DECIDED`. See Section 6.1. All MVP components run in one WSL2 distribution unless
an exception is explicitly justified and confined to the Windows↔WSL boundary. No
single run is split across Windows and Linux.

### 8.2 Filesystem

`DECIDED`. The working repository and all worktrees reside on the **Linux
filesystem** (e.g. `/home/<user>/projects/Agentic-Rag`). `/mnt/c/...` (the NTFS
mount) is **not** recommended as the primary location.

Verifiable technical reasons (not absolute claims):

- `VERIFIED_FROM_REPOSITORY`: the Code Graph scanner walks the repository
  recursively with `node:fs` and resolves symlink containment; its symlink-escape
  test is `it.skipIf(process.platform === "win32")` in
  `tooling/code-graph-scanner/src/scanner.test.ts`, i.e. POSIX symlink semantics
  are the exercised path. A native Linux filesystem gives the consistent
  symlink/`realpath`/case-sensitivity behavior the path model (8.3) depends on.
- `REQUIRES_VERIFICATION`: cross-OS access to NTFS via the `drvfs` 9P mount
  (`/mnt/c`) is widely reported to have higher latency and weaker POSIX
  metadata/permission/inode fidelity than the native Linux filesystem; the exact
  magnitude on this machine was not measured. Do not state a specific multiplier.
- The Linux filesystem is case-sensitive; NTFS is case-insensitive by default. The
  path model assumes case sensitivity (8.3), so the repository must live where that
  holds.

The primary repository and worktrees must live on a Linux filesystem that supports
the Git operations required (hardlinks/symlinks for linked worktrees, atomic
renames, POSIX permissions).

### 8.3 Path model

`DECIDED` (model) / `PLANNED` (enforcement code):

- persisted paths are workspace-relative where possible;
- the POSIX separator `/` is canonical;
- paths are normalized before any authorization check;
- a `..` segment that escapes the workspace is rejected;
- symlinks are resolved and containment is re-checked **after** `realpath`;
- a path that does not yet exist (a file to be created) is validated by resolving
  its nearest existing ancestor and checking containment, not by trusting the raw
  string;
- there is **no implicit Windows↔Linux path translation inside the core**;
- translation, when unavoidable, happens only in a clearly delimited boundary
  layer (Section 8.6);
- the Linux filesystem is treated as case-sensitive;
- external mounts and symlinks pointing outside the workspace are treated as
  out-of-bounds.

A textual prefix comparison alone is **not** sufficient to enforce allowed paths;
containment must be checked on the realpath-resolved, normalized path.

### 8.4 Worktrees

`DECIDED`:

- work never happens directly on `main`;
- each implementation gets an isolated worktree;
- worktrees live on the Linux filesystem;
- worktrees live in an **external, TriForge-managed state root**, **not** nested
  inside the active working tree.

Location decision and rationale. A naive nested layout such as
`.triforge/worktrees/<run-id>/<task-id>` (this spec's own illustration) is
**rejected** in favor of an external state root, e.g.
`${XDG_STATE_HOME:-$HOME/.local/state}/triforge/worktrees/<run-id>/<task-id>` (or an
equivalent TriForge-managed root such as `$HOME/.triforge/worktrees/...`), outside
the primary working tree. The semantic goal — one isolated worktree per run/task —
is preserved; only the location moves out of the repository. Reasons
(`VERIFIED_FROM_REPOSITORY`):

- the Code Graph scanner walks the repository recursively (`node:fs`); a worktree
  nested under the working tree would be scanned recursively, contaminating
  context and inflating output;
- a linked worktree nested inside the main working tree risks Git confusion and
  accidental staging of another worktree's files;
- keeping generated state out of the tree matches the existing pattern where
  generated artifacts (`artifacts/code-graph/`) are gitignored
  (`VERIFIED_FROM_REPOSITORY`).

Each worktree must have: per-run and per-task ownership, an auditable branch and
worktree path, cleanup, stale-worktree detection, and crash recovery. The
mechanisms are `PLANNED` (A5), not implemented here.

### 8.5 Child processes

`DECIDED` (contract) / `PLANNED` (implementation). The future supervision contract
must provide:

- direct binary execution;
- shell **disabled by default** (no implicit shell interpolation);
- separated argument vector;
- environment allowlist (per `OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md` §12);
- explicit working directory;
- an execution ID, the PID, and a **process group** (or equivalent) so the whole
  tree can be signalled;
- stdout, stderr and the structured event stream captured;
- output size limits;
- timeout;
- cancellation;
- a bounded grace period;
- escalating termination;
- cleanup and orphan detection;
- preserved partial result;
- exactly one terminal event.

For WSL2/Linux, the conceptual cancellation sequence:

```text
cancel requested
    ↓
stop accepting new work
    ↓
SIGTERM to the owned process group
    ↓
bounded grace period
    ↓
SIGKILL if processes remain
    ↓
collect exit status and partial evidence
    ↓
emit one normalized terminal event
```

This mechanism is **not implemented** in A0.4.

`VERIFIED_FROM_REPOSITORY` (why a process group is required): the only existing
process control, `tooling/harness/src/runner.ts`, spawns **without** `detached`
(no process group) and, on POSIX, `stopProcess` calls `child.kill("SIGTERM")` then
after a 5 s grace `child.kill("SIGKILL")` on the **lead PID only**. Because the
lead process is the `corepack pnpm … exec tsx src/index.ts` wrapper, the actual
Node server runs as a grandchild, so signalling the lead PID does not guarantee the
whole tree dies — a concrete orphan risk on POSIX. On Windows the same file uses
`taskkill.exe /PID <pid> /T /F` to kill the tree. The lesson is explicit:
**killing only the lead PID does not guarantee terminating the tree.** The future
model must own a process group (e.g. `detached`/`setsid` + signal the negative
PGID) on Linux. Native-Windows process-tree control (e.g. Windows Job Objects) is
out of scope for the MVP and deferred with native-Windows support.

### 8.6 Windows interoperability

`DECIDED` boundary. The boundary is deliberately small:

- a Windows editor integrates via an official remote-WSL integration (editor on
  Windows, files/operations in WSL2);
- a Windows browser reaches the local service exposed by the runtime in WSL2 over
  `localhost`/loopback (`REQUIRES_VERIFICATION` per machine/config; WSL2 localhost
  forwarding is the documented mechanism but must be confirmed locally);
- the runtime and all repository operations stay inside WSL2;
- the MVP core does **not** depend on PowerShell scripts;
- there is **no** silent path conversion;
- one run never executes one CLI on Windows and another on Linux.

Any Windows/WSL behavior that depends on a specific Windows or WSL version or
configuration is recorded as an installation/environment verification, not a
universal truth (`REQUIRES_VERIFICATION`).

### 8.7 Network

`DECIDED` (substrate scope only). A0.4 defines the substrate; it does **not** grant
general network permission.

- `REQUIRES_VERIFICATION`: WSL2 can have network connectivity (a general
  capability; not observed here because the distro was not started).
- Network availability is **not** authorization.
- The official provider CLIs may require network to reach their own services.
- Any additional network used by tools, scripts or dependencies is governed later
  by the Safe Command Policy, the A0.5 threat model and approval gates.
- No automated login, no scraping, no automated web browsing, no API-key fallback
  (consistent with ADR 0027 / 0028 / 0029).

### 8.8 Sandbox

`DECIDED` (definition). For this phase, distinguish these layers; they are
independent and not interchangeable:

1. operational worktree isolation;
2. path restrictions;
3. command restrictions;
4. process isolation;
5. each provider's **verified** native sandbox capabilities;
6. operating-system isolation;
7. human approval.

Explicit declaration:

```text
WSL2 is not treated as the sole security sandbox for untrusted repository content.
```

Provider-specific sandbox capabilities (for example Codex's `--sandbox`
read-only/workspace-write modes, observed in `OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`)
remain **versioned and `UNKNOWN`/`REQUIRES_VERIFICATION`** for runtime behavior
until verified against the installed version. A0.4 neither relies on them nor
freezes them.

## 9. Decision Matrix

`DECIDED` selection; costs recorded honestly. (`+` favorable, `~` mixed, `−`
unfavorable, for the MVP.)

| Criterion | Windows native | WSL2-first (selected) | Hybrid |
|---|---|---|---|
| Provider CLI compatibility | ~ (CLIs run on Windows today) | + (one Linux userland) | ~ |
| Process semantics | − (no POSIX process groups) | + (POSIX groups/signals) | − (two models) |
| Signals | − (no SIGTERM/SIGKILL groups) | + | − |
| Process trees | ~ (needs Job Objects/taskkill) | + (PGID kill) | − |
| Paths | − (drive letters, `\`, case-insensitive) | + (POSIX, case-sensitive) | − (translation surface) |
| Symlinks | − (restricted; test skipped on win32) | + (native) | − |
| Git worktrees | ~ | + (native Linux fs) | ~ |
| Node/pnpm tooling | + (works) | + (works) | ~ |
| Reproducibility vs CI (`ubuntu-latest`) | − | + (matches CI) | ~ |
| Complexity | + (one OS) | ~ (WSL layer) | − (two OS in one run) |
| Observability | ~ | + (uniform) | − |
| Maintenance | ~ | ~ (distro lifecycle) | − |
| Security posture (pre-A0.5) | − | ~ (VM boundary, not a sandbox) | − |
| Future portability | ~ | + (Linux-portable) | ~ |
| Install experience | + (already on Windows) | − (WSL + migrate repo + reinstall CLIs in distro) | − |
| Drift risk | − (local≠CI) | + (local≈CI) | − (max divergence) |

Honest costs of WSL2-first (not hidden):

- requires installing/starting WSL2, **migrating the repo onto the Linux
  filesystem**, and (re)installing + authenticating the provider CLIs inside the
  distro (today they are Windows-side; Section 5);
- a severe performance/fidelity cliff if the repo is mistakenly left on `/mnt/c`;
- a WSL layer and distro lifecycle to manage (start/stop, updates, coexistence
  with the `docker-desktop` distro);
- dependence on `localhost` interop for the Windows browser
  (`REQUIRES_VERIFICATION`);
- a two-world cognitive model at the editor/browser boundary, even though runs are
  Linux-only.

## 10. Failure Modes

For each: detection, resulting state, recoverable, human intervention, evidence to
preserve. Detection/states are conceptual (no enforcement is built here).

| Failure mode | Detection | Resulting state | Recoverable | Human | Evidence |
|---|---|---|---|---|---|
| Repository on `/mnt/c` | startup substrate check (path under `/mnt/`) | refuse/warn substrate-invalid | yes (move repo) | yes | detected path (relative), reason |
| CLI installed only on Windows | capability probe inside distro fails | `provider_unavailable` | yes (install in distro) | yes | provider, probe result |
| CLI only in another distro | probe in active distro fails | `provider_unavailable` | yes | yes | distro name, probe result |
| WSL distro stopped | runtime cannot start in distro | substrate-unavailable | yes (start distro) | yes | distro state |
| WSL not installed | substrate probe fails | substrate-unavailable | yes (install WSL) | yes | probe result |
| WSL1 distro | version probe = 1 | substrate-unsupported | yes (convert to v2) | yes | distro version |
| Child process hangs | timeout elapses | `timeout` → cancel sequence (8.5) | partial | maybe | partial output, exit status |
| Timeout | deadline reached | `timeout` terminal event | partial | no | timing, partial artifacts |
| Orphan process | post-run group scan finds survivors | cleanup escalates to SIGKILL of group | yes | no | surviving PIDs (no secrets) |
| Output flood | output-size limit exceeded | `output_limit_exceeded` | partial | maybe | truncated evidence + marker |
| Stale worktree | worktree present without a live run | flagged stale | yes (cleanup) | maybe | worktree path, run id |
| Disk full | write error during run | `process_crashed`/failed | yes (free space) | yes | error code, free-space note |
| Path with external symlink | `realpath` escapes workspace | rejected (out-of-bounds) | n/a | no | resolved path (relative), reason |
| Path traversal (`..`) | normalization detects escape | rejected | n/a | no | offending segment, reason |
| Windows path reaches core | non-POSIX/drive-letter path detected at boundary | rejected at boundary | n/a (fix caller) | maybe | offending path shape |
| CLI updated, snapshot invalid | version mismatch vs capability snapshot | capabilities degraded to `unknown` | yes (re-probe) | maybe | old/new version |
| Runtime restarted mid-run | run has no live process group on resume | run marked interrupted; partial preserved | partial | yes | last terminal/partial evidence |
| localhost interop down | browser cannot reach WSL service | UI-degraded (runtime unaffected) | yes | maybe | reachability probe result |
| Auth expired | non-secret auth probe (ADR 0029) | `authentication_expired` hard stop | yes (re-auth in CLI) | yes | auth state only (no secrets) |
| Git not configured in WSL | git identity/config probe fails | substrate-incomplete | yes (configure git) | yes | which config missing |

No secrets, tokens or full sensitive paths are ever stored as evidence (consistent
with ADR 0016, ADR 0029).

## 11. Lifecycle, Cancellation, Cleanup, Recovery

`DECIDED` (model) / `PLANNED` (implementation):

- **Lifecycle**: substrate check → distro/auth/capability probes → (future) spawn
  in a process group inside a per-run worktree → capture streams → single terminal
  event.
- **Cancellation**: the process-group sequence in 8.5.
- **Cleanup**: terminate the owned group, remove the run's worktree, detect
  orphans and stale worktrees.
- **Recovery**: after a runtime restart, a run with no live owned group is marked
  interrupted with partial evidence preserved; it is not silently resumed.

## 12. Conditions to Revisit

`DECIDED`. Revisit the WSL2-first decision if any of:

- a provider stops supporting headless CLI use on Linux/WSL2;
- WSL2 process/signal/filesystem semantics regress materially;
- a verified requirement forces native-Windows execution;
- a future security model (A0.5) requires stronger OS isolation than a WSL2 distro;
- measured `/mnt`-vs-native or interop behavior contradicts the assumptions here.

## 13. Relation to A0.5 and Later Phases

A0.4 chooses the substrate only. The **provider and repository threat model** is
Milestone **A0.5** and is not started here. A0.3
(`OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md` §6) forward-referenced "the concrete
sandbox policy (OS-level isolation, process-tree kill semantics, network
confinement)" to this milestone; A0.4 **refines** that boundary: it owns the
operational substrate and the process model (including process-tree kill semantics,
§8.5), while OS-level/security isolation and network confinement/authorization move
to the A0.5 threat model. The security sandbox, Safe Command Policy enforcement,
allowed-path enforcement and the worktree manager are later milestones (A4/A5 in
the vision roadmap); real process-group cancellation and timeout land with the real
provider adapters (A2). Writable provider integration is **not authorized** until
A0.4 and A0.5 are closed.

## 14. Postponed (explicit)

`PLANNED` / deferred:

- native-Windows execution and native-Windows process control (e.g. Windows Job
  Objects);
- any Windows-only run path;
- the full threat model (A0.5);
- worktree manager, cancellation, allowed-path and command-policy implementations.

## 15. Risks

- migration cost and the `/mnt/c` performance/fidelity cliff (Section 8.2/9);
- WSL distro lifecycle and coexistence with `docker-desktop`;
- localhost interop dependence for the Windows browser (`REQUIRES_VERIFICATION`);
- provider CLIs currently installed Windows-side must be re-provisioned in the
  distro (Section 5);
- EOL drift: there is no `.gitattributes` (`VERIFIED_FROM_REPOSITORY`) and
  `core.autocrlf` is in effect on this machine (`VERIFIED_FROM_ENVIRONMENT`: commits
  warned "LF will be replaced by CRLF"), so a Windows checkout and a WSL2 checkout
  can differ in line endings; a normalization policy is a candidate follow-up but is
  **not** decided or changed here;
- version drift between Windows-side and distro-side toolchains.

## 16. Acceptance Criteria

A0.4 is closed when this spec and ADR 0030 together:

- record an unambiguous decision;
- compare Windows-native, WSL2-first and hybrid;
- answer all mandatory questions (Section 7);
- define the process model (8.5);
- define process-tree cancellation (8.5);
- define the path model (8.3);
- define symlink handling (8.3);
- decide the repository location (8.2);
- decide the conceptual worktree location (8.4);
- separate operational isolation from a security sandbox (8.8);
- declare that WSL2 does not substitute for A0.5;
- explicitly defer native Windows (Section 14);
- document risks and failure modes (10, 15);
- introduce no adapter code, no writable execution, no new dependencies and no CI
  change;
- keep all documentary cross-references consistent;
- pass the repository's validation for documentation changes.
