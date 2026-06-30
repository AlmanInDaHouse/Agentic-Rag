/**
 * Real read-only provider adapter base (A3).
 *
 * `RealAdapter` implements the A1 `ProviderAdapter` interface on top of the
 * injectable `ProcessRunner` and the shared normalizer core. The Codex and Claude
 * adapters are thin subclasses that supply ONLY: the binary name, the argument
 * vectors (version probe, auth probe, read-only headless execute), the version /
 * auth parsers, the line mapper, and the version-bound capability fixture. No
 * other per-provider branching exists (PROVIDER_CONTRACTS_SPEC: provider-agnostic
 * boundary).
 *
 * Read-only + security model:
 *  - `execute` builds a read-only headless invocation (explicit argv, the provider
 *    read-only/sandbox flag where the documented CLI supports it, an env allowlist,
 *    an explicit cwd). The normalizer guarantees no `file.changed` is fabricated;
 *    under a read-only request a conformant CLI emits none.
 *  - The environment is an allowlist of NAMES; values are pulled from `process.env`
 *    only inside `NodeProcessRunner` (CLI spec §12; threat model T-EXE-09).
 *  - No credential is ever read, stored, logged or transmitted (ADR 0029). The auth
 *    probe inspects only a NON-secret reported state.
 *
 * The runtime is NOT wired to construct these with a `NodeProcessRunner`; that is a
 * later milestone. In CI/tests they are driven with a `FakeProcessRunner`.
 */

import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  type AgentExecutionRequest,
  type AuthenticationResult,
  type AuthenticationState,
  type AvailabilityResult,
  type CapabilitySnapshot,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderError,
  type ProviderEvent,
  type ProviderEventType,
  type ProviderId
} from "@triforge/shared";
import { ManualClock, type Clock } from "../clock.js";
import { DEFAULT_TICK_MS, makeRealEvidenceRef, normalizeProcess } from "./normalizerCore.js";
import type { ProviderLineMapper } from "./normalizerCore.js";
import {
  isCredentialEnvName,
  type ProcessExit,
  type ProcessRunner,
  type ProcessRunSpec,
  type RunningProcess
} from "./processRunner.js";
import { authorizeWritable, type WritableProfile } from "./writableProfile.js";

/** The version-bound capability fields (everything on the snapshot except metadata). */
export type CapabilityFields = Omit<CapabilitySnapshot, "provider" | "cliVersion" | "verifiedAt">;

/** All capabilities unknown — the conservative snapshot used on version drift. */
const ALL_UNKNOWN: CapabilityFields = {
  headlessSupport: "unknown",
  structuredOutput: "unknown",
  eventStream: "unknown",
  authProbe: "unknown",
  usageObservable: "unknown",
  quotaObservable: "unknown",
  readOnly: "unknown",
  write: "unknown",
  cancellation: "unknown",
  resume: "unknown",
  unknownCapabilities: []
};

/** Per-provider configuration — the ONLY place provider differences live. */
export interface RealAdapterConfig {
  provider: ProviderId;
  /** Binary name, executed directly (no shell). */
  bin: string;
  /** Version the capability fixture was recorded against; a different version invalidates it. */
  knownVersion: string;
  /** Argv for the `--version` probe. */
  versionArgs: string[];
  /** Argv for the NON-secret auth-state probe (REQUIRES_VERIFICATION). */
  authProbeArgs: string[];
  /** Capability fixture when the detected version equals `knownVersion`. */
  knownCapabilities: CapabilityFields;
  /** The provider line mapper (the provider-specific normalizer). */
  mapper: ProviderLineMapper;
  /** Build the read-only headless execute argv from a request. */
  buildExecArgs(request: AgentExecutionRequest): string[];
  /**
   * Build the CONTROLLED writable execute argv (A10.3). Optional: an adapter without
   * this builder has no writable profile and always refuses `readOnly:false`. When
   * present, it is used ONLY after {@link authorizeWritable} has authorized the run.
   */
  buildWritableExecArgs?(request: AgentExecutionRequest): string[];
  /** Extract a version string from `--version` output, or null. */
  parseVersion(output: string): string | null;
  /** Map probe output + exit onto a non-secret auth state. */
  parseAuth(output: string, exit: ProcessExit): AuthenticationState;
  /** Env-var NAMES always forwarded (unioned with the request allowlist). */
  defaultEnvAllowlist: string[];
}

export interface RealAdapterOptions {
  /**
   * Injected clock. When omitted, probes share one fresh `ManualClock` and EACH
   * `execute()` resolves its own fresh `ManualClock` (deterministic, isolated
   * per-run replay). When provided, the single clock is shared (caller-owned time).
   */
  clock?: Clock;
  /**
   * Controlled writable execution profile (A10.3). When absent, the adapter is
   * read-only and refuses `readOnly:false` (A3 behaviour). When present, a
   * `readOnly:false` request is authorized ONLY if the observed real capability
   * snapshot, binding, version and worktree cwd all check out (see
   * {@link authorizeWritable}). The orchestrator constructs this from a REAL
   * `getCapabilities()` observation after the owner authenticates the CLI.
   */
  writableProfile?: WritableProfile;
}

/** Drain a probe process into combined stdout/stderr text + the terminal exit. */
async function collectProcess(
  running: RunningProcess
): Promise<{ stdout: string; stderr: string; exit: ProcessExit }> {
  let stdout = "";
  let stderr = "";
  for await (const line of running.output) {
    if (line.stream === "stdout") {
      stdout += `${line.line}\n`;
    } else {
      stderr += `${line.line}\n`;
    }
  }
  const exit = await running.exit;
  return { stdout, stderr, exit };
}

export abstract class RealAdapter implements ProviderAdapter {
  readonly provider: ProviderId;
  protected readonly runner: ProcessRunner;
  protected readonly config: RealAdapterConfig;
  private readonly options: RealAdapterOptions;
  private readonly probeClock: Clock;
  private readonly running = new Map<string, RunningProcess>();
  private readonly writableProfile?: WritableProfile;

  constructor(runner: ProcessRunner, config: RealAdapterConfig, options: RealAdapterOptions = {}) {
    this.runner = runner;
    this.config = config;
    this.options = options;
    this.provider = config.provider;
    this.probeClock = options.clock ?? new ManualClock();
    this.writableProfile = options.writableProfile;
  }

  async checkAvailability(): Promise<AvailabilityResult> {
    const running = this.runner.run(this.probeSpec(this.config.versionArgs));
    const { stdout, stderr, exit } = await collectProcess(running);
    const version = this.config.parseVersion(`${stdout}${stderr}`);
    const checkedAt = this.probeClock.iso();

    if (exit.reason === "spawn_error") {
      return {
        provider: this.provider,
        status: "unavailable",
        cliVersion: null,
        detail: "provider binary could not be started",
        checkedAt
      };
    }
    if (exit.reason === "exited" && exit.code === 0 && version !== null) {
      return { provider: this.provider, status: "available", cliVersion: version, detail: null, checkedAt };
    }
    return {
      provider: this.provider,
      status: "unknown",
      cliVersion: version,
      detail: "version probe did not confirm availability",
      checkedAt
    };
  }

  async checkAuthentication(): Promise<AuthenticationResult> {
    const running = this.runner.run(this.probeSpec(this.config.authProbeArgs));
    const { stdout, stderr, exit } = await collectProcess(running);
    const state = this.config.parseAuth(`${stdout}${stderr}`, exit);
    return { provider: this.provider, state, detail: null, checkedAt: this.probeClock.iso() };
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const running = this.runner.run(this.probeSpec(this.config.versionArgs));
    const { stdout, stderr, exit } = await collectProcess(running);
    const version =
      exit.reason === "spawn_error" ? null : this.config.parseVersion(`${stdout}${stderr}`);
    // Version-bound: only the recorded version yields the rich fixture; any drift
    // (or an undetectable version) invalidates it and degrades to all-unknown.
    const fields: CapabilityFields =
      version === this.config.knownVersion ? this.config.knownCapabilities : ALL_UNKNOWN;
    const snapshot: CapabilitySnapshot = {
      provider: this.provider,
      cliVersion: version,
      verifiedAt: this.probeClock.iso(),
      ...fields
    };
    return snapshot;
  }

  execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent> {
    // Boundary guard: refuse an unauthorized or argv-injection-shaped request BEFORE
    // building any argv or touching the runner (no spawn for a refused request). A
    // refusal is surfaced as a normalized run.started + run.failed stream so the
    // adapter stays conformant (exactly one terminal) and never throws.
    const refusal = this.refusalReason(request);
    if (refusal !== null) {
      return this.refusedStream(request, refusal.code, refusal.message);
    }
    // A writable run is only reachable here once refusalReason() authorized it, so the
    // writable argv builder is guaranteed present. Read-only stays the default path.
    const buildArgs =
      request.readOnly === false && this.config.buildWritableExecArgs !== undefined
        ? this.config.buildWritableExecArgs.bind(this.config)
        : this.config.buildExecArgs.bind(this.config);
    const spec: ProcessRunSpec = {
      bin: this.config.bin,
      args: buildArgs(request),
      cwd: request.cwd ?? ".",
      envAllowlist: unionAllowlist(this.config.defaultEnvAllowlist, request.environmentAllowlist),
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes ?? null
    };
    const running = this.runner.run(spec);
    this.running.set(request.executionId, running);
    // Per-execution clock: a fresh ManualClock unless a clock was injected.
    const clock = this.options.clock ?? new ManualClock();
    return this.streamAndCleanup(request, running, clock);
  }

  /**
   * Decide whether to REFUSE a request before execution, returning a normalized
   * failure reason or `null` to proceed. Two refusals, both security boundaries:
   *
   *  - #5 A3 is READ-ONLY: writable execution (`readOnly:false`) is out of scope and
   *    gated on A0.5 + the per-capability binding (A5; ADR 0034 §3, ADR 0032 §11).
   *    The adapter NEVER builds a writable argv; it refuses instead.
   *  - #1 Argv-injection boundary: a hyphen-leading objective or sanitized argument
   *    is flag-shaped and could override a read-only/sandbox flag under last-wins
   *    argv parsing. Hyphen-leading positional input is not a legitimate objective,
   *    so it is rejected (in addition to the `--` end-of-options marker in
   *    buildExecArgs — defense in depth).
   *
   * A refused precondition maps to the non-retriable `request_rejected` terminal
   * (added to the A1 taxonomy in contract 1.1.0, TD-2): a deliberate boundary
   * refusal, distinct from `provider_unavailable` (the CLI being unreachable), so
   * routing/governance can tell the two apart. The explicit message carries which
   * precondition failed.
   */
  private refusalReason(
    request: AgentExecutionRequest
  ): { code: ProviderError["code"]; message: string } | null {
    if (request.readOnly === false) {
      // A10.3: writable is refused UNLESS an observed real capability snapshot,
      // binding, matching version and worktree cwd authorize it. Without a writable
      // profile this always refuses (A3 behaviour preserved). No writable argv is ever
      // built for a refused request.
      const auth = authorizeWritable(
        this.writableProfile,
        {
          provider: this.provider,
          knownVersion: this.config.knownVersion,
          supportsWritable: this.config.buildWritableExecArgs !== undefined
        },
        request
      );
      if (!auth.authorized) {
        return { code: "request_rejected", message: auth.message };
      }
    }
    if (startsWithHyphen(request.objective)) {
      return {
        code: "request_rejected",
        message: "rejected objective: a flag-shaped (hyphen-leading) objective is not permitted"
      };
    }
    if (request.sanitizedArguments.some(startsWithHyphen)) {
      return {
        code: "request_rejected",
        message:
          "rejected argument: a flag-shaped (hyphen-leading) sanitized argument is not permitted"
      };
    }
    return null;
  }

  /**
   * Synthesize a normalized refusal stream: a leading `run.started` (reflecting the
   * authoritative `request.readOnly`) followed by exactly one `run.failed` terminal.
   * No runner is invoked and nothing is registered for cancellation.
   */
  private async *refusedStream(
    request: AgentExecutionRequest,
    errorCode: ProviderError["code"],
    message: string
  ): AsyncGenerator<ProviderEvent> {
    const clock = this.options.clock ?? new ManualClock();
    const schemaVersion = request.schemaVersion ?? PROVIDER_CONTRACT_SCHEMA_VERSION;
    let sequenceNumber = 0;
    const build = (type: ProviderEventType, payload: unknown): ProviderEvent => {
      clock.advance(DEFAULT_TICK_MS);
      const seq = sequenceNumber;
      sequenceNumber += 1;
      return {
        schemaVersion,
        executionId: request.executionId,
        provider: this.provider,
        sequenceNumber: seq,
        timestamp: clock.iso(),
        rawEvidenceRef: makeRealEvidenceRef(request.executionId, seq),
        type,
        payload
      } as ProviderEvent;
    };
    yield build("run.started", { readOnly: request.readOnly });
    yield build("run.failed", { errorCode, message, partial: false });
  }

  private async *streamAndCleanup(
    request: AgentExecutionRequest,
    running: RunningProcess,
    clock: Clock
  ): AsyncGenerator<ProviderEvent> {
    try {
      yield* normalizeProcess({ request, running, clock, mapper: this.config.mapper });
    } finally {
      this.running.delete(request.executionId);
    }
  }

  /** Delegate cancellation to the running process group. Idempotent; safe for unknown ids. */
  async cancel(executionId: string): Promise<void> {
    const running = this.running.get(executionId);
    if (running !== undefined) {
      await running.cancel();
    }
  }

  private probeSpec(args: string[]): ProcessRunSpec {
    return {
      bin: this.config.bin,
      args,
      cwd: ".",
      envAllowlist: this.config.defaultEnvAllowlist,
      // Probes are local, non-destructive and fast; give them a bounded budget.
      timeoutMs: 30_000,
      maxOutputBytes: 1_000_000
    };
  }
}

/**
 * Union the default and request env-name allowlists, then strip any credential-
 * shaped NAME (defense in depth, T-EXE-09): even if a caller asks to forward a
 * credential by name, it is dropped here AND again in `curateEnv`.
 */
function unionAllowlist(base: string[], extra: string[]): string[] {
  return Array.from(new Set([...base, ...extra])).filter((name) => !isCredentialEnvName(name));
}

/** A flag-shaped (hyphen-leading) string — never a legitimate objective/argument. */
function startsWithHyphen(value: string): boolean {
  return value.startsWith("-");
}

/**
 * A10-W.6 — base environment a provider CLI needs to LOCATE its config/auth and run
 * natively on Windows (the home/config-path + system vars). None of these are secrets
 * — the provider reads its OWN auth file (e.g. `%USERPROFILE%\.codex\auth.json`); we
 * never read it. Credential-shaped names (`*_API_KEY`, `*TOKEN`, …) are still ALWAYS
 * dropped by `createRestrictedEnvironment`/`curateEnv`, so a child runs on its
 * subscription OAuth, never a leaked API key. Harmless on POSIX (absent names are
 * simply not forwarded).
 */
export const WINDOWS_BASE_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "TEMP",
  "TMP",
  "ComSpec",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE"
];

/**
 * Validate an orchestrator-selected model name before it is passed as a SEPARATED
 * argv value (`-m <model>` / `--model <model>`). Must start with an alphanumeric and
 * contain only `[A-Za-z0-9._-]` — so it can never be a leading-hyphen flag and (being
 * one argv element) cannot inject a second flag. Returns null to fall back to the
 * CLI's configured default.
 */
export function safeModel(model: string | null | undefined): string | null {
  if (typeof model !== "string") {
    return null;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model) ? model : null;
}
