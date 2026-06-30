/**
 * Real isolation boundary (A10.2, mandate §6).
 *
 * Worktrees are NOT a sandbox. This module is the consolidated, testable surface for
 * the isolation invariants that confine a (real) provider run to its worktree. It
 * COMPOSES the existing, separately-tested primitives —
 *   - allowed-path containment (`PathPolicyEngine`, A5.2): traversal / symlink /
 *     hardlink / `.git` / `/mnt/c` / `$HOME` / sibling-worktree all denied by
 *     containment;
 *   - deny-by-default command policy (`CommandPolicy`, A5.3): network / destructive /
 *     privileged / unknown binaries refused, shell disabled;
 *   - curated child environment (`curateEnv` / `isCredentialEnvName`, A5.3): no
 *     credential-shaped env forwarded; and
 *   - process-group supervision (`NodeProcessRunner`, A5.3): timeout / output cap /
 *     SIGTERM→SIGKILL group kill
 * — and adds the A10.2-specific pieces this milestone owns:
 *   - a minimal PROVIDER env allowlist (no cloud / credential names);
 *   - `.gitattributes` smudge/clean/diff FILTER neutralization (T-FS-05 — the one git
 *     execute-on-checkout vector the A5.4 hardening did not yet close); and
 *   - declared resource limits, with honest documentation of what is enforced
 *     in-process vs. what remains a residual on this substrate.
 *
 * Invariant 13 is load-bearing: **WSL2 is not, by itself, a sufficient sandbox**. The
 * boundary is the in-process policy composition above, not the OS distro. See ADR 0055.
 */

import path from "node:path";
import { isCredentialEnvName } from "../../providers/real/processRunner.js";

/** The A10.2 isolation invariants (mandate §6). Stable ids for evidence/tests. */
export const ISOLATION_INVARIANTS = [
  { id: "no_write_outside_worktree", title: "The provider does not write outside the worktree." },
  { id: "no_credential_store_read", title: "The provider does not read credential stores." },
  { id: "no_sensitive_env_inherited", title: "The provider does not inherit sensitive env." },
  { id: "no_other_worktree_access", title: "The provider does not access other worktrees." },
  { id: "no_git_modification", title: "The provider does not modify .git." },
  { id: "no_main_modification", title: "The provider does not modify main." },
  { id: "extra_network_denied", title: "Extra network is denied by default." },
  { id: "required_network_delimited", title: "Required service network is explicitly delimited." },
  { id: "child_commands_supervised", title: "Child commands are supervised." },
  { id: "cancellation_kills_group", title: "Cancellation terminates the process group." },
  { id: "resource_limits_defined", title: "CPU/memory/time/output limits are defined." },
  { id: "artifacts_without_secrets", title: "Artifacts are retained without secrets." },
  { id: "wsl2_not_a_sandbox", title: "WSL2 is not, by itself, a sufficient sandbox." }
] as const;

export type IsolationInvariantId = (typeof ISOLATION_INVARIANTS)[number]["id"];

/**
 * Design invariant #13, made explicit so callers (and tests) cannot regress into
 * treating the OS distro as the boundary. The real boundary is the policy composition.
 */
export const WSL2_IS_NOT_A_SANDBOX = true as const;

/**
 * Minimal environment NAMES a provider run may inherit. No cloud, no credential, no
 * proxy names. Credential-shaped names are dropped even if listed (defense in depth via
 * {@link buildProviderEnv}). Mirrors the git env allowlist intent (A5.3) but for the
 * provider process.
 */
export const PROVIDER_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "Path", // win32
  "HOME",
  "HOMEDRIVE", // win32
  "HOMEPATH", // win32
  "USERPROFILE", // win32
  "SystemRoot", // win32
  "windir", // win32
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ"
];

/**
 * Build the curated provider environment from an allowlist. A credential-shaped NAME is
 * never forwarded, even if present on the allowlist, and its value is never read from
 * the source env (T-EXE-09). Pure; defaults to `process.env` + the provider allowlist.
 */
export function buildProviderEnv(
  source: NodeJS.ProcessEnv = process.env,
  allowlist: readonly string[] = PROVIDER_ENV_ALLOWLIST
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowlist) {
    if (isCredentialEnvName(name)) {
      continue;
    }
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/** Names in `env` that look like a credential leak (must be empty for a curated env). */
export function findEnvLeaks(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(isCredentialEnvName);
}

/**
 * Path segments that indicate a sensitive host location a provider must never reach.
 * Primary enforcement is path-policy containment (anything outside the worktree is
 * denied); this list is defense-in-depth + documentation for the threat model.
 */
export const SENSITIVE_HOST_PATH_SEGMENTS: readonly string[] = [
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".gcloud",
  ".kube",
  ".docker",
  ".config",
  ".npmrc",
  ".git-credentials",
  ".netrc"
];

// --- .gitattributes filter neutralization (T-FS-05) ------------------------

/**
 * Scan a `.gitattributes` body for the FILTER / DIFF driver names it references. A
 * malicious `*.x filter=evil` line makes git run `filter.evil.smudge` on checkout —
 * an execute-on-checkout vector the hook/fsmonitor hardening (A5.4) does not close.
 */
export function scanGitFilterDrivers(attributesContent: string): string[] {
  const drivers = new Set<string>();
  for (const rawLine of attributesContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    for (const match of line.matchAll(/\b(?:filter|diff)=([^\s]+)/g)) {
      const name = match[1];
      // `set`/`unset`/`-` are attribute states, not driver names.
      if (name !== undefined && name !== "set" && name !== "unset" && name !== "-") {
        drivers.add(name);
      }
    }
  }
  return [...drivers];
}

/**
 * Build `git -c` overrides that neutralize the given filter/diff drivers: an EMPTY
 * smudge/clean command is a pass-through (git runs nothing), `process` is disabled, and
 * `required=false` keeps checkout from failing closed on a now-undefined driver. Apply
 * these to every managed checkout/reset alongside the existing hook hardening.
 */
export function gitFilterNeutralizationFlags(drivers: readonly string[]): string[] {
  const flags: string[] = [];
  for (const d of drivers) {
    flags.push(
      "-c",
      `filter.${d}.smudge=`,
      "-c",
      `filter.${d}.clean=`,
      "-c",
      `filter.${d}.process=`,
      "-c",
      `filter.${d}.required=false`,
      "-c",
      `diff.${d}.command=`
    );
  }
  return flags;
}

// --- resource limits -------------------------------------------------------

export interface IsolationLimits {
  /** Wall-clock per provider invocation (enforced by the supervisor/runner). */
  timeoutMs: number;
  /** Max bytes of combined stdout/stderr before the run is killed (enforced). */
  maxOutputBytes: number;
  /** Max distinct files a run may write (enforced by the path policy). */
  maxFilesChanged: number;
  /**
   * Max resident memory. POSIX-only, best-effort (e.g. `setrlimit`/cgroup at the
   * substrate); on Windows/Node it is a documented residual, NOT silently enforced.
   */
  maxMemoryBytes?: number;
  /** Max child processes. POSIX-only, best-effort; documented residual otherwise. */
  maxProcesses?: number;
}

export const DEFAULT_ISOLATION_LIMITS: IsolationLimits = {
  timeoutMs: 300_000,
  maxOutputBytes: 5_000_000,
  maxFilesChanged: 50
};

/** True when `cwd` is the worktree root or strictly inside it (lexical; pair with realpath). */
export function cwdWithinWorktree(cwd: string, worktreeRoot: string): boolean {
  const root = path.resolve(worktreeRoot);
  const c = path.resolve(cwd);
  return c === root || c.startsWith(root + path.sep);
}
