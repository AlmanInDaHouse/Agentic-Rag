/**
 * Real read-only adapter tests (A3) — CI-safe, deterministic, FAKE runner only.
 *
 * Drives `CodexAdapter` and `ClaudeAdapter` with a `FakeProcessRunner` that replays
 * synthetic fixtures of the documented CLI output, and validates BOTH through the
 * UNCHANGED A2.2 conformance harness (`runConformanceCheck`). No real CLI is
 * spawned, no credential is read, no network or filesystem is touched. CI runs on
 * ubuntu with neither Codex nor Claude installed/authed — only the fake is ever used.
 */

import { describe, expect, it } from "vitest";
import {
  AgentExecutionRequestSchema,
  AuthenticationResultSchema,
  AvailabilityResultSchema,
  CapabilitySnapshotSchema,
  isTerminalEvent,
  type AgentExecutionRequest,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import {
  ConformanceInvariant,
  findInvariant,
  runConformanceCheck,
  type ConformanceReport
} from "../providers/harness/index.js";
import {
  CodexAdapter,
  ClaudeAdapter,
  curateEnv,
  isCredentialEnvName,
  type RealAdapterOptions
} from "../providers/real/index.js";
import {
  authAuthenticatedScript,
  authExpiredScript,
  authRequiredScript,
  claudeParseErrorScript,
  claudeRateLimitedScript,
  claudeSuccessScript,
  claudeTimeoutScript,
  claudeToolUseScript,
  claudeUnknownKindScript,
  claudeVersionScript,
  codexParseErrorScript,
  codexRateLimitedScript,
  codexSuccessScript,
  codexTimeoutScript,
  codexToolUseScript,
  codexUnknownKindScript,
  codexVersionDriftScript,
  codexVersionScript,
  codexWritableFileChangeScript,
  makeFixtureRunner,
  notInstalledScript,
  type FixtureRunnerScripts
} from "./fixtures/realProviderFixtures.js";

// --- helpers -------------------------------------------------------------

/** A real-clock liveness budget so a wedged stream is caught (A3 runs MUST set it). */
const LIVENESS_MS = 2_000;

function makeRequest(
  executionId: string,
  provider: ProviderId,
  overrides: Record<string, unknown> = {}
): AgentExecutionRequest {
  return AgentExecutionRequestSchema.parse({
    executionId,
    provider,
    objective: "review the auth module",
    timeoutMs: 3_600_000,
    ...overrides
  });
}

function codexAdapter(scripts: FixtureRunnerScripts, options?: RealAdapterOptions): CodexAdapter {
  return new CodexAdapter(makeFixtureRunner(scripts), options);
}
function claudeAdapter(scripts: FixtureRunnerScripts, options?: RealAdapterOptions): ClaudeAdapter {
  return new ClaudeAdapter(makeFixtureRunner(scripts), options);
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function failed(report: ConformanceReport): string[] {
  return report.invariants.filter((i) => i.status === "fail").map((i) => `${i.id}: ${i.detail}`);
}

interface AdapterCase {
  provider: ProviderId;
  build(scripts: FixtureRunnerScripts, options?: RealAdapterOptions): ProviderAdapter;
  version: typeof codexVersionScript;
  success: typeof codexSuccessScript;
  toolUse: typeof codexSuccessScript;
  unknownKind: typeof codexSuccessScript;
  parseError: typeof codexSuccessScript;
  rateLimited: typeof codexSuccessScript;
  timeout: typeof codexSuccessScript;
  knownVersion: string;
}

const CASES: AdapterCase[] = [
  {
    provider: "codex",
    build: codexAdapter,
    version: codexVersionScript,
    success: codexSuccessScript,
    toolUse: codexToolUseScript,
    unknownKind: codexUnknownKindScript,
    parseError: codexParseErrorScript,
    rateLimited: codexRateLimitedScript,
    timeout: codexTimeoutScript,
    knownVersion: "0.101.0"
  },
  {
    provider: "claude",
    build: claudeAdapter,
    version: claudeVersionScript,
    success: claudeSuccessScript,
    toolUse: claudeToolUseScript,
    unknownKind: claudeUnknownKindScript,
    parseError: claudeParseErrorScript,
    rateLimited: claudeRateLimitedScript,
    timeout: claudeTimeoutScript,
    knownVersion: "2.1.195"
  }
];

// --- A2.2 harness: both real adapters conform UNCHANGED ------------------

describe("real adapters — A2.2 conformance with a fake runner", () => {
  for (const c of CASES) {
    it(`${c.provider}: success fixture passes every invariant (normal mode)`, async () => {
      const adapter = c.build({ version: c.version, exec: c.success });
      const report = await runConformanceCheck(adapter, makeRequest(`ok-${c.provider}`, c.provider), {
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      expect(report.provider).toBe(c.provider);
      expect(report.result?.status).toBe("completed");
      // ADAPTER_LIVENESS is actually exercised (not skipped) on the real path.
      expect(findInvariant(report, ConformanceInvariant.ADAPTER_LIVENESS)?.status).toBe("pass");
    });

    it(`${c.provider}: tool-use fixture conforms`, async () => {
      const adapter = c.build({ version: c.version, exec: c.toolUse });
      const report = await runConformanceCheck(adapter, makeRequest(`tool-${c.provider}`, c.provider), {
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
    });

    it(`${c.provider}: unknown raw kind conforms (warning, not a crash)`, async () => {
      const adapter = c.build({ version: c.version, exec: c.unknownKind });
      const report = await runConformanceCheck(adapter, makeRequest(`unk-${c.provider}`, c.provider), {
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      expect(report.events.some((e) => e.type === "warning.raised")).toBe(true);
      expect(report.result?.status).toBe("completed");
    });

    it(`${c.provider}: malformed line conforms (parse error → warning)`, async () => {
      const adapter = c.build({ version: c.version, exec: c.parseError });
      const report = await runConformanceCheck(adapter, makeRequest(`parse-${c.provider}`, c.provider), {
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      const warn = report.events.find((e) => e.type === "warning.raised");
      expect((warn?.payload as { code?: string } | undefined)?.code).toBe("provider_parse_error");
    });

    it(`${c.provider}: cancellation yields a single cancelled terminal`, async () => {
      const adapter = c.build({ version: c.version, exec: c.success });
      const report = await runConformanceCheck(adapter, makeRequest(`cancel-${c.provider}`, c.provider), {
        mode: "cancellation",
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      expect(report.result?.status).toBe("cancelled");
    });

    it(`${c.provider}: timeout yields a single timeout terminal`, async () => {
      const adapter = c.build({ version: c.version, exec: c.timeout });
      const report = await runConformanceCheck(adapter, makeRequest(`timeout-${c.provider}`, c.provider), {
        mode: "timeout",
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      const terminal = report.events[report.events.length - 1];
      expect(terminal.type).toBe("run.failed");
      expect((terminal.payload as { errorCode: string }).errorCode).toBe("timeout");
    });

    it(`${c.provider}: rate-limited fixture conforms and normalizes the error code`, async () => {
      const adapter = c.build({ version: c.version, exec: c.rateLimited });
      const report = await runConformanceCheck(adapter, makeRequest(`rl-${c.provider}`, c.provider), {
        livenessTimeoutMs: LIVENESS_MS
      });
      expect(report.ok, failed(report).join(" | ")).toBe(true);
      expect(report.result?.status).toBe("failed");
      expect(report.result?.error?.code).toBe("rate_limited");
    });
  }
});

// --- probes: availability / version / auth / capability ------------------

describe("real adapters — availability + version", () => {
  for (const c of CASES) {
    it(`${c.provider}: reports available with the detected version`, async () => {
      const adapter = c.build({ version: c.version });
      const result = await adapter.checkAvailability();
      expect(AvailabilityResultSchema.safeParse(result).success).toBe(true);
      expect(result.status).toBe("available");
      expect(result.cliVersion).toBe(c.knownVersion);
    });

    it(`${c.provider}: reports unavailable when the binary is not installed`, async () => {
      const adapter = c.build({ version: notInstalledScript });
      const result = await adapter.checkAvailability();
      expect(result.status).toBe("unavailable");
      expect(result.cliVersion).toBeNull();
    });
  }
});

describe("real adapters — authentication probe (non-secret)", () => {
  for (const c of CASES) {
    it(`${c.provider}: maps authenticated / required / expired probe output`, async () => {
      const authed = await c.build({ version: c.version, auth: authAuthenticatedScript }).checkAuthentication();
      const required = await c.build({ version: c.version, auth: authRequiredScript }).checkAuthentication();
      const expired = await c.build({ version: c.version, auth: authExpiredScript }).checkAuthentication();
      expect(AuthenticationResultSchema.safeParse(authed).success).toBe(true);
      expect(authed.state).toBe("authenticated");
      expect(required.state).toBe("required");
      expect(expired.state).toBe("expired");
    });
  }
});

describe("real adapters — version-bound capability snapshot", () => {
  it("codex: known version yields the recorded read-only fixture", async () => {
    const caps = await codexAdapter({ version: codexVersionScript }).getCapabilities();
    expect(CapabilitySnapshotSchema.safeParse(caps).success).toBe(true);
    expect(caps.cliVersion).toBe("0.101.0");
    expect(caps.headlessSupport).toBe("yes");
    expect(caps.eventStream).toBe("yes");
    expect(caps.readOnly).toBe("yes");
    // Unobservable signals stay "unknown" (never fabricated to "yes").
    expect(caps.usageObservable).toBe("unknown");
    expect(caps.quotaObservable).toBe("unknown");
    expect(caps.authProbe).toBe("unknown");
  });

  it("claude: known version keeps the read-only preset unknown (unverified §20)", async () => {
    const caps = await claudeAdapter({ version: claudeVersionScript }).getCapabilities();
    expect(caps.cliVersion).toBe("2.1.195");
    expect(caps.headlessSupport).toBe("yes");
    expect(caps.eventStream).toBe("yes");
    expect(caps.readOnly).toBe("unknown");
  });

  it("a drifted version invalidates the snapshot (all tri-state caps unknown)", async () => {
    const caps = await codexAdapter({ version: codexVersionDriftScript }).getCapabilities();
    expect(caps.cliVersion).toBe("0.200.0");
    expect(caps.headlessSupport).toBe("unknown");
    expect(caps.eventStream).toBe("unknown");
    expect(caps.readOnly).toBe("unknown");
  });
});

// --- read-only enforcement at the adapter boundary -----------------------

describe("real adapters — read-only execute", () => {
  it("a read-only run emits no file.changed event", async () => {
    for (const c of CASES) {
      const events = await collect(
        c
          .build({ version: c.version, exec: c.success })
          .execute(makeRequest(`ro-${c.provider}`, c.provider, { readOnly: true }))
      );
      expect(events.some((e) => e.type === "file.changed")).toBe(false);
      expect(isTerminalEvent(events[events.length - 1])).toBe(true);
    }
  });

  it("a read-only run that emits file.changed FAILS the harness NO_WRITE_UNDER_READ_ONLY (T-INT-14)", async () => {
    // Proves the runtime read-only contract is harness-detectable for the REAL
    // adapter (not only the mock): a provider that writes under request.readOnly:true
    // trips the invariant whose authority is request.readOnly.
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexWritableFileChangeScript });
    const adapter = new CodexAdapter(runner);
    const report = await runConformanceCheck(
      adapter,
      makeRequest("ro-write-codex", "codex", { readOnly: true }),
      { livenessTimeoutMs: LIVENESS_MS }
    );
    expect(report.ok).toBe(false);
    expect(findInvariant(report, ConformanceInvariant.NO_WRITE_UNDER_READ_ONLY)?.status).toBe("fail");
    // The write was actually surfaced (the fixture really emitted file.changed).
    expect(report.events.some((e) => e.type === "file.changed")).toBe(true);
    // No real CLI was spawned to detect it.
    expect(runner.calls.some((spec) => spec.args.includes("exec"))).toBe(true);
  });

  it("REFUSES a writable run (readOnly:false): writable execution is A5-gated, not a writable argv", async () => {
    for (const c of CASES) {
      const runner = makeFixtureRunner({ version: c.version, exec: c.success });
      const adapter = c.provider === "codex" ? new CodexAdapter(runner) : new ClaudeAdapter(runner);
      const events = await collect(
        adapter.execute(makeRequest(`refuse-write-${c.provider}`, c.provider, { readOnly: false }))
      );
      // Exactly one terminal, and it is a refusal — never a writable run.
      const terminal = events[events.length - 1];
      expect(terminal.type).toBe("run.failed");
      const payload = terminal.payload as { errorCode: string; message: string };
      // A deliberate boundary refusal, not an availability failure (TD-2, 1.1.0).
      expect(payload.errorCode).toBe("request_rejected");
      expect(payload.message).toMatch(/not authorized until A5|A0\.5 capability binding/);
      expect(events.filter((e) => isTerminalEvent(e))).toHaveLength(1);
      // No process was spawned at all: the refusal never reached the runner, so no
      // exec (and crucially no writable argv) was ever built.
      expect(runner.calls).toHaveLength(0);
      const allArgs = runner.calls.flatMap((spec) => spec.args).join(" ");
      expect(allArgs).not.toContain("workspace-write");
      expect(allArgs).not.toContain("acceptEdits");
    }
  });

  it("REFUSES a flag-shaped objective (argv-injection guard); read-only flag cannot be overridden", async () => {
    for (const c of CASES) {
      const adapter = c.build({ version: c.version, exec: c.success });
      const events = await collect(
        adapter.execute(
          makeRequest(`refuse-obj-${c.provider}`, c.provider, {
            objective: "--sandbox workspace-write"
          })
        )
      );
      const terminal = events[events.length - 1];
      expect(terminal.type).toBe("run.failed");
      expect((terminal.payload as { errorCode: string }).errorCode).toBe("request_rejected");
      expect((terminal.payload as { message: string }).message).toMatch(/flag-shaped|hyphen-leading/);
      expect(events.some((e) => e.type === "file.changed")).toBe(false);
    }
  });

  it("REFUSES a flag-shaped sanitized argument (argv-injection guard)", async () => {
    const adapter = claudeAdapter({ version: claudeVersionScript, exec: claudeSuccessScript });
    const events = await collect(
      adapter.execute(
        makeRequest("refuse-arg-claude", "claude", {
          sanitizedArguments: ["--permission-mode", "acceptEdits"]
        })
      )
    );
    const terminal = events[events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("request_rejected");
    expect((terminal.payload as { message: string }).message).toMatch(/flag-shaped|hyphen-leading/);
  });

  it("codex: build read-only execute argv with the documented sandbox flag + end-of-options marker", async () => {
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexSuccessScript });
    const adapter = new CodexAdapter(runner);
    await collect(adapter.execute(makeRequest("argv-codex", "codex", { readOnly: true })));
    const execCall = runner.calls.find((spec) => spec.args.includes("exec"));
    expect(execCall?.args).toContain("--json");
    expect(execCall?.args.join(" ")).toContain("--sandbox read-only");
    // `--` marker precedes the objective so it is positional, never a flag.
    expect(execCall?.args).toContain("--");
    expect(execCall!.args.indexOf("--")).toBeLessThan(execCall!.args.indexOf("review the auth module"));
  });

  it("claude: read-only execute uses plan permission-mode, an end-of-options marker, and never --bare", async () => {
    const runner = makeFixtureRunner({ version: claudeVersionScript, exec: claudeSuccessScript });
    const adapter = new ClaudeAdapter(runner);
    await collect(adapter.execute(makeRequest("argv-claude", "claude", { readOnly: true })));
    const execCall = runner.calls.find((spec) => spec.args.includes("-p"));
    expect(execCall?.args.join(" ")).toContain("--output-format stream-json");
    expect(execCall?.args.join(" ")).toContain("--permission-mode plan");
    expect(execCall?.args).toContain("--");
    expect(execCall!.args.indexOf("--")).toBeLessThan(execCall!.args.indexOf("review the auth module"));
    expect(execCall?.args).not.toContain("--bare");
  });
});

// --- determinism + adapter interface -------------------------------------

describe("real adapters — contract surface + determinism", () => {
  it("both adapters satisfy the ProviderAdapter interface", () => {
    const codex: ProviderAdapter = codexAdapter({ version: codexVersionScript, exec: codexSuccessScript });
    const claude: ProviderAdapter = claudeAdapter({ version: claudeVersionScript, exec: claudeSuccessScript });
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

  it("a reused adapter replays each execution from the frozen epoch", async () => {
    const adapter = codexAdapter({ version: codexVersionScript, exec: codexSuccessScript });
    const first = await collect(adapter.execute(makeRequest("reuse", "codex")));
    const second = await collect(adapter.execute(makeRequest("reuse", "codex")));
    expect(second).toEqual(first);
    expect(second[0].timestamp).toBe(first[0].timestamp);
  });

  it("cancel() is idempotent and safe for an unknown execution", async () => {
    const adapter = codexAdapter({ version: codexVersionScript, exec: codexSuccessScript });
    await expect(adapter.cancel("does-not-exist")).resolves.toBeUndefined();
    await expect(adapter.cancel("does-not-exist")).resolves.toBeUndefined();
  });
});

// --- env credential denylist (defense in depth, T-EXE-09) ----------------

describe("real adapters — env credential denylist", () => {
  it("a credential-named env var on the request allowlist never reaches the child spec (union logic)", async () => {
    const runner = makeFixtureRunner({ version: codexVersionScript, exec: codexSuccessScript });
    const adapter = new CodexAdapter(runner);
    await collect(
      adapter.execute(
        makeRequest("env-codex", "codex", {
          environmentAllowlist: [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "MY_GITHUB_PAT",
            "DB_PASSWORD",
            "MY_SAFE_VAR"
          ]
        })
      )
    );
    const execCall = runner.calls.find((spec) => spec.args.includes("exec"));
    const allow = execCall?.envAllowlist ?? [];
    // Benign names survive (incl. the defaults).
    expect(allow).toContain("MY_SAFE_VAR");
    expect(allow).toContain("PATH");
    // Every credential-shaped name is stripped.
    for (const denied of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "MY_GITHUB_PAT",
      "DB_PASSWORD"
    ]) {
      expect(allow).not.toContain(denied);
    }
  });

  it("curateEnv drops a credential-named var even when it is on the allowlist and set in process.env", () => {
    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      TF_SAFE_VAR: process.env.TF_SAFE_VAR
    };
    try {
      process.env.OPENAI_API_KEY = "sk-should-never-forward";
      process.env.GITHUB_TOKEN = "ghp-should-never-forward";
      process.env.TF_SAFE_VAR = "safe-value";
      const env = curateEnv(["OPENAI_API_KEY", "GITHUB_TOKEN", "TF_SAFE_VAR"]);
      expect(env.TF_SAFE_VAR).toBe("safe-value");
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("isCredentialEnvName matches credential patterns case-insensitively but spares benign names", () => {
    for (const name of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_ADMIN_KEY",
      "MY_API_KEY",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "aws_secret_access_key",
      "AWS_SESSION_TOKEN",
      "SOME_SECRET",
      "DB_PASSWORD",
      "MY_GITHUB_PAT"
    ]) {
      expect(isCredentialEnvName(name)).toBe(true);
    }
    for (const name of ["PATH", "HOME", "LANG", "MY_SAFE_VAR"]) {
      expect(isCredentialEnvName(name)).toBe(false);
    }
  });
});
