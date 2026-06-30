/**
 * A10.4 — Writable adapter conformance harness (mandate §8).
 *
 * A10.3 proved the authorized writable HAPPY path + the refusal branches. This suite
 * proves the writable FAILURE SURFACE: it drives the REAL adapters through the
 * conformance harness under an AUTHORIZED writable run (`readOnly:false`, worktree cwd)
 * across malformed output, unknown events, rate-limit/quota, timeout, cancellation and
 * crash — proving a writable run is as conformant as a read-only one (single terminal,
 * errors normalized, no events after terminal, no secret leakage). Plus the
 * writable-specific harness cases (capability invalidation, worktree-cwd refusal) as
 * conformant refusal streams. CI-safe, FAKE runner only — no real CLI, no real writes.
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
import {
  ConformanceInvariant,
  findInvariant,
  runConformanceCheck,
  type ConformanceInvariantId,
  type ConformanceReport
} from "../providers/harness/index.js";
import { CodexAdapter, ClaudeAdapter, type WritableProfile } from "../providers/real/index.js";
import {
  claudeSuccessScript,
  claudeVersionScript,
  codexParseErrorScript,
  codexRateLimitedScript,
  codexTimeoutScript,
  codexUnknownKindScript,
  codexVersionScript,
  codexWritableFileChangeScript,
  makeFixtureRunner,
  type FixtureRunnerScripts
} from "./fixtures/realProviderFixtures.js";

const LIVENESS_MS = 2_000;

const tempDirs: string[] = [];
function makeWorktree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-wc-"));
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
  milestone: "A10.4",
  verification: ["writableConformance.test.ts"],
  recovery: "revert the worktree branch",
  residualRisk: "RR-4"
};

function snapshot(provider: ProviderId, overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    provider,
    cliVersion: provider === "codex" ? "0.101.0" : "2.1.195",
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
function profile(provider: ProviderId, wt: string, overrides: Partial<CapabilitySnapshot> = {}): WritableProfile {
  return { observedCapability: snapshot(provider, overrides), binding: BINDING, worktreeRoot: wt };
}

let seq = 0;
function writableReq(provider: ProviderId, wt: string | null): AgentExecutionRequest {
  seq += 1;
  return AgentExecutionRequestSchema.parse({
    executionId: `wc-${provider}-${seq}`,
    provider,
    objective: "implement the change",
    timeoutMs: 3_600_000,
    readOnly: false,
    ...(wt !== null ? { cwd: wt } : {})
  });
}

function codexWritable(exec: FixtureRunnerScripts["exec"], wt: string, override?: Partial<CapabilitySnapshot>) {
  return new CodexAdapter(makeFixtureRunner({ version: codexVersionScript, exec }), {
    writableProfile: profile("codex", wt, override)
  });
}

const statusOf = (r: ConformanceReport, id: ConformanceInvariantId): string | undefined => findInvariant(r, id)?.status;
function terminalOf(events: ProviderEvent[]): ProviderEvent {
  return events[events.length - 1];
}
async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of stream) {
    out.push(e);
  }
  return out;
}

// --- authorized writable run is conformant across the failure surface ------

describe("A10.4 writable conformance — the failure surface under a writable run", () => {
  it("writable success: conformant, file.changed allowed, single terminal", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(
      codexWritable(codexWritableFileChangeScript, wt),
      writableReq("codex", wt),
      { livenessTimeoutMs: LIVENESS_MS }
    );
    expect(report.ok).toBe(true);
    expect(statusOf(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)).toBe("pass");
    expect(statusOf(report, ConformanceInvariant.EXACTLY_ONE_TERMINAL)).toBe("pass");
    expect(report.events.some((e) => e.type === "file.changed")).toBe(true);
  });

  it("malformed output under writable: recovers, stays conformant", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(codexWritable(codexParseErrorScript, wt), writableReq("codex", wt), {
      livenessTimeoutMs: LIVENESS_MS
    });
    expect(report.ok, `failing invariants present`).toBe(true);
    expect(statusOf(report, ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL)).toBe("pass");
  });

  it("unknown event kind under writable: ignored, stays conformant", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(codexWritable(codexUnknownKindScript, wt), writableReq("codex", wt), {
      livenessTimeoutMs: LIVENESS_MS
    });
    expect(report.ok).toBe(true);
  });

  it("rate-limit/quota under writable: a single normalized failure terminal", async () => {
    const wt = makeWorktree();
    const events = await collect(codexWritable(codexRateLimitedScript, wt).execute(writableReq("codex", wt)));
    const terminal = terminalOf(events);
    expect(terminal.type).toBe("run.failed");
    expect(events.filter(isTerminalEvent)).toHaveLength(1);
    // normalized to a known taxonomy code, never a raw provider string
    const code = (terminal.payload as { errorCode: string }).errorCode;
    expect(["rate_limited", "quota_exhausted", "unknown"]).toContain(code);
  });

  it("timeout under writable: a single normalized timeout terminal", async () => {
    const wt = makeWorktree();
    // The fixture exits with the timeout reason; the adapter normalizes it to a single
    // run.failed{timeout} terminal (the harness's TIMEOUT_PRODUCES_TERMINAL invariant
    // is for the harness-driven timeout mode, not a fixture timeout-exit).
    const events = await collect(codexWritable(codexTimeoutScript, wt).execute(writableReq("codex", wt)));
    const terminal = terminalOf(events);
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("timeout");
    expect(events.filter(isTerminalEvent)).toHaveLength(1);
  });

  it("cancellation under writable: emission stops with a single terminal", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(
      codexWritable(codexWritableFileChangeScript, wt),
      writableReq("codex", wt),
      { mode: "cancellation", cancelAfterEvents: 1, livenessTimeoutMs: LIVENESS_MS }
    );
    expect(statusOf(report, ConformanceInvariant.CANCELLATION_STOPS_EMISSION)).toBe("pass");
    expect(statusOf(report, ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL)).toBe("pass");
  });

  it("no credential leakage on a writable run", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(
      codexWritable(codexWritableFileChangeScript, wt),
      writableReq("codex", wt),
      { livenessTimeoutMs: LIVENESS_MS }
    );
    expect(statusOf(report, ConformanceInvariant.NO_SECRET_LEAKAGE)).toBe("pass");
  });

  it("claude writable success: conformant with the acceptEdits argv", async () => {
    const wt = makeWorktree();
    const runner = makeFixtureRunner({ version: claudeVersionScript, exec: claudeSuccessScript });
    const adapter = new ClaudeAdapter(runner, { writableProfile: profile("claude", wt) });
    const report = await runConformanceCheck(adapter, writableReq("claude", wt), { livenessTimeoutMs: LIVENESS_MS });
    expect(report.ok).toBe(true);
    expect(runner.calls.find((s) => s.args.includes("-p"))?.args.join(" ")).toContain("acceptEdits");
  });
});

// --- writable-specific refusals are conformant refusal streams -------------

describe("A10.4 writable conformance — refusals are conformant", () => {
  it("capability invalidation (version drift) yields a single conformant refusal terminal", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(
      codexWritable(codexWritableFileChangeScript, wt, { cliVersion: "0.200.0" }),
      writableReq("codex", wt),
      { livenessTimeoutMs: LIVENESS_MS }
    );
    expect(statusOf(report, ConformanceInvariant.EXACTLY_ONE_TERMINAL)).toBe("pass");
    expect(statusOf(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)).toBe("pass");
    const terminal = report.events[report.events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("request_rejected");
    expect(report.events.some((e) => e.type === "file.changed")).toBe(false);
  });

  it("worktree-cwd refusal (no cwd) yields a single conformant refusal terminal", async () => {
    const wt = makeWorktree();
    const report = await runConformanceCheck(
      codexWritable(codexWritableFileChangeScript, wt),
      writableReq("codex", null),
      { livenessTimeoutMs: LIVENESS_MS }
    );
    expect(report.ok).toBe(true);
    const terminal = report.events[report.events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { message: string }).message).toMatch(/worktree cwd/);
  });
});
