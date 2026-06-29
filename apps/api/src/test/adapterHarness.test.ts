import { describe, expect, it } from "vitest";
import {
  AgentExecutionRequestSchema,
  type AgentExecutionRequest,
  type AuthenticationResult,
  type AvailabilityResult,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import {
  CONFORMANT_SCENARIO_IDS,
  MockClaudeAdapter,
  MockCodexAdapter,
  VIOLATING_SCENARIO_IDS,
  type ScenarioId
} from "../providers/mock/index.js";
import {
  ConformanceInvariant,
  findInvariant,
  runConformanceCheck,
  type ConformanceInvariantId,
  type ConformanceReport,
  type HarnessMode
} from "../providers/harness/index.js";

// --- helpers -------------------------------------------------------------

function makeRequest(
  executionId: string,
  provider: ProviderId,
  overrides: Record<string, unknown> = {}
): AgentExecutionRequest {
  return AgentExecutionRequestSchema.parse({
    executionId,
    provider,
    objective: "harness objective",
    timeoutMs: 3_600_000,
    ...overrides
  });
}

const adapterFor = (provider: ProviderId, scenario: ScenarioId): ProviderAdapter =>
  provider === "codex"
    ? new MockCodexAdapter({ scenario })
    : new MockClaudeAdapter({ scenario });

const statusOf = (report: ConformanceReport, id: ConformanceInvariantId): string | undefined =>
  findInvariant(report, id)?.status;

function failedInvariantIds(report: ConformanceReport): ConformanceInvariantId[] {
  return report.invariants.filter((invariant) => invariant.status === "fail").map((i) => i.id);
}

const PROVIDERS: ProviderId[] = ["codex", "claude"];

/**
 * Conformant scenarios driven as WRITABLE runs (`run.started{readOnly:false}`),
 * which legitimately emit file.changed (fileChange, structuredResult) or model a
 * write-capable run (approvalRequest). Authority over read-only is the REQUEST,
 * not the adapter payload (H1), so these MUST be driven with `readOnly:false` or
 * NO_WRITE_UNDER_READ_ONLY would (correctly) fire on the request/payload divergence.
 */
const WRITABLE_CONFORMANT_IDS = new Set<ScenarioId>([
  "fileChange",
  "approvalRequest",
  "structuredResult"
]);

const conformantOverrides = (id: ScenarioId): Record<string, unknown> =>
  WRITABLE_CONFORMANT_IDS.has(id) ? { readOnly: false } : {};

// --- conformant scenarios pass on both adapters --------------------------

describe("adapter harness — conformant scenarios pass", () => {
  for (const provider of PROVIDERS) {
    for (const id of CONFORMANT_SCENARIO_IDS) {
      it(`${provider}/${id}: ok with no failing invariant`, async () => {
        const adapter = adapterFor(provider, id);
        const report = await runConformanceCheck(
          adapter,
          makeRequest(`exec-${id}`, provider, conformantOverrides(id))
        );
        expect(report.ok, `failing: ${failedInvariantIds(report).join(", ")}`).toBe(true);
        expect(failedInvariantIds(report)).toHaveLength(0);
        expect(report.provider).toBe(provider);
        // the structured result is DERIVED from the stream, never adapter.getResult()
        expect(report.result?.provider ?? provider).toBe(provider);
      });
    }
  }

  it("reports a full, canonically-ordered invariant set", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "success" }),
      makeRequest("exec-shape", "codex")
    );
    expect(report.invariants.length).toBeGreaterThanOrEqual(18);
    // every invariant id appears exactly once
    const ids = report.invariants.map((invariant) => invariant.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- violating scenarios fail the SPECIFIC invariant ---------------------

interface ViolationCase {
  id: ScenarioId;
  invariant: ConformanceInvariantId;
  mode?: HarnessMode;
}

const VIOLATION_CASES: ViolationCase[] = [
  { id: "malformedEvent", invariant: ConformanceInvariant.EVENT_SCHEMA_VALID },
  { id: "unknownEvent", invariant: ConformanceInvariant.EVENT_TYPE_KNOWN },
  { id: "duplicateSequenceNumber", invariant: ConformanceInvariant.SEQUENCE_NO_DUPLICATES },
  { id: "sequenceGap", invariant: ConformanceInvariant.SEQUENCE_CONTIGUOUS },
  { id: "outOfOrderEvent", invariant: ConformanceInvariant.SEQUENCE_MONOTONIC },
  { id: "duplicateTerminalEvent", invariant: ConformanceInvariant.EXACTLY_ONE_TERMINAL },
  { id: "missingTerminalEvent", invariant: ConformanceInvariant.EXACTLY_ONE_TERMINAL },
  { id: "secretLikePayload", invariant: ConformanceInvariant.NO_SECRET_LEAKAGE },
  { id: "reviewerWriteAttempt", invariant: ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY },
  {
    id: "continuedEmissionAfterCancellation",
    invariant: ConformanceInvariant.CANCELLATION_STOPS_EMISSION,
    mode: "cancellation"
  },
  { id: "cleanupFailure", invariant: ConformanceInvariant.NO_EVENTS_AFTER_TERMINAL }
];

describe("adapter harness — violating scenarios fail their invariant", () => {
  for (const provider of PROVIDERS) {
    for (const { id, invariant, mode } of VIOLATION_CASES) {
      it(`${provider}/${id}: not ok, ${invariant} fails`, async () => {
        const adapter = adapterFor(provider, id);
        const report = await runConformanceCheck(adapter, makeRequest(`exec-${id}`, provider), {
          mode: mode ?? "normal"
        });
        expect(report.ok).toBe(false);
        expect(statusOf(report, invariant)).toBe("fail");
      });
    }
  }

  it("covers every violating catalog scenario", () => {
    const covered = new Set(VIOLATION_CASES.map((c) => c.id));
    for (const id of VIOLATING_SCENARIO_IDS) {
      expect(covered.has(id)).toBe(true);
    }
  });

  it("sequenceGap fails contiguity but keeps monotonicity (specificity)", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "sequenceGap" }),
      makeRequest("exec-gap", "codex")
    );
    expect(statusOf(report, ConformanceInvariant.SEQUENCE_CONTIGUOUS)).toBe("fail");
    expect(statusOf(report, ConformanceInvariant.SEQUENCE_MONOTONIC)).toBe("pass");
  });

  it("secretLikePayload: only the secret invariant fails and findings are populated", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "secretLikePayload" }),
      makeRequest("exec-secret", "codex")
    );
    expect(failedInvariantIds(report)).toEqual([ConformanceInvariant.NO_SECRET_LEAKAGE]);
    expect(report.secretFindings.length).toBeGreaterThan(0);
    expect(report.secretFindings[0].detector).toBe("aws_access_key_id");
  });

  it("reviewerWriteAttempt: read-only run flagged for a write (T-INT-14)", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "reviewerWriteAttempt" }),
      makeRequest("exec-write", "codex")
    );
    expect(failedInvariantIds(report)).toEqual([ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY]);
  });
});

// --- mode-specific invariants pass when exercised correctly --------------

describe("adapter harness — lifecycle modes", () => {
  it("timeout mode: timeout scenario yields a timeout terminal", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "timeout" }),
      makeRequest("exec-timeout", "codex"),
      { mode: "timeout" }
    );
    expect(report.ok, failedInvariantIds(report).join(", ")).toBe(true);
    expect(statusOf(report, ConformanceInvariant.TIMEOUT_PRODUCES_TERMINAL)).toBe("pass");
    expect(report.result?.error?.code).toBe("timeout");
  });

  it("cancellation mode: a well-behaved adapter stops with a cancelled terminal", async () => {
    const report = await runConformanceCheck(
      new MockClaudeAdapter({ scenario: "success" }),
      makeRequest("exec-cancel", "claude"),
      { mode: "cancellation", cancelAfterEvents: 1 }
    );
    expect(report.ok, failedInvariantIds(report).join(", ")).toBe(true);
    expect(statusOf(report, ConformanceInvariant.CANCELLATION_STOPS_EMISSION)).toBe("pass");
    expect(report.result?.status).toBe("cancelled");
  });

  it("output-limit mode: oversizedOutput is enforced when a budget is set", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "oversizedOutput" }),
      makeRequest("exec-output", "codex", { maxOutputBytes: 4096 }),
      { mode: "normal" }
    );
    expect(report.ok, failedInvariantIds(report).join(", ")).toBe(true);
    expect(statusOf(report, ConformanceInvariant.OUTPUT_LIMITS_ENFORCED)).toBe("pass");
    expect(report.result?.error?.code).toBe("output_limit_exceeded");
  });
});

// --- cancel idempotence + the max-event guard ----------------------------

/** A minimal, NON-mock adapter that yields an unbounded stream (orphan/runaway). */
class InfiniteAdapter implements ProviderAdapter {
  readonly provider: ProviderId = "codex";
  private cancelCalls = 0;

  async checkAvailability(): Promise<AvailabilityResult> {
    throw new Error("not used by the harness");
  }
  async checkAuthentication(): Promise<AuthenticationResult> {
    throw new Error("not used by the harness");
  }
  async getCapabilities(): Promise<ProviderCapabilities> {
    throw new Error("not used by the harness");
  }
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    let seq = 0;
    yield event("run.started", { readOnly: true }, seq, request, base + 1000);
    seq += 1;
    while (true) {
      yield event(
        "agent.message",
        { role: "assistant", text: "looping forever" },
        seq,
        request,
        base + 1000 * (seq + 1)
      );
      seq += 1;
    }
  }
  async cancel(): Promise<void> {
    this.cancelCalls += 1;
  }
  get cancelCount(): number {
    return this.cancelCalls;
  }
}

/** A minimal, NON-mock adapter that emits a clean two-event run. */
class CleanInlineAdapter implements ProviderAdapter {
  readonly provider: ProviderId = "claude";
  async checkAvailability(): Promise<AvailabilityResult> {
    throw new Error("not used by the harness");
  }
  async checkAuthentication(): Promise<AuthenticationResult> {
    throw new Error("not used by the harness");
  }
  async getCapabilities(): Promise<ProviderCapabilities> {
    throw new Error("not used by the harness");
  }
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000, "claude");
    yield event(
      "run.completed",
      { summary: "done", filesChangedCount: 0 },
      1,
      request,
      base + 2000,
      "claude"
    );
  }
  async cancel(): Promise<void> {
    /* no-op */
  }
}

function event(
  type: string,
  payload: unknown,
  sequenceNumber: number,
  request: AgentExecutionRequest,
  whenMs: number,
  provider: ProviderId = "codex"
): ProviderEvent {
  return {
    schemaVersion: request.schemaVersion,
    executionId: request.executionId,
    provider,
    sequenceNumber,
    timestamp: new Date(whenMs).toISOString(),
    rawEvidenceRef: null,
    type,
    payload
  } as unknown as ProviderEvent;
}

describe("adapter harness — guard + idempotence + reuse", () => {
  it("caps a runaway stream instead of hanging, and flags WITHIN_EVENT_BUDGET", async () => {
    const adapter = new InfiniteAdapter();
    const report = await runConformanceCheck(adapter, makeRequest("exec-runaway", "codex"), {
      maxEvents: 12
    });
    expect(report.eventBudgetExceeded).toBe(true);
    expect(report.events).toHaveLength(12);
    expect(statusOf(report, ConformanceInvariant.WITHIN_EVENT_BUDGET)).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("continuedEmissionAfterCancellation does not hang under a small cap", async () => {
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "continuedEmissionAfterCancellation" }),
      makeRequest("exec-orphan", "codex"),
      { mode: "cancellation", cancelAfterEvents: 1, maxEvents: 3 }
    );
    expect(report.events.length).toBeLessThanOrEqual(3);
    expect(report.ok).toBe(false);
  });

  it("cancel() is idempotent: the harness probes it twice without throwing", async () => {
    const adapter = new InfiniteAdapter();
    const report = await runConformanceCheck(adapter, makeRequest("exec-idem", "codex"), {
      maxEvents: 5
    });
    expect(statusOf(report, ConformanceInvariant.CANCEL_IDEMPOTENT)).toBe("pass");
    // the harness issued at least two cancel() calls (post-drain probe)
    expect(adapter.cancelCount).toBeGreaterThanOrEqual(2);

    // direct double-cancel on a mock adapter is also safe
    const mock = new MockCodexAdapter({ scenario: "success" });
    await expect(mock.cancel("nope")).resolves.toBeUndefined();
    await expect(mock.cancel("nope")).resolves.toBeUndefined();
  });

  it("validates a NON-mock adapter through the public interface alone", async () => {
    const report = await runConformanceCheck(
      new CleanInlineAdapter(),
      makeRequest("exec-clean", "claude")
    );
    expect(report.ok, failedInvariantIds(report).join(", ")).toBe(true);
    expect(report.result?.status).toBe("completed");
    expect(report.provider).toBe("claude");
  });
});

// --- hardened gate: correct for A3 REAL adapters, not just the mocks ------
//
// These hand-rolled, NON-mock adapters exercise the adversarial-review fixes
// (H1/M1–M5/L4/L5) that the mock catalog cannot reach: a write-laundering
// adapter, a wedged stream, a throwing adapter, a terminal-hidden flood, a
// spoofed provider id and a byte-identical duplicate event.

/** Shared boilerplate for the inline adapters below (probes are unused by the harness). */
abstract class InlineAdapterBase implements ProviderAdapter {
  abstract readonly provider: ProviderId;
  async checkAvailability(): Promise<AvailabilityResult> {
    throw new Error("not used by the harness");
  }
  async checkAuthentication(): Promise<AuthenticationResult> {
    throw new Error("not used by the harness");
  }
  async getCapabilities(): Promise<ProviderCapabilities> {
    throw new Error("not used by the harness");
  }
  abstract execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent>;
  async cancel(): Promise<void> {
    /* no-op */
  }
}

/** H1: claims readOnly:false in run.started AND emits file.changed — a laundered write. */
class WriteLaunderingAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: false }, 0, request, base + 1000);
    yield event(
      "file.changed",
      { path: "src/laundered.ts", changeType: "modified", diffHash: "sha256:bad" },
      1,
      request,
      base + 2000
    );
    yield event("run.completed", { summary: "laundered a write", filesChangedCount: 1 }, 2, request, base + 3000);
  }
}

/** M2: yields run.started then wedges forever (never produces another event). */
class StallingAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000);
    await new Promise<never>(() => {
      /* never resolves: a hung CLI / wedged stream */
    });
  }
}

/** M3: throws mid-iteration (after one event). */
class ThrowingDuringIterationAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000);
    throw new Error("boom during iteration");
  }
}

/** M3: throws synchronously from execute(), before returning an iterable. */
class ThrowingAtExecuteAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  execute(): AsyncIterable<ProviderEvent> {
    throw new Error("boom at execute()");
  }
}

/** M4: hides a huge flood in the run.completed.summary terminal payload. */
class TerminalFloodAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000);
    yield event(
      "run.completed",
      { summary: "y".repeat(70_000), filesChangedCount: 0 },
      1,
      request,
      base + 2000
    );
  }
}

/** L5: an event whose provider id is spoofed to another provider. */
class SpoofedIdentityAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000);
    // Spoofed: claims to be "claude" while the adapter is "codex".
    yield event("agent.message", { role: "assistant", text: "spoofed" }, 1, request, base + 2000, "claude");
    yield event("run.completed", { summary: "done", filesChangedCount: 0 }, 2, request, base + 3000);
  }
}

/** L5: emits a byte-identical duplicate of a prior event. */
class DuplicateEventAdapter extends InlineAdapterBase {
  readonly provider: ProviderId = "codex";
  async *execute(request: AgentExecutionRequest): AsyncGenerator<ProviderEvent> {
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    yield event("run.started", { readOnly: true }, 0, request, base + 1000);
    const dup = event("agent.message", { role: "assistant", text: "same" }, 1, request, base + 2000);
    yield dup;
    yield dup; // byte-identical repeat (same fields, same sequenceNumber, same timestamp)
    yield event("run.completed", { summary: "done", filesChangedCount: 0 }, 2, request, base + 3000);
  }
}

describe("adapter harness — hardened gate (A3 readiness)", () => {
  it("H1: a write cannot be laundered via run.started{readOnly:false} under request.readOnly=true", async () => {
    const report = await runConformanceCheck(
      new WriteLaunderingAdapter(),
      makeRequest("exec-launder", "codex") // request.readOnly defaults to true (authoritative)
    );
    expect(statusOf(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)).toBe("fail");
    expect(report.ok).toBe(false);
    const detail = findInvariant(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)?.detail ?? "";
    // both the write and the request/payload divergence are reported
    expect(detail).toContain("file.changed");
    expect(detail).toContain("diverges");
  });

  it("M1: cancellation tolerates in-flight drain but fails past the allowance (default 3)", async () => {
    // continuedEmission emits 4 events after cancel; allowance 3 -> fail.
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "continuedEmissionAfterCancellation" }),
      makeRequest("exec-m1", "codex"),
      { mode: "cancellation", cancelAfterEvents: 1 }
    );
    expect(statusOf(report, ConformanceInvariant.CANCELLATION_STOPS_EMISSION)).toBe("fail");

    // The same misbehaviour PASSES if the allowance is widened past the drain.
    const lenient = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "continuedEmissionAfterCancellation" }),
      makeRequest("exec-m1b", "codex"),
      { mode: "cancellation", cancelAfterEvents: 1, cancelDrainAllowance: 10 }
    );
    // it completed (race) within the widened allowance, terminal last -> pass
    expect(statusOf(lenient, ConformanceInvariant.CANCELLATION_STOPS_EMISSION)).toBe("pass");
  });

  it("M2: a wedged stream is caught by livenessTimeoutMs and fails ADAPTER_LIVENESS", async () => {
    const report = await runConformanceCheck(
      new StallingAdapter(),
      makeRequest("exec-stall", "codex"),
      { livenessTimeoutMs: 20 }
    );
    expect(statusOf(report, ConformanceInvariant.ADAPTER_LIVENESS)).toBe("fail");
    expect(report.ok).toBe(false);
    expect(report.events).toHaveLength(1); // only run.started arrived before the wedge
  });

  it("M2: ADAPTER_LIVENESS is skipped (no real timer) when livenessTimeoutMs is unset", async () => {
    const report = await runConformanceCheck(
      new CleanInlineAdapter(),
      makeRequest("exec-noliveness", "claude")
    );
    expect(statusOf(report, ConformanceInvariant.ADAPTER_LIVENESS)).toBe("skip");
    expect(report.ok).toBe(true);
  });

  it("M3: a throwing adapter is reported as a failure and never throws out of the harness", async () => {
    const duringIteration = await runConformanceCheck(
      new ThrowingDuringIterationAdapter(),
      makeRequest("exec-throw1", "codex")
    );
    expect(duringIteration.ok).toBe(false);
    expect(statusOf(duringIteration, ConformanceInvariant.ADAPTER_NO_THROW)).toBe("fail");

    const atExecute = await runConformanceCheck(
      new ThrowingAtExecuteAdapter(),
      makeRequest("exec-throw2", "codex")
    );
    expect(atExecute.ok).toBe(false);
    expect(statusOf(atExecute, ConformanceInvariant.ADAPTER_NO_THROW)).toBe("fail");
  });

  it("M4: a flood hidden in the run.completed terminal payload is caught", async () => {
    const report = await runConformanceCheck(
      new TerminalFloodAdapter(),
      makeRequest("exec-terminal-flood", "codex", { maxOutputBytes: 4096 })
    );
    expect(statusOf(report, ConformanceInvariant.OUTPUT_LIMITS_ENFORCED)).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("M5: generic high-entropy hits are non-failing warnings, not NO_SECRET_LEAKAGE failures", async () => {
    // secretLikePayload still HARD-fails via the AWS shape (not entropy).
    const report = await runConformanceCheck(
      new MockCodexAdapter({ scenario: "secretLikePayload" }),
      makeRequest("exec-m5", "codex")
    );
    expect(statusOf(report, ConformanceInvariant.NO_SECRET_LEAKAGE)).toBe("fail");
    expect(report.secretFindings.every((f) => f.severity === "high")).toBe(true);
    expect(report.secretFindings.some((f) => f.detector === "aws_access_key_id")).toBe(true);
    // no entropy finding promoted into the hard-failing set
    expect(report.secretFindings.some((f) => f.detector === "high_entropy_token")).toBe(false);
  });

  it("L5: a spoofed provider identity fails PROVIDER_IDENTITY_STABLE", async () => {
    const report = await runConformanceCheck(
      new SpoofedIdentityAdapter(),
      makeRequest("exec-spoof", "codex")
    );
    expect(statusOf(report, ConformanceInvariant.PROVIDER_IDENTITY_STABLE)).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("L5: a byte-identical duplicate event fails NO_DUPLICATE_EVENTS", async () => {
    const report = await runConformanceCheck(
      new DuplicateEventAdapter(),
      makeRequest("exec-dup", "codex")
    );
    expect(statusOf(report, ConformanceInvariant.NO_DUPLICATE_EVENTS)).toBe("fail");
    expect(report.ok).toBe(false);
  });
});
