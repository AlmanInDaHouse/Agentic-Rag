import { describe, expect, it } from "vitest";
import {
  AgentExecutionRequestSchema,
  AuthenticationResultSchema,
  AvailabilityResultSchema,
  CapabilitySnapshotSchema,
  isTerminalEvent,
  PROVIDER_EVENT_TYPES,
  ProviderEventSchema,
  ProviderResultSchema,
  type AgentExecutionRequest,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import {
  CONFORMANT_SCENARIO_IDS,
  createScenarioCatalog,
  FAKE_AWS_ACCESS_KEY,
  ManualClock,
  MockClaudeAdapter,
  MockCodexAdapter,
  payloadByteLength,
  SCENARIO_IDS,
  VIOLATING_SCENARIO_IDS,
  type ScenarioConformance,
  type ScenarioId
} from "../providers/mock/index.js";

// --- helpers -------------------------------------------------------------

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function makeRequest(
  executionId: string,
  provider: ProviderId,
  overrides: Record<string, unknown> = {}
): AgentExecutionRequest {
  return AgentExecutionRequestSchema.parse({
    executionId,
    provider,
    objective: "mock objective",
    timeoutMs: 3_600_000,
    ...overrides
  });
}

function defined<T>(value: T | undefined, label = "value"): T {
  if (value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

function runCodex(id: ScenarioId, overrides: Record<string, unknown> = {}): Promise<ProviderEvent[]> {
  const adapter = new MockCodexAdapter({ scenario: id });
  return collect(adapter.execute(makeRequest(`exec-${id}`, "codex", overrides)));
}

const errorCodeOf = (event: ProviderEvent): string | undefined =>
  (event.payload as { errorCode?: string }).errorCode;
const textOf = (event: ProviderEvent): string => (event.payload as { text: string }).text;

// --- adapter contract surface --------------------------------------------

describe("mock adapters — contract surface", () => {
  it("both adapters satisfy the ProviderAdapter interface (compile-time + runtime)", () => {
    const codex: ProviderAdapter = new MockCodexAdapter({ scenario: "success" });
    const claude: ProviderAdapter = new MockClaudeAdapter({ scenario: "success" });
    expect(codex.provider).toBe("codex");
    expect(claude.provider).toBe("claude");
    for (const adapter of [codex, claude]) {
      expect(typeof adapter.checkAvailability).toBe("function");
      expect(typeof adapter.checkAuthentication).toBe("function");
      expect(typeof adapter.getCapabilities).toBe("function");
      expect(typeof adapter.execute).toBe("function");
      expect(typeof adapter.cancel).toBe("function");
    }
  });

  it("exposes exactly the 35 catalog scenarios", () => {
    expect(SCENARIO_IDS).toHaveLength(35);
    expect(new Set(SCENARIO_IDS).size).toBe(35);
    expect(CONFORMANT_SCENARIO_IDS.length + VIOLATING_SCENARIO_IDS.length).toBe(35);
  });
});

// --- probe methods -------------------------------------------------------

describe("mock adapters — probe methods", () => {
  it("reflect the scenario probe and validate against the A1 schemas", async () => {
    expect(
      (await new MockCodexAdapter({ scenario: "authenticationRequired" }).checkAuthentication()).state
    ).toBe("required");
    expect(
      (await new MockCodexAdapter({ scenario: "authenticationExpired" }).checkAuthentication()).state
    ).toBe("expired");
    expect(
      (await new MockCodexAdapter({ scenario: "unavailableProvider" }).checkAvailability()).status
    ).toBe("unavailable");

    const caps = await new MockClaudeAdapter({ scenario: "unsupportedVersion" }).getCapabilities();
    expect(caps.cliVersion).toBe("0.0.0-unsupported");
    expect(caps.headlessSupport).toBe("unknown");
    expect(CapabilitySnapshotSchema.safeParse(caps).success).toBe(true);

    const avail = await new MockCodexAdapter({ scenario: "success" }).checkAvailability();
    expect(AvailabilityResultSchema.safeParse(avail).success).toBe(true);
    const auth = await new MockCodexAdapter({ scenario: "success" }).checkAuthentication();
    expect(AuthenticationResultSchema.safeParse(auth).success).toBe(true);
  });

  it("differ only by identity between providers", async () => {
    const codexCaps = await new MockCodexAdapter({ scenario: "success" }).getCapabilities();
    const claudeCaps = await new MockClaudeAdapter({ scenario: "success" }).getCapabilities();
    expect(codexCaps.provider).toBe("codex");
    expect(claudeCaps.provider).toBe("claude");
    expect(codexCaps.quotaObservable).not.toBe(claudeCaps.quotaObservable);
  });
});

// --- determinism + shared identity across both adapters ------------------

describe("mock adapters — determinism + shared behaviour", () => {
  for (const id of SCENARIO_IDS) {
    it(`${id}: deterministic and identical event shape across providers`, async () => {
      const codexA = await collect(
        new MockCodexAdapter({ scenario: id }).execute(makeRequest("e", "codex"))
      );
      const codexB = await collect(
        new MockCodexAdapter({ scenario: id }).execute(makeRequest("e", "codex"))
      );
      // exact reproducibility
      expect(codexA).toEqual(codexB);

      const claude = await collect(
        new MockClaudeAdapter({ scenario: id }).execute(makeRequest("e", "claude"))
      );
      const shape = (events: ProviderEvent[]) =>
        events.map((event) => ({
          type: event.type as string,
          sequenceNumber: event.sequenceNumber,
          timestamp: event.timestamp
        }));
      // same engine, same scenario => same shape regardless of provider
      expect(shape(codexA)).toEqual(shape(claude));
      expect(codexA.every((event) => event.provider === "codex")).toBe(true);
      expect(claude.every((event) => event.provider === "claude")).toBe(true);
    });
  }
});

// --- conformant scenario invariants --------------------------------------

describe("mock adapters — conformant invariants", () => {
  for (const id of CONFORMANT_SCENARIO_IDS) {
    it(`${id}: schema-valid, single terminal last, contiguous sequence`, async () => {
      const events = await runCodex(id);
      for (const event of events) {
        expect(ProviderEventSchema.safeParse(event).success).toBe(true);
      }
      const terminals = events.filter((event) => isTerminalEvent(event));
      expect(terminals).toHaveLength(1);
      expect(isTerminalEvent(events[events.length - 1])).toBe(true);
      expect(events.map((event) => event.sequenceNumber)).toEqual(events.map((_, index) => index));
    });
  }
});

// --- specific violation defects ------------------------------------------

describe("mock adapters — deliberate contract violations", () => {
  it("malformedEvent: emits a schema-invalid event without repairing it", async () => {
    const events = await runCodex("malformedEvent");
    expect(events.some((event) => !ProviderEventSchema.safeParse(event).success)).toBe(true);
    expect(ProviderEventSchema.safeParse(events[1]).success).toBe(false);
  });

  it("unknownEvent: emits a discriminator outside the 13-event union", async () => {
    const events = await runCodex("unknownEvent");
    expect((PROVIDER_EVENT_TYPES as readonly string[]).includes("diagnostic.note")).toBe(false);
    expect(events.map((event) => event.type as string)).toContain("diagnostic.note");
  });

  it("duplicateSequenceNumber: repeats a sequence number", async () => {
    const seqs = (await runCodex("duplicateSequenceNumber")).map((event) => event.sequenceNumber);
    expect(new Set(seqs).size).toBeLessThan(seqs.length);
  });

  it("sequenceGap: leaves a gap in the sequence", async () => {
    const seqs = (await runCodex("sequenceGap")).map((event) => event.sequenceNumber);
    const hasGap = seqs.some((value, index) => index > 0 && value - seqs[index - 1] > 1);
    expect(hasGap).toBe(true);
  });

  it("outOfOrderEvent: emits a lower sequence after a higher one", async () => {
    const seqs = (await runCodex("outOfOrderEvent")).map((event) => event.sequenceNumber);
    const outOfOrder = seqs.some((value, index) => index > 0 && value < seqs[index - 1]);
    expect(outOfOrder).toBe(true);
  });

  it("duplicateTerminalEvent: emits more than one terminal event", async () => {
    const events = await runCodex("duplicateTerminalEvent");
    expect(events.filter((event) => isTerminalEvent(event)).length).toBeGreaterThan(1);
  });

  it("missingTerminalEvent: emits no terminal and yields a null result", async () => {
    const adapter = new MockCodexAdapter({ scenario: "missingTerminalEvent" });
    const events = await collect(adapter.execute(makeRequest("mt", "codex")));
    expect(events.filter((event) => isTerminalEvent(event))).toHaveLength(0);
    expect(adapter.getResult("mt")).toBeNull();
  });

  it("secretLikePayload: carries a clearly-FAKE example secret (never a real one)", async () => {
    expect(FAKE_AWS_ACCESS_KEY.startsWith("AKIA")).toBe(true);
    expect(FAKE_AWS_ACCESS_KEY).toContain("EXAMPLE");
    const events = await runCodex("secretLikePayload");
    const message = defined(
      events.find((event) => event.type === "agent.message"),
      "agent.message"
    );
    expect(textOf(message)).toContain(FAKE_AWS_ACCESS_KEY);
  });

  it("reviewerWriteAttempt: a read-only run emits a file.changed (T-INT-14)", async () => {
    const events = await runCodex("reviewerWriteAttempt");
    const start = defined(events.find((event) => event.type === "run.started"), "run.started");
    expect((start.payload as { readOnly: boolean }).readOnly).toBe(true);
    expect(events.some((event) => event.type === "file.changed")).toBe(true);
  });

  it("continuedEmissionAfterCancellation: ignores cancellation and completes anyway", async () => {
    const events = await runCodex("continuedEmissionAfterCancellation");
    expect(events[events.length - 1].type).toBe("run.completed");
    expect(events.filter((event) => event.type === "agent.message")).toHaveLength(3);
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
  });

  it("cleanupFailure: emits a non-terminal event after the terminal", async () => {
    const events = await runCodex("cleanupFailure");
    const terminalIndex = events.findIndex((event) => isTerminalEvent(event));
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeLessThan(events.length - 1);
    expect(events[events.length - 1].type).toBe("warning.raised");
  });
});

// --- resource + lifecycle controls ---------------------------------------

describe("mock adapters — resource + lifecycle", () => {
  it("oversizedOutput: exceeds maxOutputBytes and terminates with output_limit_exceeded", async () => {
    const adapter = new MockCodexAdapter({ scenario: "oversizedOutput" });
    const events = await collect(adapter.execute(makeRequest("ov", "codex", { maxOutputBytes: 4096 })));
    const last = events[events.length - 1];
    expect(last.type).toBe("run.failed");
    expect(errorCodeOf(last)).toBe("output_limit_exceeded");
    const big = defined(events.find((event) => event.type === "agent.message"), "agent.message");
    expect(payloadByteLength(big.payload)).toBeGreaterThan(4096);
  });

  it("timeout: the timeout scenario terminates with a timeout error", async () => {
    const events = await runCodex("timeout");
    const last = events[events.length - 1];
    expect(last.type).toBe("run.failed");
    expect(errorCodeOf(last)).toBe("timeout");
  });

  it("external cancel() stops emission at the next step with one cancellation terminal", async () => {
    const adapter = new MockCodexAdapter({ scenario: "success" });
    const iterator = adapter.execute(makeRequest("c", "codex"))[Symbol.asyncIterator]();
    await iterator.next(); // run.started
    await iterator.next(); // authentication.updated
    await adapter.cancel("c");
    const terminal = (await iterator.next()).value as ProviderEvent;
    expect(terminal.type).toBe("run.failed");
    expect(errorCodeOf(terminal)).toBe("cancelled");
    expect((await iterator.next()).done).toBe(true);
  });

  it("cancel() is idempotent and safe for an unknown execution", async () => {
    const adapter = new MockCodexAdapter({ scenario: "success" });
    await expect(adapter.cancel("does-not-exist")).resolves.toBeUndefined();
    await expect(adapter.cancel("does-not-exist")).resolves.toBeUndefined();
  });

  it("getResult derives a schema-valid structured terminal result", async () => {
    const adapter = new MockClaudeAdapter({ scenario: "structuredResult" });
    await collect(adapter.execute(makeRequest("sr", "claude")));
    const result = adapter.getResult("sr");
    expect(result).not.toBeNull();
    expect(ProviderResultSchema.safeParse(result).success).toBe(true);
    expect(result?.status).toBe("completed");
    expect(result?.provider).toBe("claude");
    expect(result?.filesChanged).toContain("src/feature.ts");
    expect(result?.usage).not.toBeNull();
  });
});

// --- per-execution clock (adapter reuse) ---------------------------------

describe("mock adapters — per-execution clock", () => {
  it("a reused adapter replays each execution from the frozen epoch (own per-run clock)", async () => {
    const adapter = new MockCodexAdapter({ scenario: "success" });
    const first = await collect(adapter.execute(makeRequest("reuse", "codex")));
    const second = await collect(adapter.execute(makeRequest("reuse", "codex")));
    // With no injected clock each execute() gets its OWN fresh ManualClock, so the
    // second run is byte-identical to the first (reproducible in isolation; not
    // corrupted by a shared, already-advanced clock).
    expect(second).toEqual(first);
    expect(second[0].timestamp).toBe(first[0].timestamp);
  });

  it("an explicitly injected clock is shared across executions (single-execution semantics)", async () => {
    const adapter = new MockCodexAdapter({ scenario: "success", clock: new ManualClock() });
    const first = await collect(adapter.execute(makeRequest("shared", "codex")));
    const second = await collect(adapter.execute(makeRequest("shared", "codex")));
    // A caller-owned clock keeps advancing, so the second run starts strictly later.
    expect(second[0].timestamp > first[0].timestamp).toBe(true);
  });
});

// --- quota + error scenario semantics ------------------------------------

const quotaOf = (event: ProviderEvent): Record<string, unknown> =>
  (event.payload as { quota: Record<string, unknown> }).quota;
const usageOf = (event: ProviderEvent): Record<string, unknown> =>
  (event.payload as { usage: Record<string, unknown> }).usage;

describe("mock adapters — quota + error scenario semantics", () => {
  it("rateLimited: a rate_limited quota signal then a rate_limited terminal", async () => {
    const events = await runCodex("rateLimited");
    const quota = quotaOf(defined(events.find((e) => e.type === "quota.updated"), "quota.updated"));
    expect(quota.status).toBe("rate_limited");
    const last = events[events.length - 1];
    expect(last.type).toBe("run.failed");
    expect(errorCodeOf(last)).toBe("rate_limited");
  });

  it("quotaWarning: a warning quota signal (util 0.82) then a normal completion", async () => {
    const events = await runCodex("quotaWarning");
    const quota = quotaOf(defined(events.find((e) => e.type === "quota.updated"), "quota.updated"));
    expect(quota.status).toBe("warning");
    expect(quota.utilization).toBe(0.82);
    expect(events[events.length - 1].type).toBe("run.completed");
  });

  it("quotaExhausted: an exhausted quota signal then a quota_exhausted terminal", async () => {
    const events = await runCodex("quotaExhausted");
    const quota = quotaOf(defined(events.find((e) => e.type === "quota.updated"), "quota.updated"));
    expect(quota.status).toBe("exhausted");
    expect(quota.utilization).toBe(1);
    const last = events[events.length - 1];
    expect(last.type).toBe("run.failed");
    expect(errorCodeOf(last)).toBe("quota_exhausted");
  });

  it("quotaUnknown: status/window/source all 'unknown', never fabricated", async () => {
    const events = await runCodex("quotaUnknown");
    const quota = quotaOf(defined(events.find((e) => e.type === "quota.updated"), "quota.updated"));
    expect(quota.status).toBe("unknown");
    expect(quota.window).toBe("unknown");
    expect(quota.source).toBe("unknown");
    expect(quota.utilization).toBeUndefined();
    expect(events[events.length - 1].type).toBe("run.completed");
  });

  it("usage and quota payloads emit isBillingAuthoritative=false in the RAW stream", async () => {
    const usage = usageOf(
      defined((await runCodex("usageUpdate")).find((e) => e.type === "usage.updated"), "usage.updated")
    );
    expect(usage.isBillingAuthoritative).toBe(false);
    const quota = quotaOf(
      defined((await runCodex("quotaExhausted")).find((e) => e.type === "quota.updated"), "quota.updated")
    );
    expect(quota.isBillingAuthoritative).toBe(false);
  });
});

// --- conformance labelling (guards mislabels) ----------------------------

// The full, explicit map of every scenario's conformance label. A future
// mis-labelling of a schema-valid violation (secretLikePayload,
// reviewerWriteAttempt, continuedEmissionAfterCancellation) — which the 24/11
// count test cannot catch on its own — is caught here.
const EXPECTED_CONFORMANCE: Record<ScenarioId, ScenarioConformance> = {
  success: "conformant",
  authenticationRequired: "conformant",
  authenticationExpired: "conformant",
  unavailableProvider: "conformant",
  unsupportedVersion: "conformant",
  timeout: "conformant",
  cancellationBeforeStart: "conformant",
  cancellationDuringStream: "conformant",
  providerCrash: "conformant",
  partialRun: "conformant",
  malformedEvent: "violating",
  unknownEvent: "violating",
  duplicateSequenceNumber: "violating",
  sequenceGap: "violating",
  outOfOrderEvent: "violating",
  duplicateTerminalEvent: "violating",
  missingTerminalEvent: "violating",
  rateLimited: "conformant",
  quotaWarning: "conformant",
  quotaExhausted: "conformant",
  quotaUnknown: "conformant",
  usageUpdate: "conformant",
  toolUse: "conformant",
  fileChange: "conformant",
  approvalRequest: "conformant",
  warning: "conformant",
  structuredResult: "conformant",
  oversizedOutput: "conformant",
  secretLikePayload: "violating",
  reviewerWriteAttempt: "violating",
  continuedEmissionAfterCancellation: "violating",
  cleanupFailure: "violating",
  wallTimeExhaustion: "conformant",
  maxTurnExhaustion: "conformant",
  maxRepairLoopExhaustion: "conformant"
};

describe("mock adapters — scenario conformance labelling", () => {
  it("labels every one of the 35 scenarios exactly as expected", () => {
    const catalog = createScenarioCatalog("codex");
    const actual = Object.fromEntries(
      SCENARIO_IDS.map((id) => [id, catalog[id].conformance])
    ) as Record<ScenarioId, ScenarioConformance>;
    expect(actual).toEqual(EXPECTED_CONFORMANCE);
  });

  it("conformance labelling is provider-agnostic (codex === claude)", () => {
    const codex = createScenarioCatalog("codex");
    const claude = createScenarioCatalog("claude");
    for (const id of SCENARIO_IDS) {
      expect(claude[id].conformance).toBe(codex[id].conformance);
    }
  });
});
