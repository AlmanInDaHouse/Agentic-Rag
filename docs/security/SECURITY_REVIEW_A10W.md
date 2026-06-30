# A10-W.9 — Windows adversarial security review (34 vectors)

**Date:** 2026-06-30 · **Method:** six parallel adversarial audit buckets (each told to
*try to break* the control for its vectors and cite the code), covering the mandate §15
vector list on the native-Windows substrate. **Result:** 0 blockers, 0 criticals,
**4 majors**, the remainder controlled (with documented residuals).

Disposition summary: **1 major fixed in code** (executable shadowing); **3 majors are
facets of the single documented "the OS is not, by itself, a sandbox" residual** that
ADR 0055 / 0056 explicitly accept for 1.0 (RR-4 / invariant-13 / R-WIN-3) — recorded as
accepted residual risks, not new unaddressed holes.

## Confirmed majors

| # | Vector | Finding | Disposition |
|---|---|---|---|
| 1 | **Executable shadowing** | `NodeGitRunner` spawned the bare name `git` with `cwd=<worktree>`; on Windows `CreateProcess` searches the current directory before PATH, so a target repo committing `git.exe`/`git.cmd` at its root could shadow the real git for managed `git add/commit/diff`. The absolute-resolution pattern existed for providers/gates but not for git. | **FIXED** — `resolveGitExecutable()` pins git to an absolute path via `where.exe` (run from System32, never the worktree); POSIX bare names untouched. `apps/api/src/test/gitRunnerResolve.test.ts`. |
| 2 | **DLL search-order hijack** | Children (provider exe / node / the PS job-holder / git) run with `cwd=<worktree>`; no `SetDefaultDllDirectories`/`SetDllDirectory("")`, so a repo committing a DLL matching one a child loads by bare name (delay-load/plugin/non-KnownDLL) could be loaded from the worktree. | **Accepted residual (RR-4 / R-WIN-3).** OS/loader-level confinement is explicitly out of 1.0 scope (ADR 0055/0056); EXEs are pinned, KnownDLLs are protected. Tracked in the risk register; future hardening = a native manifest / `SetDefaultDllDirectories` per spawn or an OS sandbox. |
| 3 | **Credential-path exposure** | The path policy governs only TriForge-*mediated* file ops; the real provider PROCESS runs with the operator's full NTFS read rights and is not OS-sandboxed (invariant 13). Compounding: `CommandPolicy.check()` validates a command's cwd-containment + binary category but **not its arguments**, so a `read_only`-category `cat <abs-credential-path>` with cwd in the worktree is allowed. | **Accepted residual (invariant-13 / RR-4)** for the provider-process read; the argument-containment gap is logged as a **defense-in-depth follow-up** (the provider can read credentials via its own file I/O regardless, so arg-containment does not close the underlying residual). UI secret-redaction (`sanitize.ts`) is a best-effort backstop. |
| 4 | **Network exfiltration** | No OS egress firewall (invariant 7 is enforced by the command-name classifier, not netfilter). The provider process must reach its own LLM API (unrestricted outbound), and default-allowed `test`/`build` gates execute attacker-controlled repo code with network access. | **Accepted residual (RR-4).** Explicit-network tools (curl/wget/nc/ssh/certutil/bitsadmin/git push…) are denied by default; an OS firewall rule per run is future work. |

## Controlled vectors (with the implemented control + evidence)

| Vectors | Control | Evidence |
|---|---|---|
| drive escape, UNC, device (`\\.\`,`\\?\`), extended-length, case confusion, trailing dot/space, reserved device names | deny-by-default Windows containment: volume identity + canonical realpath + case-folded segment containment (never raw `startsWith`) | `apps/api/src/platform/windowsPathPolicy.ts`, `apps/api/src/execution/path/pathPolicy.ts`; host tests `windowsPathPolicy.host.test.ts`, `pathPolicy.windows.host.test.ts` |
| junction escape, reparse points, symlinks, hardlinks, ADS, `.git` | reparse/`lstat` refusal at check time + `.git` deny + ADS/hardlink containment | same path-policy modules + host tests (real `mklink /J`) |
| Git hooks, Git global/system config | `core.hooksPath`=empty dir, `core.fsmonitor=false`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL`=empty | `apps/api/src/execution/worktree/gitRunner.ts` |
| PowerShell/cmd injection, encoded commands, script hosts (wscript/cscript/mshta), PATH hijack | `shell:false` (metacharacters inert), deny-by-default classifier, blocked shells/script-hosts/bare-node, providers+gates resolved to absolute exes | `apps/api/src/execution/command/commandPolicy.ts`, `trustedCommandRunner.ts`, `providers/real/windowsLauncher.ts`; `commandPolicy.windows.test.ts` |
| provider recursion, Job Object breakaway, orphan process | `codex`/`claude`/`triforge` blocked as commands; Job Object `KILL_ON_JOB_CLOSE`, breakaway NOT set; grandchild reaped on cancel | `apps/api/src/platform/windowsJobObject.ts`; host chaos `windowsJobObject.host.test.ts` |
| environment leakage, credential paths (env) | `createRestrictedEnvironment`: allowlist + ALWAYS-drop credential-shaped names | `apps/api/src/platform/nodeExecutionPlatform.ts`; `executionPlatform.test.ts` |
| output flood, terminal escape sequences | output byte cap (runner/ledger) + `sanitize.ts` (ANSI/control strip, secret redaction, truncation flag) in the UI | `providers/real/processRunner.ts`, `apps/web/src/lib/sanitize.ts` |
| reviewer write attempt | role enforcer denies reviewer writes; a `file.changed` under read-only review is a `blocker` finding | `apps/api/src/execution/role/*`, `execution/e2e/realPilot.ts` |
| diff-review + gate-result binding | governance verdict re-derived and bound to diff/ledger/gate hashes (replay/post-decision tampering rejected) | `apps/api/src/execution/governance/governanceGate.ts`; `mutationLedger.ts` (hash chain) |
| restart recovery + cleanup | run reconstructed from the store (single terminal, no double-merge); worktree + Job Object cleanup | `execution/observability/runReconstruction.ts`, `execution/integrated/integratedRunService.ts` (`recover()`), `worktreeManager.ts` |

## Residual risk register additions

- **R-WIN-3 (DLL search-order):** confirmed major → accepted 1.0 residual (no OS/loader sandbox; EXEs pinned, KnownDLLs protected). Future: native `SetDefaultDllDirectories` per spawn / app manifest / OS sandbox.
- **R-WIN-4 (provider-process NTFS read / credential exposure):** invariant-13 residual (the provider is not OS-sandboxed). Defense-in-depth follow-up: argument-path containment in `CommandPolicy.check()`.
- **R-WIN-5 (egress):** no OS firewall; the provider + test/build gates have outbound network. Future: per-run firewall rule.

All three are consistent with the project's standing posture (ADR 0055/0056: the OS is
not trusted as a sandbox; OS-level confinement is honest residual risk, never claimed as
perfect isolation). No blocker/critical was found; the one genuinely fixable major
(executable shadowing) is fixed and tested.
