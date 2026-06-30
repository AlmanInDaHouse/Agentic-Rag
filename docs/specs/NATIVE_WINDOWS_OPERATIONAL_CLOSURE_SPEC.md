# Native Windows Operational Closure — A10-W Specification

**Status:** In progress (A10-W.1 landed). **Supersedes:** the mandatory status of ADR
0030 (WSL2-first). **Decision:** ADR 0056 (native Windows primary substrate).
**Evidence:** `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` (machine-readable, gated).

## 0. Purpose

Replace the WSL2 requirement for TriForge's final operational 1.0 with **full native
Windows 11 support**. The user installs, runs and operates TriForge from a **PowerShell
terminal integrated in VS Code / Antigravity** — no WSL2, no Ubuntu, no Linux paths
(`/home`, `/mnt/c`), no Remote-WSL, no running the product inside a Linux distro. The
repo stays on NTFS (`C:\Users\<user>\…`).

This spec does not relax the A0.5 threat model (ADR 0031–0032), the no-false-green
evidence gate (ADR 0054), or the isolation mechanism (ADR 0055). It re-homes them on a
native Windows substrate and adds Windows-specific controls.

## 1. Architecture boundary (mandate §3)

All OS-specific behavior is funnelled through ONE seam; the OS-independent core
(routing, provider events, quota, collaboration, governance, ledger, quality gates)
stays platform-agnostic.

```text
ExecutionPlatform                      packages/shared/src/platform/executionPlatform.ts
├── WindowsExecutionPlatform           apps/api/src/platform/nodeExecutionPlatform.ts   (initial)
└── PosixExecutionPlatform             apps/api/src/platform/nodeExecutionPlatform.ts   (future)

detectExecutionPlatform()              apps/api/src/platform/detectPlatform.ts          (the platform-boundary dispatch site)
```

`detectExecutionPlatform()` is the only `process.platform` site *within the
ExecutionPlatform boundary*; the legacy spawn sites that still branch directly
(`apps/api/src/providers/real/processRunner.ts`, `tooling/harness/src/runner.ts`) are
subsumed into `createManagedProcess` in A10-W.4.

Contract methods: `normalizeWorkspacePath`, `validateContainedPath`,
`createManagedProcess`, `terminateProcessTree`, `createRestrictedEnvironment`,
`inspectFilesystemEntry`. A10-W.1 implements identity + normalization + FS inspection;
the heavyweight methods throw `PlatformMethodNotImplementedError(method, plannedPr)`
until their owning PR fills them in. No runtime path calls a deferred method.

## 2. Capabilities & evidence (mandate §19)

The evidence model gains:

- status `verified_real_environment` — verified on a REAL target host/OS (native
  Windows), provider-independent; a CI fixture is NOT sufficient.
- flag `requiresRealEnvironment` (optional, default false) — when true (and
  `requiresRealProvider` is false), only `verified_real_environment` (or the stronger
  `verified_real_provider`) satisfies the final gate.

Mandatory `windows_*` capabilities for the final release:

| Capability | Requires | Final bar | Owning PR |
|---|---|---|---|
| `windows_native_substrate` | real environment | `verified_real_environment` | A10-W.1 |
| `windows_path_policy` | real environment | `verified_real_environment` | A10-W.2 |
| `windows_worktree_manager` | real environment | `verified_real_environment` | A10-W.3 |
| `windows_job_object_supervision` | real environment | `verified_real_environment` | A10-W.4 |
| `windows_isolation_boundary` | real environment | `verified_real_environment` | A10-W.5 |
| `codex_windows_readonly` | real provider | `verified_real_provider` | A10-W.6 |
| `codex_windows_writable` | real provider | `verified_real_provider` | A10-W.6 |
| `claude_windows_readonly` | real provider | `verified_real_provider` | A10-W.6 |
| `claude_windows_writable` | real provider | `verified_real_provider` | A10-W.6 |
| `codex_owner_claude_reviewer_e2e` | real provider | `verified_real_provider` | A10-W.7 |
| `claude_owner_codex_reviewer_e2e` | real provider | `verified_real_provider` | A10-W.7 |
| `windows_integrated_product_e2e` | real provider | `verified_real_provider` | A10-W.8 |
| `windows_restart_recovery` | real environment | `verified_real_environment` | A10-W.8 |
| `windows_clean_install` | real environment | `verified_real_environment` | A10-W.9 |

This table enumerates the 14 native-Windows-final capabilities introduced/re-homed by
A10-W (12 `windows_*` substrate caps + the 2 cross-vendor pilot e2e caps). It is NOT the
complete mandatory set: `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` is the
authoritative gate input, and additionally enforces the pre-existing substrate-agnostic
real-provider caps re-homed to `windows-native` — `specialist_mode_real`,
`pair_mode_real`, `full_debate_mode_real`, `cancellation_real`,
`real_quota_usage_signals` (all mandatory + `requiresRealProvider`) — plus the
fixture/unit-verified core caps. `competitive_mode_real` stays `mandatoryForFinal:false`.

WSL2-intrinsic capabilities (`wsl2_operational_substrate`, `repo_on_linux_filesystem`,
`codex_installed_authenticated_wsl2`, `claude_installed_authenticated_wsl2`,
`clean_install_wsl2`) are reframed `not_applicable` + `mandatoryForFinal:false` under
ADR 0056 (WSL2 is optional/future); the writable real-capability-snapshot and
`ui_backend_real_run_e2e` caps are subsumed by their `windows_*` equivalents. Nothing is
flipped to a verified status without real evidence.

## 3. PR breakdown (mandate §21)

| PR | Scope |
|---|---|
| **A10-W.1** | governance (ADR 0056, this spec), `ExecutionPlatform` boundary, evidence-model extension, the 14 native-Windows-final capabilities, `pnpm triforge:doctor`, doc updates |
| A10-W.2 | Windows path security policy (`validateContainedPath`) |
| A10-W.3 | Windows Worktree Manager on NTFS (`%LOCALAPPDATA%\TriForge`) |
| A10-W.4 | Windows Job Object process supervisor (`createManagedProcess` / `terminateProcessTree`) |
| A10-W.5 | Windows isolation boundary + safe command policy (`createRestrictedEnvironment`) |
| A10-W.6 | Real Codex & Claude Windows adapters (read-only + writable) |
| A10-W.7 | Real provider pilots (Codex-owner / Claude-owner) |
| A10-W.8 | Integrated IDE-terminal + UI E2E + collaboration modes; restart recovery |
| A10-W.9 | Windows packaging, installer, security review, `v1.0.0` gate |

Each PR: branch from `main`; spec + acceptance criteria; tests; adversarial review; fix
findings; CI green; squash-merge; delete branch; verify `main`; update state; continue.

## 4. The doctor (`pnpm triforge:doctor`, mandate §4)

`tooling/triforge-cli/doctor.mjs` — dependency-free Node, runnable before any build.
Verifies: Windows version/arch, PowerShell, Node, pnpm, corepack, Git, repository +
NTFS, git worktree support, long-path status, PostgreSQL (TCP reachability + service;
**no password read or logged**), Codex (version + `login status`), Claude (version +
`auth status`, **PII redacted** — method/plan only), writable state root, IDE terminal.
Each check → `verified_environment | verified_version | requires_manual_auth | unknown |
unsupported`, severity `ok | warn | block`. `--json` for machine output. Exit 0 iff no
blocker. No secrets, no token reads, no credential-store inspection, no automated login.

Safe command discipline already enforced in the doctor (reference for A10-W.5): commands
are resolved deterministically via `where` (prefer `.exe`, then `.cmd`); `.cmd` shims run
through `cmd.exe /d /c <resolved> <args>` with `shell:false` (no concatenation, no
DEP0190, no `.cmd` argument-injection); the npm `.ps1` shim is never used (it swallows
piped stdout); `codex login status` is read from stderr.

## 5. Windows-specific security surface (mandate §20)

Adversarial review (A10-W.5/A10-W.9) must cover: drive escape, UNC, device paths,
junctions, reparse points, hard links, alternate data streams, case confusion,
trailing-dot/space paths, reserved device names, `.git`, Git hooks, Git global config,
PATH hijacking, DLL search order, PowerShell/cmd injection, encoded commands, process
breakaway, orphan processes, Job Object lifecycle, restricted-token effectiveness, ACL
effectiveness, environment leakage, credential paths, network exfiltration, output
flood, terminal escape sequences, reviewer write attempt, diff-review hash binding,
gate-result binding, cleanup, restart recovery, secret redaction. Blockers/criticals/
majors are fixed before the release gate.

## 6. Definition of Done (mandate §22)

The final operational 1.0 is met ONLY when, on a real Windows 11 host from a PowerShell
IDE terminal with no WSL2: every mandatory `windows_*` capability above reaches its bar
(`verified_real_environment` / `verified_real_provider`); both Codex and Claude run
read-only AND writable; both owner/reviewer pilots pass; collaboration modes pass;
backend + frontend + native PostgreSQL start from PowerShell; the UI completes a real
run; restart recovery and clean install pass; the security and chaos tests pass; CI is
green; the evidence gate is green; release notes are honest; and `v1.0.0` represents the
Windows Native Operational Release. The DoD is **not** met on the strength of mock or
fixture evidence alone.

## 7. Hard stops (mandate §23)

Only login/MFA/password, admin elevation the owner must approve, firewall changes
needing confirmation, or a PostgreSQL install requiring a password halt the affected
action. As of 2026-06-30 the provider-login hard stop is already satisfied (both CLIs
authenticated natively). When a hard stop arises: leave `main` stable, persist state,
state a single manual action, do not declare done, resume after.
