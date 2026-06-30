# ADR 0056: Native Windows as the Primary Execution Substrate

## Date

2026-06-30

## Status

Accepted. **Supersedes the *mandatory* status of [ADR 0030](0030-wsl2-first-local-execution-substrate.md)** (WSL2-First). ADR 0030 is retained as the historical record; WSL2 is reclassified from *required substrate* to *optional / future* platform.

## Context

ADR 0030 (2026-06-29) chose **WSL2-first** as the local execution substrate for the
writable runtime: the TriForge runtime, Git, Node, pnpm, both provider CLIs, the
repo, worktrees and quality gates would all run inside one WSL2 distribution on its
Linux filesystem, with Windows hosting only the editor and browser. That decision was
made to gain POSIX process groups/signals, native symlink/`realpath`/case-sensitive
path semantics, native Git worktrees, and parity with the `ubuntu-latest` CI.

The owner has since changed the **product requirement** (mandate "Native Windows
Operational Closure", 2026-06-30):

> TriForge must run **natively on Windows 11**. The user installs, runs and operates
> it from a **PowerShell terminal integrated in VS Code, Antigravity or another
> compatible IDE**. WSL2 is **not** a product requirement.

This is a product-scope decision, not a discovery that WSL2 is technically inferior.
It removes a heavy adoption tax (install/start WSL2, migrate the repo onto the Linux
filesystem off `/mnt/c`, re-provision and re-authenticate the CLIs inside the distro,
Remote-WSL editor wiring, a `localhost` interop dependency).

Observed native-Windows environment, 2026-06-30 (non-destructive probe via
`pnpm triforge:doctor`; a single machine is not a universal guarantee):

- Host: Windows 11 Home (build 10.0.26200), x64; repo on NTFS at
  `C:\Users\manul\Agentic-Rag`.
- Windows PowerShell 5.1; Node v24.12.0; pnpm 11.5.0; corepack 0.34.5; Git
  2.52.0.windows.1.
- **Codex CLI 0.101.0** installed and **authenticated** natively (`codex login status`
  → "Logged in using ChatGPT"). *(A10-W.6 update, 2026-06-30: upgraded to **0.142.4**.
  0.101.0 was a model/version dead-zone with this ChatGPT account — the account only
  offers `gpt-5.5` to Codex, but 0.101.0 is too old to run it, and `gpt-5`/`gpt-5-codex`
  are "not supported when using Codex with a ChatGPT account". 0.142.4 runs gpt-5.5
  read-only AND writable; the version-bound capability snapshot was regenerated and the
  owner approved the upgrade.)*
- **Claude Code 2.1.195** installed and **authenticated** natively (`claude auth status`
  → `loggedIn:true`, claude.ai, Max).
- PostgreSQL 18 native Windows service running, `localhost:5432` reachable.
- `LongPathsEnabled`=0 (HKLM; needs admin to flip; `git config core.longpaths true`
  mitigates git operations without admin). `core.autocrlf=true`.

Critically, the prior blocker recorded in the evidence registry — *"both providers must
be installed and manually authenticated by the owner inside WSL2"* — **does not exist
on the native substrate**: both CLIs are already installed and authenticated on
Windows. The manual-login hard stop is effectively already satisfied.

## Decision Forces

- the product must be operable from a native Windows IDE terminal (PowerShell), with no
  WSL2/Ubuntu/Linux-path/Remote-WSL requirement;
- the OS-specific differences (process-tree control, path semantics, worktrees) must be
  encapsulated behind a portable boundary, not scattered as `process.platform` checks;
- the OS-independent core (routing, provider events, quota, collaboration, governance,
  ledger, quality gates) must remain platform-agnostic;
- the choice must not pretend to be a security sandbox (the threat model is A0.5 / ADR
  0055); Windows ACL/restricted-token/Job-Object controls have honest residual risk;
- CI parity must be preserved where possible (CI stays Linux; a Windows CI lane is a
  follow-up), without letting CI-only verification masquerade as real-host verification.

## Alternatives

1. **Keep WSL2-first mandatory** — contradicts the new product requirement; imposes the
   full WSL2 adoption tax on every user.
2. **Native Windows primary, WSL2 optional/future** *(chosen)* — run everything
   natively on Windows behind an `ExecutionPlatform` boundary; keep a POSIX
   implementation path for a future Linux/WSL2 option.
3. **Dual mandatory (Windows + WSL2)** — doubles the verification surface and the
   substrate lifecycle for no product benefit now.

## Decision

Adopt **Native Windows as the primary execution substrate**:

```text
Native Windows 11
Repository on NTFS (no /mnt/c, no Linux filesystem requirement)
Codex CLI and Claude Code executed natively on Windows
Operated from an integrated IDE PowerShell terminal
WSL2 / POSIX deferred to an optional, future platform
```

All OS-specific behavior is funnelled through a single explicit boundary,
`ExecutionPlatform` (`packages/shared/src/platform/executionPlatform.ts`), with two
implementations: `WindowsExecutionPlatform` (initial supported) and
`PosixExecutionPlatform` (future/optional). The OS-independent runtime depends only on
the interface. This is an operational/compatibility decision; it does **not** weaken
the A0.5 threat model and does **not** treat Windows ACLs or Job Objects as a perfect
sandbox.

## Portability strategy

- `ExecutionPlatform` declares the portable contract: `normalizeWorkspacePath`,
  `validateContainedPath`, `createManagedProcess`, `terminateProcessTree`,
  `createRestrictedEnvironment`, `inspectFilesystemEntry`.
- Windows-specific mechanisms replace POSIX ones behind that seam, per PR:
  - POSIX process groups + `process.kill(-pid, SIG…)` → **Windows Job Objects**
    (kill-on-job-close) — A10-W.4.
  - POSIX `realpath`/case-sensitive containment → **Windows canonical path policy**
    (volume identity, reparse-point/junction/ADS/UNC/device/reserved-name handling,
    no `startsWith`) — A10-W.2.
  - the worktree state root moves to `%LOCALAPPDATA%\TriForge` on NTFS — A10-W.3.
  - layered isolation (worktree + path policy + ACL + restricted token + Job Object +
    env allowlist + command policy + audit) — A10-W.5.
- Provider adapters resolve the CLI to a real executable (`node <cli.js>` / `.cmd`),
  never the npm `.ps1` shim (which swallows piped stdout), and never via a concatenated
  shell string (`.cmd` argument-injection class, CVE-2024-27980) — A10-W.6.
- The evidence model gains `verified_real_environment` + `requiresRealEnvironment` so
  real-Windows-host verification of OS behavior is distinguished from a CI fixture; the
  final gate requires it for the mandatory `windows_*` capabilities (A10-W §19).

## Consequences

### Positive

- no WSL2/Ubuntu install, no repo migration, no Remote-WSL, no `/mnt/c` performance
  cliff; the product runs where the user already is;
- both providers are already authenticated natively → the real-provider verification
  path is unblocked;
- one explicit OS boundary instead of scattered platform checks;
- the POSIX implementation remains a first-class, testable option for a future Linux
  substrate.

### Negative

- Windows process-tree control needs a native mechanism (Job Objects) instead of POSIX
  signals — more implementation surface than `process.kill(-pid)`;
- Windows path security is materially harder than POSIX (junctions, reparse points,
  ADS, UNC, device namespaces, reserved names, case-insensitivity, trailing dot/space);
- Windows isolation primitives (ACL, restricted token) are weaker/again-different from
  POSIX and carry honest residual risk;
- CI is Linux; native-Windows behavior must be verified on a real Windows host
  (`verified_real_environment`), not inferred from the Linux CI.

## Risks

- `MAX_PATH` (260) truncation for deep worktree paths when `LongPathsEnabled`=0
  (mitigation: `core.longpaths`, long-path-aware APIs);
- junction/symlink/reparse-point escapes from the worktree (mitigation: A10-W.2 canonical
  containment, deny-by-default);
- `.cmd`/`.bat` argument injection and PATH/PATHEXT/DLL-search hijacking (mitigation:
  deterministic resolution, A10-W.5/§10);
- `core.autocrlf=true` EOL drift for fixtures;
- treating ACL/Job-Object confinement as a sandbox (mitigation: residual-risk register;
  A0.5 still governs).

## Mitigations

- the startup substrate check is `pnpm triforge:doctor` (A10-W.1): it verifies the
  native toolchain, providers (observable auth only — no tokens), PostgreSQL, long-path
  status and the IDE terminal, and refuses to report ready on a blocker;
- worktrees and generated state live outside the working tree, under
  `%LOCALAPPDATA%\TriForge`;
- every Windows capability is recorded as a dated, version-bound, machine-readable
  evidence entry; nothing is marked verified without real-host (or real-provider)
  evidence.

## Rollback

The `ExecutionPlatform` boundary makes rollback clean: re-selecting `Posix`/WSL2 is a
factory change plus provisioning, with ADR 0030 still describing that substrate. No
OS-independent code is coupled to Windows. If a Windows-specific blocker proves
intractable, the project can fall back to ADR 0030's WSL2-first substrate without
rewriting the core.

## Conditions to Revisit

- a provider drops headless CLI support on Windows;
- a Windows-specific isolation gap cannot be closed to the A0.5 bar and WSL2/OS-level
  confinement becomes necessary;
- the owner reinstates a Linux/WSL2 product requirement;
- measured native-Windows behavior (Job Objects, path policy) contradicts these
  assumptions.
