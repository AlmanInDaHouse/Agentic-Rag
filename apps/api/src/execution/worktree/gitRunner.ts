/**
 * GitRunner — the injectable, HARDENED boundary for the managed git operations the
 * writable-execution runtime performs (A5.1+). The worktree manager never calls
 * `node:child_process` or `git` directly; it depends on this abstraction so:
 *
 *  - PRODUCTION uses `NodeGitRunner`, which spawns `git` with the shell disabled,
 *    an explicit argument vector, a curated environment (allowlist, never the full
 *    parent env), an output cap and a timeout — and, crucially, with git's
 *    code-execution mechanisms NEUTRALIZED so that a managed `git worktree add`
 *    (which performs a checkout and would otherwise fire `post-checkout`) cannot
 *    execute repository-controlled code:
 *      - `core.hooksPath` is pointed at an empty, manager-owned directory, so NO
 *        git hook runs (T-GIT-01);
 *      - `core.fsmonitor=false` disables the execute-on-read fsmonitor hook
 *        (T-GIT-02);
 *      - `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=<empty file>` strip the
 *        system/global config so inherited execute-on-read keys cannot run
 *        (T-GIT-02/03);
 *      - `GIT_TERMINAL_PROMPT=0` and no credential-shaped env prevent any
 *        credential prompt or leak (T-CMP-07/08).
 *  - TESTS use `FakeGitRunner`, a deterministic in-memory runner that spawns
 *    nothing — used to inject failures (disk/fs errors, non-zero exits) that a real
 *    git cannot be coerced into on demand.
 *
 * Scope note (A5.1 vs A5.4): this delivers the BASELINE hardened invocation for the
 * manager's OWN worktree lifecycle ops. The full Safe Command Policy — including
 * `.gitattributes` smudge/clean-filter neutralization (T-FS-05) and submodule
 * protocol pinning (T-GIT-04) — is A5.4. The surviving `.gitattributes` filter risk
 * is recorded as A5.1's residual risk in the capability binding.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { isCredentialEnvName } from "../../providers/real/processRunner.js";

/**
 * Default location for the manager-owned hardening assets (empty hooks dir + empty
 * global gitconfig). Deliberately a USER-OWNED path under the XDG state dir, NOT a
 * world-writable temp dir: `core.hooksPath` points here, so anyone able to plant a
 * `post-checkout` file here could defeat the T-GIT-01 control. Falls back to a
 * per-uid temp path only when no home directory is resolvable.
 */
function defaultHardeningRoot(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const home = homedir();
  const base =
    xdg && xdg.length > 0
      ? xdg
      : home && home.length > 0
        ? path.join(home, ".local", "state")
        : path.join(tmpdir(), `triforge-${process.getuid?.() ?? "user"}`);
  return path.join(base, "triforge", ".git-hardening");
}

/** Outcome of a single managed git invocation. Carries no secrets. */
export interface GitResult {
  /** Exit code, or null when the process was killed (timeout) or never started. */
  code: number | null;
  /** Captured stdout (decoded utf8, capped at `maxOutputBytes`). */
  stdout: string;
  /** Captured stderr (decoded utf8, capped at `maxOutputBytes`). */
  stderr: string;
  /** True when the runner killed git after `timeoutMs`. */
  timedOut: boolean;
  /** True when git could not be spawned at all (e.g. binary missing). */
  spawnFailed: boolean;
  /** A short, non-secret detail for a spawn failure (the error name). */
  detail?: string;
}

/** What a single managed git invocation needs. */
export interface GitRunOptions {
  /** Explicit working directory. Required — the runner never defaults to cwd. */
  cwd: string;
  /** Per-invocation timeout in milliseconds. */
  timeoutMs?: number;
  /** Combined stdout+stderr byte budget; null disables the cap. */
  maxOutputBytes?: number | null;
}

/** The injectable boundary: run a git argv and resolve with the captured result. */
export interface GitRunner {
  run(args: string[], opts: GitRunOptions): Promise<GitResult>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * Environment NAMES forwarded to git when present. The full parent environment is
 * never forwarded (T-EXE-09). These are the names git needs to locate itself, the
 * user identity dirs and locale on both POSIX (WSL2 substrate) and win32 (local
 * dev). Credential-shaped names are dropped even if listed (defense in depth).
 */
const GIT_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "Path", // win32
  "HOME",
  "HOMEDRIVE", // win32
  "HOMEPATH", // win32
  "USERPROFILE", // win32
  "SystemRoot", // win32 — git's spawned helpers need it
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
 * Production GitRunner. The single place the writable runtime spawns `git`. Every
 * invocation is hardened identically — hardening is intrinsic, not an opt-in a
 * caller could forget.
 */
export class NodeGitRunner implements GitRunner {
  private readonly gitBin: string;
  private readonly hardeningRoot: string;
  private readonly hooksDir: string;
  private readonly emptyGitConfig: string;
  private hardeningReady = false;

  constructor(options: { gitBin?: string; hardeningRoot?: string } = {}) {
    this.gitBin = options.gitBin ?? "git";
    this.hardeningRoot = options.hardeningRoot ?? defaultHardeningRoot();
    this.hooksDir = path.join(this.hardeningRoot, "empty-hooks");
    this.emptyGitConfig = path.join(this.hardeningRoot, "empty-gitconfig");
  }

  /** Idempotently materialize the empty hooks dir + empty global gitconfig. */
  private ensureHardening(): void {
    if (this.hardeningReady) {
      return;
    }
    mkdirSync(this.hooksDir, { recursive: true });
    // An empty file => no config keys => no execute-on-read global config.
    writeFileSync(this.emptyGitConfig, "", { flag: "w" });
    this.hardeningReady = true;
  }

  /** Command-line `-c` overrides applied to EVERY managed git op (highest precedence). */
  private hardeningFlags(): string[] {
    const flags = [
      "-c",
      `core.hooksPath=${this.hooksDir}`, // T-GIT-01: no hook runs
      "-c",
      "core.fsmonitor=false", // T-GIT-02: no execute-on-read fsmonitor
      "-c",
      "advice.detachedHead=false"
    ];
    // A10-W.3: on native Windows, mitigate MAX_PATH (260) truncation for deep
    // worktree paths without requiring the admin-only LongPathsEnabled registry flag.
    if (process.platform === "win32") {
      flags.push("-c", "core.longpaths=true");
    }
    return flags;
  }

  private gitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of GIT_ENV_ALLOWLIST) {
      if (isCredentialEnvName(name)) {
        continue;
      }
      const value = process.env[name];
      if (value !== undefined) {
        env[name] = value;
      }
    }
    // Hardening overrides (T-GIT-02/03, T-CMP-07/08).
    env.GIT_CONFIG_NOSYSTEM = "1";
    env.GIT_CONFIG_GLOBAL = this.emptyGitConfig;
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_OPTIONAL_LOCKS = "0";
    return env;
  }

  run(args: string[], opts: GitRunOptions): Promise<GitResult> {
    this.ensureHardening();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes =
      opts.maxOutputBytes === undefined ? DEFAULT_MAX_OUTPUT_BYTES : opts.maxOutputBytes;
    const fullArgs = [...this.hardeningFlags(), ...args];

    return new Promise<GitResult>((resolve) => {
      let settled = false;
      let timedOut = false;
      let outBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn(this.gitBin, fullArgs, {
        cwd: opts.cwd,
        env: this.gitEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === "function") {
        (timer as { unref: () => void }).unref();
      }

      const capture = (chunks: Buffer[], chunk: Buffer): void => {
        if (maxOutputBytes !== null) {
          if (outBytes >= maxOutputBytes) {
            return;
          }
          outBytes += chunk.byteLength;
        }
        chunks.push(chunk);
      };

      child.stdout.on("data", (c: Buffer) => capture(stdoutChunks, c));
      child.stderr.on("data", (c: Buffer) => capture(stderrChunks, c));

      const finish = (result: GitResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.on("error", (error: Error) => {
        finish({
          code: null,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
          spawnFailed: true,
          detail: error.name
        });
      });

      child.on("close", (code: number | null) => {
        finish({
          code,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          timedOut,
          spawnFailed: false
        });
      });
    });
  }
}

// =========================================================================
// FakeGitRunner (tests — spawns nothing; deterministic failure injection)
// =========================================================================

/** A scripted reply for a matching git invocation. */
export interface FakeGitReply {
  code: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  spawnFailed?: boolean;
  detail?: string;
}

/** Derives a reply from the argv (and cwd) of a call; return null to fall through. */
export type FakeGitHandler = (args: string[], opts: GitRunOptions) => FakeGitReply | null;

/**
 * Deterministic in-memory GitRunner for tests. Records every call and replies from
 * a handler (or a default success). Spawns nothing, reads no env, touches no fs.
 */
export class FakeGitRunner implements GitRunner {
  readonly calls: { args: string[]; opts: GitRunOptions }[] = [];
  private readonly handler: FakeGitHandler;

  constructor(handler?: FakeGitHandler) {
    this.handler = handler ?? (() => null);
  }

  run(args: string[], opts: GitRunOptions): Promise<GitResult> {
    this.calls.push({ args, opts });
    const reply = this.handler(args, opts) ?? { code: 0 };
    return Promise.resolve({
      code: reply.code,
      stdout: reply.stdout ?? "",
      stderr: reply.stderr ?? "",
      timedOut: reply.timedOut ?? false,
      spawnFailed: reply.spawnFailed ?? false,
      detail: reply.detail
    });
  }
}
