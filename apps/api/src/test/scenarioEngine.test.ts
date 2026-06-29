import { describe, expect, it } from "vitest";
import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  ProviderEventSchema,
  type ProviderEvent
} from "@triforge/shared";
import {
  ManualClock,
  DEFAULT_CLOCK_EPOCH_MS,
  DEFAULT_TICK_MS,
  runScenario,
  deriveProviderResult,
  makeEvidenceRef,
  payloadByteLength,
  type EngineContext,
  type ScenarioDefinition,
  type ScenarioStep
} from "../providers/mock/index.js";

// --- helpers -------------------------------------------------------------

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function makeCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    executionId: "exec-1",
    provider: "codex",
    clock: new ManualClock(),
    cancelState: { requested: false },
    timeoutMs: null,
    maxOutputBytes: null,
    recordedEvents: [],
    ...overrides
  };
}

function scenario(steps: ScenarioStep[], extra: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: "inline",
    title: "inline",
    conformance: "conformant",
    intent: "inline test scenario",
    steps,
    ...extra
  };
}

const errorCodeOf = (event: ProviderEvent): string | undefined =>
  (event.payload as { errorCode?: string }).errorCode;

const tiny = scenario([
  { kind: "emit", type: "run.started", payload: { readOnly: true } },
  { kind: "emit", type: "agent.message", payload: { role: "assistant", text: "hi" } },
  { kind: "emit", type: "run.completed", payload: { summary: "done", filesChangedCount: 0 } }
]);

// --- ManualClock ---------------------------------------------------------

describe("ManualClock", () => {
  it("starts at the fixed default epoch and never reads Date.now", () => {
    const clock = new ManualClock();
    expect(clock.now()).toBe(DEFAULT_CLOCK_EPOCH_MS);
    expect(clock.iso()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("advances deterministically and emits valid ISO datetimes", () => {
    const clock = new ManualClock();
    clock.advance(1500);
    expect(clock.iso()).toBe("2026-01-01T00:00:01.500Z");
    clock.advance(DEFAULT_TICK_MS);
    expect(clock.now()).toBe(DEFAULT_CLOCK_EPOCH_MS + 2500);
  });

  it("accepts a custom start and rejects negative advances", () => {
    const clock = new ManualClock(Date.parse("2030-06-01T00:00:00.000Z"));
    expect(clock.iso()).toBe("2030-06-01T00:00:00.000Z");
    expect(() => clock.advance(-1)).toThrow();
  });
});

// --- pure helpers --------------------------------------------------------

describe("engine helpers", () => {
  it("derives a non-secret evidence ref from executionId + sequence", () => {
    expect(makeEvidenceRef("exec-9", 3)).toBe("evidence://exec-9/3.jsonl");
  });

  it("measures UTF-8 payload byte length", () => {
    const payload = { text: "abc" };
    expect(payloadByteLength(payload)).toBe(Buffer.byteLength(JSON.stringify(payload), "utf8"));
  });
});

// --- envelope + determinism ----------------------------------------------

describe("runScenario — envelope + determinism", () => {
  it("fills the envelope with monotonic sequence, clock timestamps and derived refs", async () => {
    const events = await collect(runScenario(tiny, makeCtx()));
    expect(events.map((e) => e.sequenceNumber)).toEqual([0, 1, 2]);
    expect(events.every((e) => e.schemaVersion === PROVIDER_CONTRACT_SCHEMA_VERSION)).toBe(true);
    expect(events.every((e) => e.executionId === "exec-1")).toBe(true);
    expect(events.every((e) => e.provider === "codex")).toBe(true);
    expect(events[0].rawEvidenceRef).toBe("evidence://exec-1/0.jsonl");
    // each emit advances the clock by one tick before stamping.
    expect(events[0].timestamp).toBe("2026-01-01T00:00:01.000Z");
    expect(events[1].timestamp).toBe("2026-01-01T00:00:02.000Z");
    expect(events[2].timestamp).toBe("2026-01-01T00:00:03.000Z");
    for (const event of events) {
      expect(ProviderEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("is byte-for-byte reproducible across runs", async () => {
    const first = await collect(runScenario(tiny, makeCtx()));
    const second = await collect(runScenario(tiny, makeCtx()));
    expect(first).toEqual(second);
  });

  it("records emitted events into the provided sink", async () => {
    const recorded: ProviderEvent[] = [];
    const events = await collect(runScenario(tiny, makeCtx({ recordedEvents: recorded })));
    expect(recorded).toEqual(events);
  });
});

// --- cancellation / timeout / output limit -------------------------------

describe("runScenario — cooperative cancellation", () => {
  it("observes an external cancel flag at the next step and emits one cancellation terminal", async () => {
    const cancelState = { requested: false };
    const iter = runScenario(tiny, makeCtx({ cancelState }))[Symbol.asyncIterator]();

    const started = await iter.next();
    expect((started.value as ProviderEvent).type).toBe("run.started");

    cancelState.requested = true;
    const terminal = await iter.next();
    const terminalEvent = terminal.value as ProviderEvent;
    expect(terminalEvent.type).toBe("run.failed");
    expect(errorCodeOf(terminalEvent)).toBe("cancelled");

    expect((await iter.next()).done).toBe(true);
  });

  it("emits only the cancellation terminal when the flag is set before the first step", async () => {
    const events = await collect(
      runScenario(tiny, makeCtx({ cancelState: { requested: true } }))
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.failed");
    expect(errorCodeOf(events[0])).toBe("cancelled");
  });

  it("ignores cancellation when the scenario opts out (violation modelling)", async () => {
    const cancelState = { requested: true };
    const events = await collect(
      runScenario(scenario(tiny.steps, { ignoresCancellation: true }), makeCtx({ cancelState }))
    );
    expect(events.map((e) => e.type)).toEqual(["run.started", "agent.message", "run.completed"]);
  });
});

describe("runScenario — timeout", () => {
  it("synthesises a timeout terminal once the clock passes the budget", async () => {
    const timed = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      { kind: "delay", advanceMs: 10_000 },
      { kind: "emit", type: "agent.message", payload: { text: "preempted" } }
    ]);
    const events = await collect(runScenario(timed, makeCtx({ timeoutMs: 5_000 })));
    expect(events.map((e) => e.type)).toEqual(["run.started", "run.failed"]);
    expect(errorCodeOf(events[1])).toBe("timeout");
  });
});

describe("runScenario — output limit", () => {
  it("emits the offending event then an output_limit_exceeded terminal", async () => {
    const flood = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      { kind: "emit", type: "agent.message", payload: { text: "x".repeat(500) } },
      { kind: "emit", type: "run.completed", payload: { summary: "unreachable", filesChangedCount: 0 } }
    ]);
    const events = await collect(runScenario(flood, makeCtx({ maxOutputBytes: 100 })));
    expect(events.map((e) => e.type)).toEqual(["run.started", "agent.message", "run.failed"]);
    expect(errorCodeOf(events[2])).toBe("output_limit_exceeded");
  });
});

// --- faithful replay of violations ---------------------------------------

describe("runScenario — faithful replay of violations", () => {
  it("applies a mutator without repairing the resulting malformed event", async () => {
    const malformed = scenario([
      {
        kind: "emit",
        type: "run.started",
        payload: { readOnly: true },
        mutate: (event) => {
          (event.payload as Record<string, unknown>).readOnly = "not-a-boolean";
          return event;
        }
      }
    ]);
    const events = await collect(runScenario(malformed, makeCtx()));
    expect(ProviderEventSchema.safeParse(events[0]).success).toBe(false);
  });

  it("can produce a spoofed-identity event (provider mismatch) via providerOverride", async () => {
    const spoof = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      { kind: "emit", type: "agent.message", payload: { text: "spoofed" }, providerOverride: "claude" },
      { kind: "emit", type: "run.completed", payload: { summary: "x", filesChangedCount: 0 } }
    ]);
    const events = await collect(runScenario(spoof, makeCtx({ provider: "codex" })));
    expect(events[0].provider).toBe("codex");
    expect(events[1].provider).toBe("claude"); // identity spoofed relative to the engine context
  });

  it("honours a sequenceOverride for sequence-manipulation scenarios", async () => {
    const gap = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      { kind: "emit", type: "agent.message", payload: { text: "gap" }, sequenceOverride: 9 }
    ]);
    const events = await collect(runScenario(gap, makeCtx()));
    expect(events.map((e) => e.sequenceNumber)).toEqual([0, 9]);
  });
});

// --- deriveProviderResult ------------------------------------------------

describe("deriveProviderResult", () => {
  it("derives a completed result referencing the terminal event", async () => {
    const events = await collect(runScenario(tiny, makeCtx()));
    const result = deriveProviderResult(events, { provider: "codex", executionId: "exec-1" });
    expect(result?.status).toBe("completed");
    expect(result?.terminalEventType).toBe("run.completed");
    expect(result?.terminalSequenceNumber).toBe(2);
    expect(result?.error).toBeNull();
  });

  it("derives a failed result with a populated error", async () => {
    const crash = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      {
        kind: "emit",
        type: "run.failed",
        payload: { errorCode: "process_crashed", message: "boom", partial: true }
      }
    ]);
    const events = await collect(runScenario(crash, makeCtx()));
    const result = deriveProviderResult(events, { provider: "claude", executionId: "exec-2" });
    expect(result?.status).toBe("failed");
    expect(result?.error?.code).toBe("process_crashed");
  });

  it("returns null when no terminal event was emitted", async () => {
    const noTerminal = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } }
    ]);
    const events = await collect(runScenario(noTerminal, makeCtx()));
    expect(deriveProviderResult(events, { provider: "codex", executionId: "exec-3" })).toBeNull();
  });

  it("uses the FIRST terminal on a duplicate-terminal stream (no silent repair)", async () => {
    const dup = scenario([
      { kind: "emit", type: "run.started", payload: { readOnly: true } },
      { kind: "emit", type: "run.completed", payload: { summary: "first", filesChangedCount: 0 } },
      { kind: "emit", type: "run.failed", payload: { errorCode: "unknown", message: "second", partial: false } }
    ]);
    const events = await collect(runScenario(dup, makeCtx()));
    const result = deriveProviderResult(events, { provider: "codex", executionId: "exec-4" });
    expect(result?.terminalEventType).toBe("run.completed");
    expect(result?.terminalSequenceNumber).toBe(1);
  });
});
