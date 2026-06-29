/**
 * CommandSupervisor (A5.3) — runs a policy-approved command under process
 * supervision and reduces it to a single terminal `CommandResult`.
 *
 * It composes:
 *  - the A5.3 `CommandPolicy` (deny-by-default classification + cwd containment), and
 *  - the A3 `ProcessRunner` boundary (`NodeProcessRunner` in prod, `FakeProcessRunner`
 *    in tests), which already provides the substrate process model: direct binary,
 *    shell disabled, separated argv, curated env from an allowlist (credential names
 *    dropped), explicit cwd, output-byte cap, per-invocation timeout, and a process
 *    GROUP so cancellation/timeout signal the whole tree (SIGTERM → grace → SIGKILL on
 *    POSIX / `taskkill /T` on win32) — killing the lead PID alone leaves orphans
 *    (WSL2 substrate §8.5; T-EXE / SAT-A5-4 process supervision).
 *
 * The supervisor adds: the policy gate (a denied command NEVER reaches the runner —
 * no spawn), stdout/stderr kept SEPARATE and capped, a single terminal result with a
 * truncation flag, idempotent cancellation that yields partial evidence, and an audit
 * record per run.
 */

import type {
  ProcessRunner,
  ProcessRunSpec,
  RunningProcess,
  ProcessTerminationReason
} from "../../providers/real/processRunner.js";
import type { CommandCategory, CommandDecision, CommandPolicy, CommandSpec } from "./commandPolicy.js";

export interface SupervisedCommandResult {
  allowed: boolean;
  category: CommandCategory;
  bin: string;
  /** Policy denial reason when `allowed` is false. */
  denyReason?: CommandDecision["denyReason"];
  /** Exit code (null when killed/never started). */
  exitCode: number | null;
  /** Why the run ended (runner perspective), or `not_run` when denied. */
  terminationReason: ProcessTerminationReason | "not_run";
  /** Captured stdout (capped). */
  stdout: string;
  /** Captured stderr (capped, kept SEPARATE from stdout). */
  stderr: string;
  /** True when output hit the byte cap and was truncated. */
  truncated: boolean;
  startedAt: string;
  endedAt: string;
}

export interface SupervisedRun {
  executionId: string;
  result: Promise<SupervisedCommandResult>;
  /** Idempotent: signals the process GROUP. No-op for a denied (never-spawned) command. */
  cancel(): Promise<void>;
}

export interface CommandSupervisorAuditEntry {
  timestamp: string;
  executionId: string;
  bin: string;
  category: CommandCategory;
  cwd: string;
  allowed: boolean;
  denyReason?: CommandDecision["denyReason"];
  exitCode: number | null;
  terminationReason: ProcessTerminationReason | "not_run";
  truncated: boolean;
}

export interface CommandSupervisorOptions {
  policy: CommandPolicy;
  runner: ProcessRunner;
  clock: { iso(): string };
  /** Env NAMES the command may inherit (values from process.env; creds dropped). */
  envAllowlist?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number | null;
  onAudit?: (entry: CommandSupervisorAuditEntry) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class CommandSupervisor {
  private readonly policy: CommandPolicy;
  private readonly runner: ProcessRunner;
  private readonly clock: { iso(): string };
  private readonly envAllowlist: string[];
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number | null;
  private readonly onAudit?: (entry: CommandSupervisorAuditEntry) => void;
  private readonly running = new Map<string, RunningProcess>();
  private counter = 0;

  constructor(options: CommandSupervisorOptions) {
    this.policy = options.policy;
    this.runner = options.runner;
    this.clock = options.clock;
    this.envAllowlist = options.envAllowlist ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes =
      options.maxOutputBytes === undefined ? DEFAULT_MAX_OUTPUT_BYTES : options.maxOutputBytes;
    this.onAudit = options.onAudit;
  }

  /** Convenience: start and await the terminal result. */
  run(command: CommandSpec, cwd: string): Promise<SupervisedCommandResult> {
    return this.start(command, cwd).result;
  }

  /** Start a supervised command. A denied command never spawns. */
  start(command: CommandSpec, cwd: string): SupervisedRun {
    this.counter += 1;
    const executionId = `cmd-${this.counter}`;
    const startedAt = this.clock.iso();
    const decision = this.policy.check(command, cwd);

    if (!decision.allowed) {
      const result: SupervisedCommandResult = {
        allowed: false,
        category: decision.category,
        bin: decision.bin,
        denyReason: decision.denyReason,
        exitCode: null,
        terminationReason: "not_run",
        stdout: "",
        stderr: "",
        truncated: false,
        startedAt,
        endedAt: startedAt
      };
      this.audit(executionId, cwd, result);
      return { executionId, result: Promise.resolve(result), cancel: async () => undefined };
    }

    const spec: ProcessRunSpec = {
      bin: command.bin,
      args: command.args,
      cwd,
      envAllowlist: this.envAllowlist,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes
    };
    const proc = this.runner.run(spec);
    this.running.set(executionId, proc);

    const result = this.collect(executionId, command, decision.category, cwd, proc, startedAt);
    return {
      executionId,
      result,
      cancel: async (): Promise<void> => {
        const live = this.running.get(executionId);
        if (live) {
          await live.cancel();
        }
      }
    };
  }

  /** Cancel a running command by id (idempotent; unknown id is a no-op). */
  async cancel(executionId: string): Promise<void> {
    const live = this.running.get(executionId);
    if (live) {
      await live.cancel();
    }
  }

  private async collect(
    executionId: string,
    command: CommandSpec,
    category: CommandCategory,
    cwd: string,
    proc: RunningProcess,
    startedAt: string
  ): Promise<SupervisedCommandResult> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let bytes = 0;
    let truncated = false;
    const cap = this.maxOutputBytes;

    try {
      for await (const line of proc.output) {
        const size = Buffer.byteLength(line.line, "utf8") + 1;
        if (cap !== null && bytes + size > cap) {
          truncated = true;
          continue; // keep draining so the runner can settle; stop accumulating
        }
        bytes += size;
        (line.stream === "stderr" ? stderr : stdout).push(line.line);
      }
    } finally {
      this.running.delete(executionId);
    }

    const exit = await proc.exit;
    const result: SupervisedCommandResult = {
      allowed: true,
      category,
      bin: command.bin,
      exitCode: exit.code,
      terminationReason: exit.reason,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      truncated: truncated || exit.reason === "output_limit",
      startedAt,
      endedAt: this.clock.iso()
    };
    this.audit(executionId, cwd, result);
    return result;
  }

  private audit(executionId: string, cwd: string, result: SupervisedCommandResult): void {
    if (this.onAudit === undefined) {
      return;
    }
    try {
      this.onAudit({
        timestamp: result.endedAt,
        executionId,
        bin: result.bin,
        category: result.category,
        cwd,
        allowed: result.allowed,
        denyReason: result.denyReason,
        exitCode: result.exitCode,
        terminationReason: result.terminationReason,
        truncated: result.truncated
      });
    } catch {
      /* an audit sink must never break supervision */
    }
  }
}
