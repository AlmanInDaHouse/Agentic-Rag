/**
 * Mock provider adapters (A2.1).
 *
 * `MockCodexAdapter` and `MockClaudeAdapter` implement the A1 `ProviderAdapter`
 * interface on top of the shared deterministic scenario engine. They are
 * test/dev doubles only: NO real CLI, NO network, NO credentials, NO writes.
 * The runtime is NOT wired to execute them (A2.1 is the framework; wiring is
 * later milestones).
 *
 * The two adapters share everything but identity: the provider id, the
 * capability-snapshot fixture, and the per-provider scenario catalog (which only
 * differs in identity and the inherited quota-flavor vocabulary). There is no
 * other per-provider branching — that would violate the provider-agnostic
 * contract boundary (ADR 0033 / PROVIDER_CONTRACTS_SPEC §"Non-Goals").
 */

import type {
  AgentExecutionRequest,
  AuthenticationResult,
  AvailabilityResult,
  CapabilitySnapshot,
  CapabilityState,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderEvent,
  ProviderId,
  ProviderResult
} from "@triforge/shared";
import { ManualClock, type Clock } from "./clock.js";
import {
  runScenario,
  type CancelState,
  type EngineContext,
  type ScenarioDefinition,
  deriveProviderResult
} from "./scenarioEngine.js";
import { createScenarioCatalog, type ScenarioId } from "./scenarios.js";

export interface MockAdapterOptions {
  /** Scenario to replay: a catalog id or an inline definition (ad-hoc tests). */
  scenario: ScenarioId | ScenarioDefinition;
  /**
   * Injected clock. When omitted (the default), each `execute()` resolves its
   * OWN fresh deterministic `ManualClock`, so executions never share/advance one
   * clock and every run is independently reproducible and concurrency-safe (the
   * adapter can be reused across executions — A2.2). When explicitly provided,
   * the SAME clock is shared by every probe and every `execute()`: caller-owned
   * time, single-execution semantics (do not reuse such an adapter for
   * concurrent/sequential runs that must be isolated).
   */
  clock?: Clock;
  /** Default per-execution timeout if the request omits one. */
  timeoutMs?: number | null;
  /** Default output-byte budget if the request omits one (`null` = unbounded). */
  maxOutputBytes?: number | null;
}

interface RunRecord {
  cancelState: CancelState;
  events: ProviderEvent[];
  schemaVersion: string;
}

/** Per-provider capability-snapshot fixture (tri-state; mock, read-only). */
function baseCapabilities(provider: ProviderId): Omit<CapabilitySnapshot, "verifiedAt"> {
  const shared = {
    headlessSupport: "yes" as CapabilityState,
    structuredOutput: "yes" as CapabilityState,
    eventStream: "yes" as CapabilityState,
    authProbe: "yes" as CapabilityState,
    usageObservable: "yes" as CapabilityState,
    readOnly: "yes" as CapabilityState,
    write: "no" as CapabilityState, // mock + A2/A3 are read-only
    cancellation: "yes" as CapabilityState,
    unknownCapabilities: [] as string[]
  };
  if (provider === "codex") {
    return {
      provider,
      cliVersion: "mock-codex-1.0.0",
      ...shared,
      quotaObservable: "yes", // codex exposes a usage window
      resume: "unknown"
    };
  }
  return {
    provider,
    cliVersion: "mock-claude-1.0.0",
    ...shared,
    quotaObservable: "unknown", // claude quota is partially opaque
    resume: "yes"
  };
}

export abstract class BaseMockAdapter implements ProviderAdapter {
  abstract readonly provider: ProviderId;

  /**
   * Clock for the stateless probe methods (checkAvailability /
   * checkAuthentication / getCapabilities). These are point-in-time reads, not
   * executions, so they share one probe clock. `execute()` resolves its own
   * per-run clock (see below) and does NOT use this one.
   */
  protected readonly probeClock: Clock;
  private readonly options: MockAdapterOptions;
  private readonly runs = new Map<string, RunRecord>();

  constructor(options: MockAdapterOptions) {
    this.options = options;
    this.probeClock = options.clock ?? new ManualClock();
  }

  /** Resolve the configured scenario for this adapter's provider. */
  protected resolveScenario(): ScenarioDefinition {
    const { scenario } = this.options;
    if (typeof scenario === "string") {
      return createScenarioCatalog(this.provider)[scenario];
    }
    return scenario;
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const probe = this.resolveScenario().probe;
    const caps = baseCapabilities(this.provider);
    return {
      provider: this.provider,
      status: probe?.availability ?? "available",
      cliVersion: probe?.cliVersion ?? caps.cliVersion,
      detail: null,
      checkedAt: this.probeClock.iso()
    };
  }

  async checkAuthentication(): Promise<AuthenticationResult> {
    const probe = this.resolveScenario().probe;
    return {
      provider: this.provider,
      state: probe?.authentication ?? "authenticated",
      detail: null,
      checkedAt: this.probeClock.iso()
    };
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const probe = this.resolveScenario().probe;
    const caps = baseCapabilities(this.provider);
    const snapshot: CapabilitySnapshot = {
      ...caps,
      cliVersion: probe?.cliVersion !== undefined ? probe.cliVersion : caps.cliVersion,
      verifiedAt: this.probeClock.iso(),
      ...(probe?.capabilityOverrides ?? {})
    };
    return snapshot;
  }

  execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent> {
    const scenario = this.resolveScenario();
    const cancelState: CancelState = { requested: false };
    const events: ProviderEvent[] = [];
    this.runs.set(request.executionId, {
      cancelState,
      events,
      schemaVersion: request.schemaVersion
    });

    // Per-execution clock. With no injected clock, EACH execute() gets its OWN
    // fresh ManualClock starting at the frozen epoch, so sequential and
    // concurrent runs are independently reproducible and never corrupt each
    // other's timestamps by advancing a shared clock. When `options.clock` IS
    // injected, that single clock is shared across executions — single-execution,
    // caller-owned-time semantics (see MockAdapterOptions.clock).
    const clock = this.options.clock ?? new ManualClock();

    const ctx: EngineContext = {
      executionId: request.executionId,
      provider: this.provider,
      clock,
      cancelState,
      timeoutMs: request.timeoutMs ?? this.options.timeoutMs ?? null,
      maxOutputBytes: request.maxOutputBytes ?? this.options.maxOutputBytes ?? null,
      recordedEvents: events
    };

    return runScenario(scenario, ctx);
  }

  /** Cooperative cancellation: flips the flag the running engine observes next step. Idempotent. */
  async cancel(executionId: string): Promise<void> {
    const run = this.runs.get(executionId);
    if (run) {
      run.cancelState.requested = true;
    }
  }

  /**
   * Structured terminal result for a (drained) execution, derived from the
   * recorded events. Returns `null` if the stream produced no terminal event
   * (missing-terminal violation) or the execution is unknown.
   */
  getResult(executionId: string): ProviderResult | null {
    const run = this.runs.get(executionId);
    if (!run) {
      return null;
    }
    return deriveProviderResult(run.events, {
      provider: this.provider,
      executionId,
      schemaVersion: run.schemaVersion
    });
  }
}

export class MockCodexAdapter extends BaseMockAdapter {
  readonly provider: ProviderId = "codex";
}

export class MockClaudeAdapter extends BaseMockAdapter {
  readonly provider: ProviderId = "claude";
}
