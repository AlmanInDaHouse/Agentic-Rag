# ADR 0030: WSL2-First Local Execution Substrate

## Date

2026-06-29

## Status

Accepted

## Context

TriForge is being reoriented to coordinate official provider CLIs — Codex CLI and
Claude Code — under the user's own local subscription, with no API keys (ADR 0027,
ADR 0028, ADR 0029). Before any writable provider integration is built, the
execution substrate must be decided: where the runtime, Git, Node, pnpm, the
provider CLIs, the working repository, worktrees and quality gates run. The vision
document flagged this as `REQUIRES ADR BEFORE WRITABLE PROVIDER INTEGRATION`
(`docs/context/TRIFORGE_PROJECT_VISION.md`, Section 18). The detailed design is in
`docs/specs/WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md`.

Observed local environment, 2026-06-29 (non-destructive probe; a single machine is
not a universal guarantee):

- Host: Windows 11 (build 10.0.26200.8655); the current dev shell is native
  Windows (MSYS, `uname` → `MINGW64_NT`), not inside WSL2.
- WSL 2.6.3.0, kernel 6.6.87.2-1; default distro Ubuntu (WSL v2, **stopped**); a
  `docker-desktop` distro (WSL v2) is also present.
- Repository today: `C:\Users\manul\Agentic-Rag` on NTFS (the Windows filesystem),
  not on the Linux filesystem.
- Node v24.12.0, pnpm 11.5.0 (matches the repository's `packageManager` pin), Git
  2.52.0.windows.1, all Windows-side.
- Codex CLI 0.101.0 and Claude Code 2.1.195 installed on the Windows side.

Repository facts relevant to the decision (`VERIFIED_FROM_REPOSITORY`): CI runs on
`ubuntu-latest`; the only process-spawning code (`tooling/harness/src/runner.ts`)
already diverges by platform and, on POSIX, terminates only the lead PID (not a
process group); the Code Graph scanner relies on POSIX symlink semantics (its
symlink-escape test is skipped on win32); there is no `.gitattributes`.

## Decision Forces

- provider CLIs must run headless and locally;
- process supervision needs reliable process-group signalling and process-tree
  termination;
- the path/allowed-path model needs consistent POSIX symlink/`realpath`/
  case-sensitivity semantics;
- Git worktrees need a Linux filesystem with hardlink/symlink and atomic-rename
  support;
- local execution should match the reproducible CI substrate (Linux) to minimize
  drift;
- the choice must not pretend to be a security sandbox (the threat model is A0.5);
- the choice must not require writable execution to be built now.

## Alternatives

1. **Windows native** — run everything on Windows.
2. **WSL2-first** — run everything inside one WSL2 distribution, repo on the Linux
   filesystem; Windows hosts only the editor and browser.
3. **Hybrid** — split components across Windows and WSL2.

## Comparison

(Full matrix in the spec, Section 9.) Summary:

- **Windows native** keeps today's install but has no POSIX process groups/signals,
  drive-letter/case-insensitive paths, restricted symlinks, and diverges from the
  Linux CI substrate.
- **WSL2-first** gives POSIX process groups/signals, native symlink/`realpath`/
  case-sensitive paths, native Git worktrees, and parity with `ubuntu-latest` CI,
  at the cost of installing/starting WSL2, migrating the repo onto the Linux
  filesystem, re-provisioning the CLIs in the distro, a `/mnt/c` performance cliff
  if misplaced, and a `localhost` interop dependency.
- **Hybrid** maximizes path-translation surface, signal/semantic inconsistency and
  drift; it is the worst for process control and observability.

## Decision

Adopt **WSL2-first** as the local execution substrate for the MVP:

```text
WSL2-first
Repository on the Linux filesystem
Codex CLI and Claude Code executed inside the same WSL2 distribution
Native Windows execution deferred
```

The TriForge runtime, Git, Node, pnpm, both provider CLIs, the working repository,
worktrees and quality gates run inside one WSL2 distribution on its Linux
filesystem. Windows hosts only the editor (via remote-WSL integration) and the
browser (via `localhost` to the WSL2 service). No single run is split across
Windows and Linux. Worktrees live in an external TriForge-managed state root on the
Linux filesystem, outside the active working tree (spec Section 8.4).

This is an operational and compatibility decision. It does **not** authorize
writable provider execution and does **not** treat WSL2 as a security sandbox.

## Consequences

### Positive

- consistent POSIX process groups, signals and process-tree termination;
- consistent symlink/`realpath`/case-sensitive path semantics for the path and
  allowed-path models;
- native Git worktrees on a compatible filesystem;
- local execution matches the `ubuntu-latest` CI substrate, reducing drift;
- a single, uniform observability and execution model;
- Linux-portable foundation for any future non-Windows host.

### Negative

- one-time migration: install/start WSL2, move the repo to the Linux filesystem,
  re-provision and re-authenticate the CLIs inside the distro;
- a severe performance/fidelity penalty if the repo is left on `/mnt/c`;
- a WSL layer and distro lifecycle to manage (and coexistence with the
  `docker-desktop` distro);
- dependence on `localhost` interop for the Windows browser;
- a two-world model at the editor/browser boundary.

## Risks

- the current environment does not yet satisfy the decision (repo on NTFS, CLIs
  Windows-side, Ubuntu stopped) — the decision is a target requiring migration;
- whether the toolchain and CLIs are installed/authenticated inside the distro is
  `REQUIRES_VERIFICATION`;
- `localhost` Windows↔WSL2 interop is `REQUIRES_VERIFICATION` per machine/config;
- EOL drift between Windows and WSL2 checkouts (no `.gitattributes`,
  `core.autocrlf` in effect);
- provider/WSL/Windows version drift.

## Mitigations

- a startup substrate check (conceptual) that refuses or warns when the repo is on
  `/mnt/`, the distro is stopped/WSL1, or a CLI is not present in the active distro
  (spec Section 10);
- record substrate, distro and CLI facts as dated, version-bound assumptions; mark
  unverified items `REQUIRES_VERIFICATION`/`UNKNOWN`;
- keep worktrees and generated state out of the working tree;
- an EOL normalization policy is a candidate follow-up (not decided here).

## Conditions to Revisit

- a provider drops headless CLI support on Linux/WSL2;
- WSL2 process/signal/filesystem semantics regress materially;
- a verified requirement forces native-Windows execution;
- the A0.5 security model requires stronger OS isolation than a WSL2 distro;
- measured `/mnt`-vs-native or interop behavior contradicts these assumptions.

## Future Native Windows Support

Native Windows is deferred, not abandoned. If revisited, it requires native
process-tree control (e.g. Windows Job Objects) instead of POSIX process groups, a
Windows-aware path/boundary layer, and its own capability verification. It must not
be introduced as a partial hybrid that splits a single run across Windows and
Linux.
