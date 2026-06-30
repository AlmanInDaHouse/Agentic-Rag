/**
 * A10-W.6 — the production {@link ProcessRunner} for real provider adapters on the
 * native Windows substrate (ADR 0056).
 *
 * `NodeProcessRunner` spawns directly and reaps with `taskkill /T /F`. On Windows
 * that can miss a detached grandchild. `PlatformProcessRunner` instead routes every
 * real provider spawn through the {@link ExecutionPlatform} so the whole process
 * TREE is owned by a kill-on-close **Job Object** (A10-W.4) and the child environment
 * is built by `createRestrictedEnvironment` (A10-W.5: allowlist + always-drop
 * credential-shaped names). The provider binary is resolved to a real executable via
 * {@link resolveProviderLauncher} (never a `.cmd`/`.ps1` shim — ADR 0056).
 *
 * This is the TRUSTED provider-launch boundary: the orchestrator launches codex/claude
 * here, NOT through the agent-facing Safe Command Policy (A10-W.5), which deliberately
 * BLOCKS `codex`/`claude` so an agent cannot recursively re-invoke a provider.
 *
 * It bridges the platform's `Promise<ManagedProcess>` into the synchronous
 * `ProcessRunner.run` contract: `run()` returns immediately with an output iterable
 * and an `exit` promise that both await process creation internally. A creation
 * failure (e.g. an unresolved binary, or a platform whose `createManagedProcess` is
 * not yet implemented) surfaces as a single `spawn_error` exit with no output —
 * exactly as `NodeProcessRunner` reports a failed spawn.
 */

import type { ExecutionPlatform, ManagedProcess, TerminationResult } from "@triforge/shared";
import { detectExecutionPlatform } from "../../platform/detectPlatform.js";
import type {
  ProcessExit,
  ProcessOutputLine,
  ProcessRunner,
  ProcessRunSpec,
  RunningProcess
} from "./processRunner.js";
import { resolveProviderLauncher, type ResolvedLauncher } from "./windowsLauncher.js";

/** Map the platform's terminal result onto the adapter's `ProcessExit`. */
function mapTerminal(result: TerminationResult): ProcessExit {
  // The Job Object reaps by handle, not by POSIX signal, so `signal` is always null;
  // the `reason` taxonomy is shared (exited | timeout | cancelled | output_limit |
  // spawn_error), so it carries through unchanged.
  return {
    code: result.exitCode,
    signal: null,
    reason: result.reason,
    detail: result.detail
  };
}

function spawnErrorExit(error: unknown): ProcessExit {
  const detail = error instanceof Error ? error.name : "managed_process_creation_failed";
  return { code: null, signal: null, reason: "spawn_error", detail };
}

export class PlatformProcessRunner implements ProcessRunner {
  private readonly platform: ExecutionPlatform;
  private readonly resolveLauncher: (bin: string) => ResolvedLauncher;

  constructor(
    options: {
      platform?: ExecutionPlatform;
      resolveLauncher?: (bin: string) => ResolvedLauncher;
    } = {}
  ) {
    this.platform = options.platform ?? detectExecutionPlatform();
    this.resolveLauncher = options.resolveLauncher ?? ((bin) => resolveProviderLauncher(bin));
  }

  run(spec: ProcessRunSpec): RunningProcess {
    const launcher = this.resolveLauncher(spec.bin);

    // Kick off process creation: build the restricted env, then create the managed
    // (Job-Object-supervised) process. Both `output` and `exit` await this promise.
    const managedPromise: Promise<ManagedProcess> = (async () => {
      const restricted = await this.platform.createRestrictedEnvironment({
        allowNames: spec.envAllowlist
      });
      return this.platform.createManagedProcess({
        executable: launcher.executable,
        args: [...launcher.prefixArgs, ...spec.args],
        cwd: spec.cwd,
        env: restricted.env,
        timeoutMs: spec.timeoutMs,
        ...(spec.maxOutputBytes !== null ? { maxOutputBytes: spec.maxOutputBytes } : {})
      });
    })();

    // Swallow the rejection on this reference so an unconsumed `exit` (or a caller that
    // only iterates output) cannot produce an unhandled-rejection warning; the error is
    // still observed through `exit` below.
    managedPromise.catch(() => undefined);

    async function* output(): AsyncGenerator<ProcessOutputLine> {
      let managed: ManagedProcess;
      try {
        managed = await managedPromise;
      } catch {
        return; // creation failed → no output; `exit` reports spawn_error
      }
      for await (const rec of managed.output) {
        yield { stream: rec.stream, line: rec.line };
      }
    }

    const exit: Promise<ProcessExit> = managedPromise.then(
      async (managed) => mapTerminal(await managed.terminal),
      (error) => spawnErrorExit(error)
    );

    const cancel = async (): Promise<void> => {
      try {
        const managed = await managedPromise;
        await managed.cancel("cancelled");
      } catch {
        /* never created → nothing to cancel */
      }
    };

    return { output: output(), cancel, exit };
  }
}
