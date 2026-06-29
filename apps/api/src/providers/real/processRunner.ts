/**
 * ProcessRunner — the injectable child-process boundary for the real provider
 * adapters (A3).
 *
 * The real Codex/Claude adapters never touch `node:child_process` directly. They
 * depend on this `ProcessRunner` abstraction so that:
 *
 *  - PRODUCTION uses `NodeProcessRunner`, the ONLY code in the repository that
 *    spawns a CLI. It runs the binary directly (shell disabled), with an explicit
 *    argument vector, a curated environment built from an allowlist, an explicit
 *    working directory, an output-byte cap, a per-invocation timeout and a process
 *    GROUP so the whole tree can be signalled (WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC
 *    §8.5: "killing the lead PID does not kill the tree").
 *  - TESTS/CI use `FakeProcessRunner`, which replays a scripted sequence of raw
 *    output lines + a terminal exit. It is deterministic, spawns nothing, reads no
 *    credentials and touches neither the network nor the filesystem. CI (ubuntu,
 *    no Codex/Claude installed or authed) MUST only ever use the fake.
 *
 * Security model (PROVIDER_REPOSITORY_THREAT_MODEL_SPEC; OFFICIAL_CLI_PROVIDER_
 * INTEGRATION_SPEC §12): the environment is an allowlist of NAMES whose values are
 * pulled from `process.env` at call time — the full parent environment is never
 * forwarded (T-EXE-09). Nothing here reads, stores or logs a credential; output is
 * captured as raw evidence for the normalizer to sanitize.
 */

import { spawn, type ChildProcess } from "node:child_process";

/** Which OS stream a captured output line came from. */
export type ProcessStream = "stdout" | "stderr";

/** A single captured output line, tagged with its originating stream. */
export interface ProcessOutputLine {
  stream: ProcessStream;
  /** One line of output WITHOUT the trailing newline. */
  line: string;
}

/**
 * Why a process ended, from the runner's point of view. The normalizer maps this
 * onto the A1 error taxonomy for the single terminal event.
 */
export type ProcessTerminationReason =
  | "exited" // the process exited on its own (see code / signal)
  | "timeout" // the runner killed it after `timeoutMs`
  | "cancelled" // `cancel()` was called and the runner killed the group
  | "output_limit" // `maxOutputBytes` exceeded; the runner killed the group
  | "spawn_error"; // the process could not be spawned (e.g. binary not found)

/** Terminal exit status of a run. Carries no secrets. */
export interface ProcessExit {
  /** Exit code, or null when the process was killed by a signal / never started. */
  code: number | null;
  /** Terminating signal, or null. */
  signal: NodeJS.Signals | string | null;
  /** Why the run ended (runner's perspective). */
  reason: ProcessTerminationReason;
  /** A short, non-secret detail (e.g. the spawn error name). */
  detail?: string;
}

/** What a `ProcessRunner.run(spec)` is asked to launch. */
export interface ProcessRunSpec {
  /** Absolute or PATH-resolvable binary name. Executed directly (no shell). */
  bin: string;
  /** Explicit argument vector — never a shell string. */
  args: string[];
  /** Explicit working directory. */
  cwd: string;
  /**
   * Names of environment variables that MAY be forwarded. Values are read from
   * `process.env` at call time; everything not on the list is dropped (the
   * conservative allowlist of CLI spec §12 / threat model T-EXE-09).
   */
  envAllowlist: string[];
  /** Per-invocation timeout in milliseconds. */
  timeoutMs: number;
  /** Output-byte budget across stdout+stderr; `null` disables the cap. */
  maxOutputBytes: number | null;
}

/**
 * A launched process. Exposes the raw output as an `AsyncIterable` (stdout+stderr
 * interleaved, each line tagged), a `cancel()` that signals the whole process
 * GROUP, and an `exit` promise that resolves once the process has ended and output
 * has drained.
 */
export interface RunningProcess {
  /** Raw output lines, in arrival order, terminating when the process ends. */
  readonly output: AsyncIterable<ProcessOutputLine>;
  /** Request termination of the entire process group (SIGTERM→grace→SIGKILL / taskkill /T). Idempotent. */
  cancel(): Promise<void>;
  /** Resolves with the terminal exit once the process ends and output drains. */
  readonly exit: Promise<ProcessExit>;
}

/** The injectable boundary: turn a spec into a `RunningProcess`. */
export interface ProcessRunner {
  run(spec: ProcessRunSpec): RunningProcess;
}

// =========================================================================
// FakeProcessRunner (tests / CI — spawns nothing)
// =========================================================================

/** A scripted run the fake replays: ordered output lines + a terminal exit. */
export interface FakeProcessScript {
  /** Raw output lines yielded, in order, before the exit. */
  lines: ProcessOutputLine[];
  /** Terminal exit reported when output drains normally. */
  exit: ProcessExit;
  /**
   * Exit reported instead if `cancel()` is called before output drains. Defaults
   * to a `cancelled` exit (code null, SIGTERM).
   */
  cancelledExit?: ProcessExit;
}

/** A script, or a function that derives one from the spec (e.g. by inspecting argv). */
export type FakeScriptSource = FakeProcessScript | ((spec: ProcessRunSpec) => FakeProcessScript);

const DEFAULT_CANCELLED_EXIT: ProcessExit = {
  code: null,
  signal: "SIGTERM",
  reason: "cancelled"
};

/**
 * Deterministic in-memory `ProcessRunner` for tests. It NEVER spawns a process,
 * reads an env var value, opens a socket or touches the filesystem. `cancel()`
 * stops the scripted stream at the next line boundary and resolves `exit` with the
 * cancelled exit, mirroring a cooperative real cancellation.
 */
export class FakeProcessRunner implements ProcessRunner {
  /** Every spec the adapter asked to run — for argv / env-allowlist assertions. */
  readonly calls: ProcessRunSpec[] = [];
  private readonly source: FakeScriptSource;

  constructor(source: FakeScriptSource) {
    this.source = source;
  }

  run(spec: ProcessRunSpec): RunningProcess {
    this.calls.push(spec);
    const script = typeof this.source === "function" ? this.source(spec) : this.source;
    return createFakeRunningProcess(script);
  }
}

function createFakeRunningProcess(script: FakeProcessScript): RunningProcess {
  let cancelled = false;
  let resolveExit!: (value: ProcessExit) => void;
  const exit = new Promise<ProcessExit>((resolve) => {
    resolveExit = resolve;
  });

  async function* output(): AsyncGenerator<ProcessOutputLine> {
    try {
      for (const line of script.lines) {
        // Observe cooperative cancellation at the line boundary, before AND after
        // the microtask hop, exactly as a real adapter sees in-flight buffering.
        if (cancelled) {
          return;
        }
        await Promise.resolve();
        if (cancelled) {
          return;
        }
        yield line;
      }
    } finally {
      resolveExit(cancelled ? (script.cancelledExit ?? DEFAULT_CANCELLED_EXIT) : script.exit);
    }
  }

  return {
    output: output(),
    cancel: async (): Promise<void> => {
      cancelled = true;
    },
    exit
  };
}

// =========================================================================
// NodeProcessRunner (production — the ONLY child_process.spawn site)
// =========================================================================

/** Bounded grace before escalating SIGTERM → SIGKILL on POSIX (ms). */
const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * A minimal push→pull async queue: producers `push` lines and `close` the queue;
 * a single consumer iterates. Used to bridge Node's event-based stdout/stderr into
 * the `AsyncIterable<ProcessOutputLine>` the adapters consume.
 */
class LineQueue {
  private readonly buffer: ProcessOutputLine[] = [];
  private waiting: ((result: IteratorResult<ProcessOutputLine>) => void) | null = null;
  private closed = false;

  push(line: ProcessOutputLine): void {
    if (this.closed) {
      return;
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: line, done: false });
    } else {
      this.buffer.push(line);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined as unknown as ProcessOutputLine, done: true });
    }
  }

  iterable(): AsyncIterable<ProcessOutputLine> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<ProcessOutputLine> {
        return {
          next(): Promise<IteratorResult<ProcessOutputLine>> {
            if (self.buffer.length > 0) {
              return Promise.resolve({ value: self.buffer.shift() as ProcessOutputLine, done: false });
            }
            if (self.closed) {
              return Promise.resolve({ value: undefined as unknown as ProcessOutputLine, done: true });
            }
            return new Promise<IteratorResult<ProcessOutputLine>>((resolve) => {
              self.waiting = resolve;
            });
          }
        };
      }
    };
  }
}

/**
 * Credential-name DENYLIST (defense in depth; threat model T-EXE-09 / TB-4).
 *
 * Even if a caller puts a credential-shaped NAME on an env allowlist, its value is
 * NEVER read from `process.env` nor forwarded to the child. Matched
 * case-insensitively against common credential patterns so that an allowlist
 * mistake (or a malicious caller) cannot leak a secret into the provider process.
 *
 * Covers at minimum: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_*KEY*`,
 * `*_API_KEY`, `*TOKEN*` (e.g. `GH_TOKEN` / `GITHUB_TOKEN` / `AWS_SESSION_TOKEN`),
 * `AWS_SECRET_ACCESS_KEY`, `*SECRET*`, `*PASSWORD*`, `*_PAT`.
 */
const CREDENTIAL_NAME_PATTERNS: readonly RegExp[] = [
  /API[_-]?KEY/i, // *_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, APIKEY
  /^OPENAI_.*KEY/i, // OPENAI_*KEY* (any OpenAI key variant)
  /SECRET/i, // *SECRET* (e.g. AWS_SECRET_ACCESS_KEY, CLIENT_SECRET)
  /TOKEN/i, // *TOKEN* (GH_TOKEN, GITHUB_TOKEN, AWS_SESSION_TOKEN)
  /PASSWORD/i, // *PASSWORD*
  /PASSWD/i, // *PASSWD*
  /(^|_)PAT$/i, // *_PAT (personal access token)
  /CREDENTIAL/i, // *CREDENTIAL*
  /PRIVATE[_-]?KEY/i // *PRIVATE_KEY*
];

/**
 * True when an env-var NAME looks like a credential and must never be forwarded to
 * a child process, regardless of any allowlist. Case-insensitive.
 */
export function isCredentialEnvName(name: string): boolean {
  return CREDENTIAL_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Build the curated child environment from the allowlist (values from process.env).
 * A credential-shaped NAME is dropped even if present on the allowlist, and its
 * value is never read from `process.env` (defense in depth, T-EXE-09 / TB-4).
 */
export function curateEnv(allowlist: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowlist) {
    if (isCredentialEnvName(name)) {
      continue;
    }
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/**
 * Production `ProcessRunner`. This is the single place in the codebase that calls
 * `child_process.spawn`. It is exercised ONLY by the manual live-smoke step
 * (REQUIRES_VERIFICATION) — never by unit tests or CI, which use
 * `FakeProcessRunner`.
 *
 * Process model (WSL2 substrate §8.5): direct binary, `shell:false`, explicit
 * argv, curated env from the allowlist only, explicit cwd, and `detached:true` on
 * POSIX so the child leads its own process GROUP. Cancellation/timeout signal the
 * GROUP — `process.kill(-pid, …)` on POSIX (SIGTERM → bounded grace → SIGKILL) and
 * `taskkill /PID <pid> /T /F` on win32 — because signalling only the lead PID does
 * not terminate the tree.
 */
export class NodeProcessRunner implements ProcessRunner {
  private readonly killGraceMs: number;

  constructor(options: { killGraceMs?: number } = {}) {
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  run(spec: ProcessRunSpec): RunningProcess {
    const queue = new LineQueue();
    let resolveExit!: (value: ProcessExit) => void;
    const exit = new Promise<ProcessExit>((resolve) => {
      resolveExit = resolve;
    });

    let settled = false;
    let pendingReason: ProcessTerminationReason | null = null;
    let outputBytes = 0;
    const stdoutBuffer = { rest: "" };
    const stderrBuffer = { rest: "" };
    // The pending POSIX SIGKILL-grace timer (if any). Tracked so it can be cleared
    // on settle — otherwise it could fire after the child already exited and signal
    // a reused PID/PGID (collateral kill).
    const killState: KillState = { sigkillTimer: null };

    const child = spawn(spec.bin, spec.args, {
      cwd: spec.cwd,
      env: curateEnv(spec.envAllowlist),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeoutTimer = setTimeout(() => {
      pendingReason = "timeout";
      this.killTree(child, killState);
    }, spec.timeoutMs);
    if (typeof (timeoutTimer as { unref?: () => void }).unref === "function") {
      (timeoutTimer as { unref: () => void }).unref();
    }

    const settle = (exitStatus: ProcessExit): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      // Clear any pending SIGKILL-grace timer so it cannot fire after exit and
      // signal a reused PID/PGID.
      if (killState.sigkillTimer !== null) {
        clearTimeout(killState.sigkillTimer);
        killState.sigkillTimer = null;
      }
      queue.close();
      resolveExit(exitStatus);
    };

    const consume = (stream: ProcessStream, buffer: { rest: string }, chunk: Buffer): void => {
      if (spec.maxOutputBytes !== null) {
        outputBytes += chunk.byteLength;
      }
      const text = buffer.rest + chunk.toString("utf8");
      const parts = text.split("\n");
      buffer.rest = parts.pop() ?? "";
      for (const part of parts) {
        queue.push({ stream, line: part.replace(/\r$/, "") });
      }
      if (spec.maxOutputBytes !== null && outputBytes > spec.maxOutputBytes && pendingReason === null) {
        pendingReason = "output_limit";
        this.killTree(child, killState);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => consume("stdout", stdoutBuffer, chunk));
    child.stderr.on("data", (chunk: Buffer) => consume("stderr", stderrBuffer, chunk));

    child.on("error", (error: Error) => {
      // Flush any buffered partial lines as evidence, then settle as a spawn error.
      flushRemainder(queue, "stdout", stdoutBuffer);
      flushRemainder(queue, "stderr", stderrBuffer);
      settle({ code: null, signal: null, reason: "spawn_error", detail: error.name });
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      flushRemainder(queue, "stdout", stdoutBuffer);
      flushRemainder(queue, "stderr", stderrBuffer);
      const reason: ProcessTerminationReason = pendingReason ?? "exited";
      settle({ code, signal, reason });
    });

    return {
      output: queue.iterable(),
      cancel: async (): Promise<void> => {
        if (settled) {
          return;
        }
        if (pendingReason === null) {
          pendingReason = "cancelled";
        }
        this.killTree(child, killState);
      },
      exit
    };
  }

  /**
   * Terminate the whole process tree. On POSIX, signal the negative PID (the
   * process group) with SIGTERM, then escalate to SIGKILL after the grace period.
   * On win32, `taskkill /T /F` walks the tree. Signalling the lead PID alone is
   * insufficient (substrate §8.5).
   *
   * The SIGKILL-grace timer handle is stored on `killState` so `settle()` can clear
   * it once the child has actually exited — otherwise a late timer could escalate
   * SIGKILL against a reused PID/PGID. A second grace timer is never armed while one
   * is already pending (repeated cancel()/timeout/output-limit are idempotent).
   */
  private killTree(child: ChildProcess, killState: KillState): void {
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("error", () => {
        /* best-effort */
      });
      return;
    }
    try {
      // Negative pid => the whole process group led by the detached child.
      process.kill(-pid, "SIGTERM");
    } catch {
      /* group may already be gone */
    }
    // Do not re-arm a second grace timer if one is already pending.
    if (killState.sigkillTimer !== null) {
      return;
    }
    const sigkill = setTimeout(() => {
      killState.sigkillTimer = null;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }, this.killGraceMs);
    if (typeof (sigkill as { unref?: () => void }).unref === "function") {
      (sigkill as { unref: () => void }).unref();
    }
    killState.sigkillTimer = sigkill;
  }
}

/** Mutable holder for the pending POSIX SIGKILL-grace timer of a single run. */
interface KillState {
  sigkillTimer: ReturnType<typeof setTimeout> | null;
}

function flushRemainder(queue: LineQueue, stream: ProcessStream, buffer: { rest: string }): void {
  if (buffer.rest.length > 0) {
    queue.push({ stream, line: buffer.rest.replace(/\r$/, "") });
    buffer.rest = "";
  }
}
