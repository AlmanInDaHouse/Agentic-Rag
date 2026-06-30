/**
 * Safe Command Policy (A5.3) — classifies a concrete command (binary + argv) into a
 * risk category and decides, DENY-BY-DEFAULT, whether the writable runtime may run it
 * inside a worktree.
 *
 * This is NOT the high-level action-type policy of ADR 0011
 * (`SafeExecutionPolicyService`, which classifies semantic actions in the mock
 * runtime). A5.3 classifies REAL commands an owner agent proposes to execute, so the
 * supervisor (A5.3 `CommandSupervisor`) can refuse a dangerous one before any spawn.
 *
 * Security model (PROVIDER_REPOSITORY_THREAT_MODEL_SPEC T-EXE-01/02, T-CMP-06;
 * SAT-A5-4):
 *
 *  - **No shell.** The runtime always spawns the binary directly with a separated
 *    argv (`shell:false`). Shell metacharacters (`;`, `|`, `$()`, backticks, `&&`)
 *    in an argument are therefore inert literal DATA — they cannot inject a second
 *    command. The classifier inspects the binary and argv STRUCTURALLY; it is never
 *    fooled by metacharacters because it never interprets them as a shell would.
 *  - **Deny by default.** An unknown binary classifies as `blocked`. Only categories
 *    the run explicitly allows may execute.
 *  - **Dual binaries are refined by argv.** `git`/`npm`/`pnpm`/`yarn` map to
 *    different categories depending on the subcommand/flags (e.g. `git status` is
 *    read-only, `git push` is network, `git push --force` / `git reset --hard` are
 *    destructive).
 *  - **cwd containment.** The command's working directory must be the workspace root
 *    or inside it (a command outside the workspace is refused).
 */

import path from "node:path";
import { realpathSync, existsSync } from "node:fs";

export type CommandCategory =
  | "read_only"
  | "test"
  | "build"
  | "write_local"
  | "network"
  | "destructive"
  | "privileged"
  | "blocked";

export interface CommandSpec {
  /** The binary to execute (basename or path). Never a shell string. */
  bin: string;
  /** Separated argument vector — literal data, never shell-interpreted. */
  args: string[];
}

export interface CommandClassification {
  category: CommandCategory;
  /** Short, non-secret reason for the classification. */
  reason: string;
}

export type CommandDenyReason =
  | "category_not_allowed"
  | "blocked_command"
  | "cwd_outside_workspace"
  | "invalid_command";

export interface CommandDecision {
  allowed: boolean;
  category: CommandCategory;
  bin: string;
  reason: string;
  denyReason?: CommandDenyReason;
}

/** Categories permitted by default for a low-risk run (mandate §A5.3 deny-by-default). */
export const DEFAULT_ALLOWED_CATEGORIES: readonly CommandCategory[] = [
  "read_only",
  "test",
  "build",
  "write_local"
];

// --- classification tables -------------------------------------------------
// Conservative; unknown binaries fall through to `blocked` (deny by default).

const PRIVILEGED = new Set([
  "sudo", "su", "doas", "pkexec", "mount", "umount", "systemctl", "service", "chown", "chgrp", "setcap", "visudo",
  // A10-W.5 — Windows privileged / system-mutating tools (registry, service,
  // scheduled tasks, firewall/network config, ACL, Defender, disk, recovery).
  "reg", "regedit", "sc", "schtasks", "netsh", "bcdedit", "diskpart", "takeown", "icacls", "cacls",
  "net", "net1", "wmic", "runas", "regsvr32", "rundll32", "wevtutil", "vssadmin", "cipher", "dism",
  "powercfg", "fsutil", "auditpol", "secedit", "gpupdate", "reagentc", "shutdown", "control"
]);
const DESTRUCTIVE = new Set([
  "rm", "rmdir", "dd", "mkfs", "shred", "truncate", "fdisk", "parted", "wipefs", "chmod",
  // A10-W.5 — Windows destructive (delete/format). cmd builtins (del/erase/rd) only
  // reach here if invoked as a bin; via `cmd /c` they are blocked at the shell gate.
  "del", "erase", "format", "rd"
]);
const NETWORK = new Set([
  "curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync", "telnet", "ftp", "ping", "nmap", "socat",
  // A10-W.5 — Windows network / download tools.
  "bitsadmin", "certutil", "tftp"
]);
/**
 * A10-W.5 — shells, script hosts and the provider CLIs themselves. Blocked by
 * default: `cmd /c`, PowerShell script blocks / encoded commands, WSH and HTA all
 * defeat the no-shell, structural-classification guarantee; an owner agent
 * re-invoking codex/claude is also denied.
 */
const SHELLS_AND_HOSTS = new Set([
  "cmd", "powershell", "pwsh", "wscript", "cscript", "mshta", "bash", "sh", "zsh",
  "codex", "claude"
]);
const READ_ONLY = new Set(["cat", "ls", "pwd", "echo", "grep", "egrep", "fgrep", "rg", "find", "head", "tail", "wc", "stat", "file", "which", "true", "false", "test", "diff", "sort", "uniq", "cut", "tr", "basename", "dirname", "realpath", "readlink", "date", "printf", "tree", "cmp", "sha256sum", "md5sum"]);
const TEST = new Set(["vitest", "jest", "mocha", "pytest", "phpunit", "rspec", "ctest"]);
const BUILD = new Set(["tsc", "tsx", "esbuild", "rollup", "webpack", "vite", "make", "cmake", "gradle", "mvn", "cargo", "go", "rustc", "gcc", "g++", "clang", "javac"]);
const WRITE_LOCAL = new Set(["mkdir", "touch", "cp", "mv", "tee", "ln", "sed", "awk", "patch", "gofmt", "prettier", "eslint", "black", "ruff"]);

/**
 * Strip a directory and a `.exe`/`.cmd` suffix; lowercase. Splits on BOTH `/` and
 * `\` regardless of platform so a Windows-style path is normalized on POSIX too
 * (`path.basename` on POSIX does not treat `\` as a separator).
 */
function binName(bin: string): string {
  const segments = bin.split(/[/\\]/);
  const base = (segments[segments.length - 1] ?? "").toLowerCase();
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "");
}

/** First argument that is not an option flag (the subcommand), or null. */
function firstSubcommand(args: string[]): string | null {
  for (const a of args) {
    if (!a.startsWith("-")) {
      return a.toLowerCase();
    }
  }
  return null;
}

function classifyGit(args: string[]): CommandClassification {
  const sub = firstSubcommand(args);
  // `--force`, `--force-with-lease`, `-f` all count as a force push.
  const hasForce = args.some((a) => a === "-f" || a.startsWith("--force"));
  if (sub === "push" || sub === "pull" || sub === "fetch" || sub === "clone" || sub === "remote" || sub === "submodule") {
    if (sub === "push" && hasForce) {
      return { category: "destructive", reason: "git force-push" };
    }
    return { category: "network", reason: `git ${sub} (network)` };
  }
  if (sub === "reset" && args.includes("--hard")) {
    return { category: "destructive", reason: "git reset --hard" };
  }
  if (sub === "clean" && args.some((a) => /^-[a-z]*f/i.test(a))) {
    return { category: "destructive", reason: "git clean -f" };
  }
  if (sub === "branch" && (args.includes("-D") || args.includes("-d") || args.includes("--delete"))) {
    return { category: "destructive", reason: "git branch delete" };
  }
  const readOnlySubs = new Set(["status", "log", "diff", "show", "rev-parse", "cat-file", "ls-files", "ls-tree", "blame", "describe", "config", "for-each-ref", "show-ref", "rev-list"]);
  if (sub !== null && readOnlySubs.has(sub)) {
    return { category: "read_only", reason: `git ${sub} (read-only)` };
  }
  const writeSubs = new Set(["add", "commit", "checkout", "switch", "restore", "stash", "merge", "rebase", "cherry-pick", "tag", "worktree", "mv", "rm", "apply", "am", "init"]);
  if (sub !== null && writeSubs.has(sub)) {
    return { category: "write_local", reason: `git ${sub} (local write)` };
  }
  // Unknown git subcommand → deny by default.
  return { category: "blocked", reason: `git ${sub ?? "?"} (unclassified)` };
}

function classifyNodePm(name: string, args: string[]): CommandClassification {
  const sub = firstSubcommand(args);
  const installish = new Set(["install", "i", "add", "ci", "update", "upgrade", "dlx", "exec", "create", "init"]);
  if (sub !== null && installish.has(sub)) {
    return { category: "network", reason: `${name} ${sub} (fetches packages)` };
  }
  if (sub === "test" || (sub === "run" && args.includes("test"))) {
    return { category: "test", reason: `${name} test` };
  }
  if (sub === "build" || (sub === "run" && args.includes("build"))) {
    return { category: "build", reason: `${name} build` };
  }
  // `npm run <arbitrary>` and anything else → deny by default (the script can do anything).
  return { category: "blocked", reason: `${name} ${sub ?? "?"} (unclassified script)` };
}

/** Classify a command into a risk category (structural; never shell-interpreted). */
export function classifyCommand(command: CommandSpec): CommandClassification {
  const name = binName(command.bin);
  if (name.length === 0) {
    return { category: "blocked", reason: "empty binary" };
  }
  // Explicit high-risk binaries win regardless of args.
  if (PRIVILEGED.has(name)) {
    return { category: "privileged", reason: `${name} is privileged` };
  }
  if (DESTRUCTIVE.has(name)) {
    return { category: "destructive", reason: `${name} is destructive` };
  }
  if (NETWORK.has(name)) {
    return { category: "network", reason: `${name} performs network I/O` };
  }
  // A10-W.5 — a shell / script host / provider CLI is blocked by default: it would
  // defeat the no-shell structural-classification guarantee (encoded commands,
  // `cmd /c`, PowerShell script blocks, WSH/HTA), or recursively invoke a provider.
  if (SHELLS_AND_HOSTS.has(name)) {
    return { category: "blocked", reason: `${name} is a shell/script-host/provider (denied by default)` };
  }
  // Dual binaries refined by argv.
  if (name === "git") {
    return classifyGit(command.args);
  }
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "npx") {
    return classifyNodePm(name, command.args);
  }
  if (name === "node") {
    // `node script.js` can do anything; treat as build/test only via the package
    // managers above. Bare node is deny-by-default.
    return { category: "blocked", reason: "bare node invocation (unclassified)" };
  }
  if (READ_ONLY.has(name)) {
    return { category: "read_only", reason: `${name} is read-only` };
  }
  if (TEST.has(name)) {
    return { category: "test", reason: `${name} is a test runner` };
  }
  if (BUILD.has(name)) {
    return { category: "build", reason: `${name} is a build tool` };
  }
  if (WRITE_LOCAL.has(name)) {
    return { category: "write_local", reason: `${name} writes locally` };
  }
  return { category: "blocked", reason: `${name} is not on the allow-list (deny by default)` };
}

export interface CommandPolicyConfig {
  /** Categories permitted for this run. Default: read_only/test/build/write_local. */
  allowedCategories?: readonly CommandCategory[];
}

/**
 * Decides whether a command may run, given the allowed categories and the workspace
 * root the command's cwd must stay inside. Pure + synchronous.
 */
export class CommandPolicy {
  private readonly allowed: ReadonlySet<CommandCategory>;
  private readonly realWorkspaceRoot: string;

  constructor(options: { workspaceRoot: string; config?: CommandPolicyConfig }) {
    const root = path.resolve(options.workspaceRoot);
    this.realWorkspaceRoot = existsSync(root) ? realpathSync(root) : root;
    this.allowed = new Set(options.config?.allowedCategories ?? DEFAULT_ALLOWED_CATEGORIES);
  }

  classify(command: CommandSpec): CommandClassification {
    return classifyCommand(command);
  }

  /** Decide allow/deny for a command with an explicit working directory. */
  check(command: CommandSpec, cwd: string): CommandDecision {
    if (typeof command.bin !== "string" || command.bin.length === 0 || !Array.isArray(command.args)) {
      return {
        allowed: false,
        category: "blocked",
        bin: String(command.bin),
        reason: "invalid command spec",
        denyReason: "invalid_command"
      };
    }
    // cwd must be the workspace root or inside it.
    if (!this.isCwdContained(cwd)) {
      return {
        allowed: false,
        category: "blocked",
        bin: command.bin,
        reason: `cwd is outside the workspace: ${cwd}`,
        denyReason: "cwd_outside_workspace"
      };
    }
    const { category, reason } = classifyCommand(command);
    if (category === "blocked") {
      return { allowed: false, category, bin: command.bin, reason, denyReason: "blocked_command" };
    }
    if (!this.allowed.has(category)) {
      return {
        allowed: false,
        category,
        bin: command.bin,
        reason: `${category} is not permitted for this run (${reason})`,
        denyReason: "category_not_allowed"
      };
    }
    return { allowed: true, category, bin: command.bin, reason };
  }

  private isCwdContained(cwd: string): boolean {
    const resolved = path.resolve(cwd);
    const real = existsSync(resolved) ? safeRealpath(resolved) : resolved;
    if (real === null) {
      return false;
    }
    return real === this.realWorkspaceRoot || real.startsWith(this.realWorkspaceRoot + path.sep);
  }
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
