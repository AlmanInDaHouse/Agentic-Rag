/**
 * A10.3 — Writable provider adapter profiles (mandate §7).
 *
 * The real adapters stay read-only by DEFAULT and refuse `readOnly:false`. A writable
 * run is authorized ONLY with a complete writable profile: an observed real capability
 * snapshot (`write:"yes"`, matching version, right provider), a 6-field A0.5 binding,
 * and a worktree cwd. This suite proves both the authorized path (writable argv,
 * file.changed allowed, conformant) and every refusal branch — all CI-safe, FAKE runner
 * only, no real CLI, no credentials, no real writes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentExecutionRequestSchema,
  isTerminalEvent,
  type AgentExecutionRequest,
  type CapabilityBinding,
  type CapabilitySnapshot,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import { ConformanceInvariant, findInvariant, runConformanceCheck } from "../providers/harness/index.js";
import { CodexAdapter, ClaudeAdapter, type WritableProfile } from "../providers/real/index.js";
import {
  claudeSuccessScript,
  claudeVersionScript,
  codexVersionScript,
  codexWritableFileChangeScript,
  makeFixtureRunner
} from "./fixtures/realProviderFixtures.js";

const LIVENESS_MS = 2_000;

const tempDirs: string[] = [];
function makeWorktree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-wt-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const BINDING: CapabilityBinding = {
  threat: ["T-INT-14"],
  control: ["A10.2 isolation", "A5.5 mutation ledger"],
  milestone: "A10.3",
  verification: ["writableAdapter.test.ts"],
  recovery: "revert the worktree branch",
  residualRisk: "RR-4"
};

function snapshot(
  provider: ProviderId,
  overrides: Partial<CapabilitySnapshot> = {}
): CapabilitySnapshot {
  return {
    provider,
    cliVersion: provider === "codex" ? "0.142.4" : "2.1.195",
    verifiedAt: "2026-06-30T00:00:00.000Z",
    headlessSupport: "yes",
    structuredOutput: "yes",
    eventStream: "yes",
    authProbe: "yes",
    usageObservable: "unknown",
    quotaObservable: "unknown",
    readOnly: "yes",
    write: "yes",
    cancellation: "yes",
    resume: "yes",
    unknownCapabilities: [],
    ...overrides
  };
}

function profile(provider: ProviderId, worktreeRoot: string, overrides: Partial<CapabilitySnapshot> = {}): WritableProfile {
  return { observedCapability: snapshot(provider, overrides), binding: BINDING, worktreeRoot };
}

function request(provider: ProviderId, overrides: Record<string, unknown> = {}): AgentExecutionRequest {
  return AgentExecutionRequestSchema.parse({
    executionId: `wr-${provider}-${Math.floor(performance.now() * 1000) % 1_000_000}`,
    provider,
    objective: "implement the feature",
    timeoutMs: 3_600_000,
    readOnly: false,
    ...overrides
  });
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of stream) {
    out.push(e);
  }
  return out;
}

function terminalOf(events: ProviderEvent[]): ProviderEvent {
  return events[events.length - 1];
}

// --- authorized writable run ----------------------------------------------

describe("A10.3 writable adapter — authorized writable run", () => {
  it("codex: with a complete writable profile, builds the workspace-write argv and emits file.changed", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt) });
    const events = await collect(adapter.execute(request("codex", { cwd: wt })));

    expect(events.some((e) => e.type === "file.changed")).toBe(true);
    expect(terminalOf(events).type).toBe("run.completed");
    const exec = runner.calls.find((s) => s.args.includes("exec"));
    expect(exec?.args.join(" ")).toContain("--sandbox workspace-write");
    expect(exec?.args.join(" ")).not.toContain("read-only");
  });

  it("codex: an authorized writable run (readOnly:false) PASSES the conformance harness", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt) });
    const report = await runConformanceCheck(adapter, request("codex", { cwd: wt }), {
      livenessTimeoutMs: LIVENESS_MS
    });
    expect(report.ok).toBe(true);
    // file.changed under readOnly:false is allowed (authority = request.readOnly).
    expect(findInvariant(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)?.status).toBe("pass");
    expect(report.events.some((e) => e.type === "file.changed")).toBe(true);
  });

  it("claude: with a constructed write:yes snapshot, builds the acceptEdits argv", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: claudeVersionScript, exec: claudeSuccessScript });
    const adapter = new ClaudeAdapter(runner, { writableProfile: profile("claude", wt) });
    await collect(adapter.execute(request("claude", { cwd: wt })));
    const exec = runner.calls.find((s) => s.args.includes("-p"));
    expect(exec?.args.join(" ")).toContain("--permission-mode acceptEdits");
    expect(exec?.args.join(" ")).not.toContain("plan");
    expect(exec?.args.join(" ")).not.toContain("--bare");
  });
});

// --- refusal branches (no silent permission widening) ---------------------

describe("A10.3 writable adapter — refusals", () => {
  async function refuse(adapter: CodexAdapter | ClaudeAdapter, req: AgentExecutionRequest, runner: { calls: { args: string[] }[] }) {
    const events = await collect(adapter.execute(req));
    const terminal = terminalOf(events);
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("request_rejected");
    expect(events.filter((e) => isTerminalEvent(e))).toHaveLength(1);
    // No writable argv was ever built.
    expect(runner.calls.flatMap((s) => s.args).join(" ")).not.toContain("workspace-write");
    return (terminal.payload as { message: string }).message;
  }

  it("no profile (read-only adapter) refuses, mentioning the A0.5 capability binding", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner); // no writableProfile
    const msg = await refuse(adapter, request("codex", { cwd: wt }), runner);
    expect(msg).toMatch(/A0\.5 capability binding/);
    expect(runner.calls).toHaveLength(0);
  });

  it("refuses when the observed write capability is not yes", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt, { write: "unknown" }) });
    const msg = await refuse(adapter, request("codex", { cwd: wt }), runner);
    expect(msg).toMatch(/writable capability not observed/);
  });

  it("refuses on version drift (snapshot version != adapter version)", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt, { cliVersion: "0.200.0" }) });
    const msg = await refuse(adapter, request("codex", { cwd: wt }), runner);
    expect(msg).toMatch(/invalidated by version drift/);
  });

  it("refuses when cwd is outside the authorized worktree", async () => {
    const wt = makeWorktree();
    const other = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt) });
    const msg = await refuse(adapter, request("codex", { cwd: other }), runner);
    expect(msg).toMatch(/outside the authorized worktree/);
  });

  it("refuses when no cwd is provided", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, { writableProfile: profile("codex", wt) });
    const msg = await refuse(adapter, request("codex"), runner); // cwd defaults to null
    expect(msg).toMatch(/explicit worktree cwd/);
  });

  it("refuses when the snapshot is for a different provider", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    // a codex adapter handed a claude snapshot
    const adapter = new CodexAdapter(runner, {
      writableProfile: { observedCapability: snapshot("claude"), binding: BINDING, worktreeRoot: wt }
    });
    const msg = await refuse(adapter, request("codex", { cwd: wt }), runner);
    expect(msg).toMatch(/snapshot is for claude, not codex/);
  });

  it("refuses an incomplete capability binding", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner, {
      writableProfile: {
        observedCapability: snapshot("codex"),
        binding: { ...BINDING, milestone: "" },
        worktreeRoot: wt
      }
    });
    const msg = await refuse(adapter, request("codex", { cwd: wt }), runner);
    expect(msg).toMatch(/complete A0\.5 capability binding/);
  });

  it("claude: refuses with the REAL fixture snapshot (write unknown — honest)", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: claudeVersionScript, exec: claudeSuccessScript });
    // The real claude 2.1.195 fixture observes write:"unknown" — so even a profile built
    // from it must NOT authorize a writable run.
    const adapter = new ClaudeAdapter(runner, { writableProfile: profile("claude", wt, { write: "unknown" }) });
    const msg = await refuse(adapter, request("claude", { cwd: wt }), runner);
    expect(msg).toMatch(/writable capability not observed/);
  });
});
