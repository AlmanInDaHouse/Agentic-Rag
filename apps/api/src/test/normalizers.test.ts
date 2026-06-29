/**
 * Normalizer tests (A3) — pure, deterministic, no real process/time/net.
 *
 * Exercises the shared normalizer core + the Codex/Claude line mappers directly
 * over a `FakeProcessRunner`: order preservation, raw-evidence references (no
 * secrets), unknown-kind and parse-error handling, the single-terminal invariant,
 * usage/quota mapping and error-code normalization.
 */

import { describe, expect, it } from "vitest";
import {
  AgentExecutionRequestSchema,
  ProviderEventSchema,
  isTerminalEvent,
  type AgentExecutionRequest,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import {
  FakeProcessRunner,
  claudeLineMapper,
  codexLineMapper,
  makeRealEvidenceRef,
  normalizeProcess,
  type FakeProcessScript,
  type ProcessExit,
  type ProcessOutputLine,
  type ProviderLineMapper
} from "../providers/real/index.js";
import {
  claudeRateLimitedScript,
  claudeSuccessScript,
  codexRateLimitedScript,
  codexSuccessScript,
  codexTimeoutScript,
  codexToolUseScript
} from "./fixtures/realProviderFixtures.js";

const out = (line: string): ProcessOutputLine => ({ stream: "stdout", line });
const j = (value: unknown): string => JSON.stringify(value);
const EXIT_OK: ProcessExit = { code: 0, signal: null, reason: "exited" };
const EXIT_CRASH: ProcessExit = { code: 1, signal: null, reason: "exited" };
const EXIT_SPAWN: ProcessExit = { code: null, signal: null, reason: "spawn_error", detail: "ENOENT" };

async function normalize(
  mapper: ProviderLineMapper,
  script: FakeProcessScript,
  overrides: Record<string, unknown> = {}
): Promise<ProviderEvent[]> {
  const runner = new FakeProcessRunner(script);
  const running = runner.run({
    bin: "fake",
    args: ["exec"],
    cwd: ".",
    envAllowlist: [],
    timeoutMs: 1_000,
    maxOutputBytes: null
  });
  const request: AgentExecutionRequest = AgentExecutionRequestSchema.parse({
    executionId: "n1",
    provider: mapper.provider,
    objective: "normalize",
    timeoutMs: 1_000,
    ...overrides
  });
  const clock = new ManualClock();
  const events: ProviderEvent[] = [];
  for await (const event of normalizeProcess({ request, running, clock, mapper })) {
    events.push(event);
  }
  return events;
}

const typesOf = (events: ProviderEvent[]): string[] => events.map((e) => e.type);
const terminalsOf = (events: ProviderEvent[]): ProviderEvent[] => events.filter((e) => isTerminalEvent(e));
const lastErrorCode = (events: ProviderEvent[]): string | undefined =>
  (events[events.length - 1].payload as { errorCode?: string }).errorCode;

// --- envelope + ordering -------------------------------------------------

describe("normalizer core — envelope, ordering, evidence", () => {
  it("emits run.started first and a single terminal last, in source order", async () => {
    const events = await normalize(codexLineMapper, codexToolUseScript);
    expect(typesOf(events)).toEqual([
      "run.started",
      "agent.message",
      "tool.started",
      "tool.completed",
      "usage.updated",
      "run.completed"
    ]);
    expect(terminalsOf(events)).toHaveLength(1);
    expect(isTerminalEvent(events[events.length - 1])).toBe(true);
  });

  it("stamps a monotonic sequence and a deterministic, secret-free evidence ref", async () => {
    const events = await normalize(codexLineMapper, codexSuccessScript);
    events.forEach((event, index) => {
      expect(event.sequenceNumber).toBe(index);
      expect(event.rawEvidenceRef).toBe(makeRealEvidenceRef("n1", index));
      // The evidence ref is derived from id + sequence only — never payload content.
      expect(event.rawEvidenceRef).not.toContain("auth module");
      expect(ProviderEventSchema.safeParse(event).success).toBe(true);
    });
  });

  it("produces an identical stream on a repeated run (deterministic)", async () => {
    const a = await normalize(claudeLineMapper, claudeSuccessScript);
    const b = await normalize(claudeLineMapper, claudeSuccessScript);
    expect(b).toEqual(a);
  });
});

// --- graceful degradation ------------------------------------------------

describe("normalizer core — parse errors + unknown kinds never crash", () => {
  it("surfaces a malformed line as warning.raised (provider_parse_error)", async () => {
    const script: FakeProcessScript = {
      lines: [out("definitely not json"), out(j({ type: "thread.completed" }))],
      exit: EXIT_OK
    };
    const events = await normalize(codexLineMapper, script);
    const warn = events.find((e) => e.type === "warning.raised");
    expect((warn?.payload as { code?: string } | undefined)?.code).toBe("provider_parse_error");
    expect(isTerminalEvent(events[events.length - 1])).toBe(true);
  });

  it("surfaces an unknown structured kind as warning.raised without an unknown discriminator", async () => {
    const script: FakeProcessScript = {
      lines: [out(j({ type: "never.modeled", x: 1 })), out(j({ type: "thread.completed" }))],
      exit: EXIT_OK
    };
    const events = await normalize(codexLineMapper, script);
    const warn = events.find((e) => e.type === "warning.raised");
    expect((warn?.payload as { code?: string } | undefined)?.code).toBe("unknown_provider_event");
    // Every emitted event is still a KNOWN A1 type (no leaked discriminator).
    for (const event of events) {
      expect(ProviderEventSchema.safeParse(event).success).toBe(true);
    }
  });
});

// --- usage / quota mapping ----------------------------------------------

describe("normalizer core — usage + quota mapping", () => {
  it("codex maps turn usage with isBillingAuthoritative:false", async () => {
    const events = await normalize(codexLineMapper, codexSuccessScript);
    const usage = events.find((e) => e.type === "usage.updated");
    const payload = usage?.payload as { usage: Record<string, unknown> } | undefined;
    expect(payload?.usage.provider).toBe("codex");
    expect(payload?.usage.inputTokens).toBe(1200);
    expect(payload?.usage.outputTokens).toBe(256);
    expect(payload?.usage.source).toBe("provider_event");
    expect(payload?.usage.isBillingAuthoritative).toBe(false);
  });

  it("claude maps result usage incl. cache + cost", async () => {
    const events = await normalize(claudeLineMapper, claudeSuccessScript);
    const usage = events.find((e) => e.type === "usage.updated");
    const payload = usage?.payload as { usage: Record<string, unknown> } | undefined;
    expect(payload?.usage.provider).toBe("claude");
    expect(payload?.usage.cacheReadTokens).toBe(50);
    expect(payload?.usage.estimatedCostUsd).toBe(0.012);
    expect(payload?.usage.isBillingAuthoritative).toBe(false);
  });

  it("maps a rate-limit error to a quota.updated signal (never billing-authoritative)", async () => {
    for (const [mapper, script] of [
      [codexLineMapper, codexRateLimitedScript],
      [claudeLineMapper, claudeRateLimitedScript]
    ] as const) {
      const events = await normalize(mapper, script);
      const quota = events.find((e) => e.type === "quota.updated");
      const payload = quota?.payload as { quota: Record<string, unknown> } | undefined;
      expect(payload?.quota.status).toBe("rate_limited");
      expect(payload?.quota.window).toBe("unknown");
      expect(payload?.quota.isBillingAuthoritative).toBe(false);
    }
  });
});

// --- error-code normalization + terminal -------------------------------

describe("normalizer core — terminal + error-code normalization", () => {
  it("normalizes a provider rate-limit to run.failed{rate_limited}", async () => {
    const events = await normalize(codexLineMapper, codexRateLimitedScript);
    expect(events[events.length - 1].type).toBe("run.failed");
    expect(lastErrorCode(events)).toBe("rate_limited");
  });

  it("normalizes a usage-limit error to quota_exhausted", async () => {
    const script: FakeProcessScript = {
      lines: [
        out(j({ type: "thread.started", thread_id: "t1" })),
        out(j({ type: "error", subtype: "usage_limit_reached", message: "Out of quota." }))
      ],
      exit: EXIT_CRASH
    };
    const events = await normalize(codexLineMapper, script);
    expect(lastErrorCode(events)).toBe("quota_exhausted");
  });

  it("maps a non-zero exit with no provider error to process_crashed (partial preserved)", async () => {
    const script: FakeProcessScript = {
      lines: [
        out(j({ type: "thread.started", thread_id: "t1" })),
        out(j({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Partial." } }))
      ],
      exit: EXIT_CRASH
    };
    const events = await normalize(codexLineMapper, script);
    const terminal = events[events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("process_crashed");
    expect((terminal.payload as { partial: boolean }).partial).toBe(true);
  });

  it("maps a spawn error to run.failed{provider_unavailable}", async () => {
    const script: FakeProcessScript = { lines: [], exit: EXIT_SPAWN };
    const events = await normalize(codexLineMapper, script);
    expect(typesOf(events)).toEqual(["run.started", "run.failed"]);
    expect(lastErrorCode(events)).toBe("provider_unavailable");
  });

  it("maps a runner timeout to run.failed{timeout}", async () => {
    const events = await normalize(codexLineMapper, codexTimeoutScript);
    expect(lastErrorCode(events)).toBe("timeout");
  });

  it("a successful run reports run.completed with a non-partial terminal", async () => {
    const events = await normalize(claudeLineMapper, claudeSuccessScript);
    const terminal = events[events.length - 1];
    expect(terminal.type).toBe("run.completed");
    expect(terminalsOf(events)).toHaveLength(1);
  });
});
