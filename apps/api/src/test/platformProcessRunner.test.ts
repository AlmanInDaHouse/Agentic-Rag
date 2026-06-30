/**
 * A10-W.6 — PlatformProcessRunner (CI-safe, fake ExecutionPlatform).
 *
 * Proves the production runner routes a real provider spawn through the platform's
 * Job-Object-supervised `createManagedProcess` + credential-stripped
 * `createRestrictedEnvironment`, prepends the resolved launcher argv, bridges the
 * managed output/terminal into the adapter's `ProcessRunner` contract, and surfaces a
 * creation failure as a single `spawn_error`. No real codex/claude, no real spawn.
 */

import { describe, expect, it } from "vitest";
import {
  AgentExecutionRequestSchema,
  type AgentExecutionRequest,
  type CanonicalPath,
  type ExecutionPlatform,
  type FilesystemEntryEvidence,
  type ManagedProcess,
  type ManagedProcessRequest,
  type ProviderEvent,
  type RestrictedEnvironment,
  type RestrictedEnvironmentRequest,
  type TerminationResult
} from "@triforge/shared";
import { CodexAdapter, type ProcessRunSpec } from "../providers/real/index.js";
import { PlatformProcessRunner } from "../providers/real/platformProcessRunner.js";

interface ScriptedLine {
  stream: "stdout" | "stderr";
  line: string;
}

function scriptedProcess(
  lines: ScriptedLine[],
  terminal: TerminationResult
): { mp: ManagedProcess; cancelled: { value: boolean } } {
  const cancelled = { value: false };
  async function* output(): AsyncGenerator<ScriptedLine> {
    for (const l of lines) {
      if (cancelled.value) {
        return;
      }
      await Promise.resolve();
      yield l;
    }
  }
  const mp: ManagedProcess = {
    processId: "fake-1",
    output: output(),
    terminal: Promise.resolve(terminal),
    cancel: async (): Promise<void> => {
      cancelled.value = true;
    }
  };
  return { mp, cancelled };
}

class FakePlatform implements ExecutionPlatform {
  readonly platformId = "windows" as const;
  readonly managedRequests: ManagedProcessRequest[] = [];
  readonly restrictedRequests: RestrictedEnvironmentRequest[] = [];

  constructor(
    private readonly makeProcess: (req: ManagedProcessRequest) => ManagedProcess,
    private readonly failCreate = false
  ) {}

  async createRestrictedEnvironment(req: RestrictedEnvironmentRequest): Promise<RestrictedEnvironment> {
    this.restrictedRequests.push(req);
    const env: Record<string, string> = {};
    for (const name of req.allowNames) {
      env[name] = `val-${name}`;
    }
    return { env, droppedCredentialNames: [] };
  }

  async createManagedProcess(req: ManagedProcessRequest): Promise<ManagedProcess> {
    this.managedRequests.push(req);
    if (this.failCreate) {
      throw new Error("BoomCreate");
    }
    return this.makeProcess(req);
  }

  async normalizeWorkspacePath(): Promise<CanonicalPath> {
    throw new Error("unused");
  }
  async validateContainedPath(): Promise<never> {
    throw new Error("unused");
  }
  async terminateProcessTree(): Promise<TerminationResult> {
    throw new Error("unused");
  }
  async inspectFilesystemEntry(): Promise<FilesystemEntryEvidence> {
    throw new Error("unused");
  }
}

const okExit: TerminationResult = { reason: "exited", exitCode: 0, treeReaped: false, detail: "exit 0" };

function req(): AgentExecutionRequest {
  return AgentExecutionRequestSchema.parse({
    executionId: "ppr-1",
    provider: "codex",
    objective: "say pong",
    timeoutMs: 60_000,
    readOnly: true
  });
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of stream) {
    out.push(e);
  }
  return out;
}

const spec = (over: Partial<ProcessRunSpec> = {}): ProcessRunSpec => ({
  bin: "codex",
  args: ["--version"],
  cwd: ".",
  envAllowlist: ["PATH"],
  timeoutMs: 1_000,
  maxOutputBytes: null,
  ...over
});

describe("PlatformProcessRunner (A10-W.6)", () => {
  it("drives a real adapter end-to-end via createManagedProcess (Job Object path)", async () => {
    const lines: ScriptedLine[] = [
      { stream: "stdout", line: JSON.stringify({ type: "thread.started", thread_id: "t" }) },
      {
        stream: "stdout",
        line: JSON.stringify({ type: "item.completed", item: { id: "i", type: "agent_message", text: "PONG" } })
      },
      { stream: "stdout", line: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }) }
    ];
    const platform = new FakePlatform(() => scriptedProcess(lines, okExit).mp);
    const runner = new PlatformProcessRunner({
      platform,
      resolveLauncher: (bin) => ({ executable: "node", prefixArgs: [`/opt/${bin}.js`] })
    });
    const events = await collect(new CodexAdapter(runner).execute(req()));

    expect(events[0].type).toBe("run.started");
    expect(events.some((e) => e.type === "agent.message")).toBe(true);
    expect(events[events.length - 1].type).toBe("run.completed");

    // Launcher argv prepended; the exec args follow; env built from the allowlist.
    const mreq = platform.managedRequests[0];
    expect(mreq.executable).toBe("node");
    expect(mreq.args[0]).toBe("/opt/codex.js");
    expect(mreq.args).toContain("exec");
    expect(mreq.args).toContain("read-only");
    expect(platform.restrictedRequests[0].allowNames).toContain("PATH");
  });

  it("surfaces a managed-process creation failure as a single spawn_error with no output", async () => {
    const platform = new FakePlatform(() => scriptedProcess([], okExit).mp, true);
    const runner = new PlatformProcessRunner({
      platform,
      resolveLauncher: () => ({ executable: "x", prefixArgs: [] })
    });
    const running = runner.run(spec());
    const out: ScriptedLine[] = [];
    for await (const l of running.output) {
      out.push(l);
    }
    expect(out).toHaveLength(0);
    const exit = await running.exit;
    expect(exit.reason).toBe("spawn_error");
    expect(exit.code).toBeNull();
  });

  it("maps the platform terminal result onto ProcessExit and cancels the whole tree", async () => {
    const { mp, cancelled } = scriptedProcess([{ stream: "stdout", line: "x" }], {
      reason: "cancelled",
      exitCode: null,
      treeReaped: true,
      detail: "cancelled"
    });
    const platform = new FakePlatform(() => mp);
    const runner = new PlatformProcessRunner({
      platform,
      resolveLauncher: () => ({ executable: "x", prefixArgs: [] })
    });
    const running = runner.run(spec());
    await running.cancel();
    expect(cancelled.value).toBe(true);
    // drain output (cancellation stops emission)
    for await (const _ of running.output) {
      /* drained */
    }
    const exit = await running.exit;
    expect(exit.reason).toBe("cancelled");
    expect(exit.code).toBeNull();
  });
});
