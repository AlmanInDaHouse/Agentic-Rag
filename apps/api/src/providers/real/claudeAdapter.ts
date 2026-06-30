/**
 * Real read-only Claude Code adapter (A3).
 *
 * Confines all Claude specifics to configuration: the `claude` binary, the version
 * / auth-probe / read-only headless `-p` argv, the version + auth parsers, the
 * Claude line mapper, and a version-bound capability snapshot OBSERVED against
 * claude 2.1.195 (A10-W.6 real-host probe; OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20). All execution,
 * normalization and lifecycle logic is inherited from `RealAdapter`.
 *
 * Every Claude-specific argv/flag below is a dated, versioned assumption
 * (REQUIRES_VERIFICATION against the installed CLI in the manual live smoke). The
 * read-only invocation uses `--permission-mode plan` (verified read-only on the real
 * host — no Write tool, no file change) plus the structured
 * `--output-format stream-json` event stream. It MUST NOT use `--bare`, which the
 * installed 2.1.195 `--help` confirms forces an API key and bypasses subscription
 * OAuth (§20 cross-cutting exclusion; ADR 0029).
 */

import type { AgentExecutionRequest, AuthenticationState } from "@triforge/shared";
import { claudeLineMapper } from "./claudeNormalizer.js";
import {
  RealAdapter,
  safeModel,
  WINDOWS_BASE_ENV_ALLOWLIST,
  type CapabilityFields,
  type RealAdapterConfig,
  type RealAdapterOptions
} from "./realAdapter.js";
import type { ProcessExit, ProcessRunner } from "./processRunner.js";

const SEMVER = /(\d+\.\d+\.\d+[A-Za-z0-9.-]*)/;

/**
 * Capability snapshot for claude 2.1.195 — OBSERVED on a real Windows host (A10-W.6
 * real-provider probe, 2026-06-30; subscription claude.ai Max OAuth, apiKeySource:none).
 * The A3 fixture left readOnly/write/usage/quota/authProbe `unknown`; the real probe
 * confirms them, which is what authorizes the writable profile (claude_windows_writable).
 */
const CLAUDE_CAPABILITIES_2_1_195: CapabilityFields = {
  headlessSupport: "yes", // `-p` ran headless (stdin closed) — observed
  structuredOutput: "yes", // `--output-format json` / `--json-schema` observed
  eventStream: "yes", // `--output-format stream-json` observed (system/assistant/user/result)
  authProbe: "yes", // `claude auth status` → loggedIn:true; init.apiKeySource:"none"
  usageObservable: "yes", // result.usage + assistant.usage observed (tokens, cost, turns)
  quotaObservable: "yes", // rate_limit_event observed (rate_limit_info: window/utilization/resetsAt)
  readOnly: "yes", // `--permission-mode plan` ran read-only (no Write tool, no file change)
  write: "yes", // `--permission-mode acceptEdits` wrote the target via the Write tool
  cancellation: "yes", // enforced by the Job Object (kill-on-close tree reap)
  resume: "yes", // `--resume` / `--session-id` / `--fork-session` observed
  unknownCapabilities: []
};

function parseClaudeAuth(output: string, exit: ProcessExit): AuthenticationState {
  if (exit.reason === "spawn_error") {
    return "unknown";
  }
  // `claude auth status` (2.1.195) prints a JSON object with a boolean `loggedIn`
  // (verified A10-W.6) — alongside account PII (email/orgId) we MUST NOT retain. Read
  // ONLY the state from the parsed JSON; the raw output is never stored or logged.
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      if (typeof parsed.loggedIn === "boolean") {
        return parsed.loggedIn ? "authenticated" : "required";
      }
    } catch {
      /* fall through to textual markers below */
    }
  }
  const text = output.toLowerCase();
  if (text.includes("expired")) {
    return "expired";
  }
  if (
    text.includes("not logged in") ||
    text.includes("login required") ||
    text.includes("unauthenticated") ||
    text.includes('"loggedin": false') ||
    text.includes('"loggedin":false')
  ) {
    return "required";
  }
  if (text.includes("logged in") || text.includes("authenticated") || text.includes('"loggedin": true') || text.includes('"loggedin":true')) {
    return "authenticated";
  }
  return "unknown";
}

export const CLAUDE_ADAPTER_CONFIG: RealAdapterConfig = {
  provider: "claude",
  bin: "claude",
  knownVersion: "2.1.195",
  versionArgs: ["--version"],
  // REQUIRES_VERIFICATION: a non-secret auth-state probe for Claude Code is an open
  // question (§23). This argv is an assumption; until verified, real output that
  // matches no known marker maps to "unknown".
  authProbeArgs: ["auth", "status"],
  knownCapabilities: CLAUDE_CAPABILITIES_2_1_195,
  mapper: claudeLineMapper,
  buildExecArgs(request: AgentExecutionRequest): string[] {
    // A3 is READ-ONLY only: `execute()` refuses `readOnly:false` upstream (writable
    // is A5-gated), so the permission mode is ALWAYS the read-only/plan preset here.
    // The documented writable preset `--permission-mode acceptEdits` is an A5-future
    // spec note only (REAL_PROVIDER_ADAPTERS_SPEC §7), never a runtime path. Never
    // `--bare` (would force an API key — §20 / ADR 0029).
    //
    // The `--` end-of-options marker forces everything after it to be positional, so
    // a flag-shaped objective/arg cannot override `--permission-mode plan` under
    // last-wins argv parsing (the adapter's hyphen-guard rejects such input before
    // we get here — defense in depth). REQUIRES_VERIFICATION that claude honors `--`.
    const model = safeModel(request.model);
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(model !== null ? ["--model", model] : []),
      "--permission-mode",
      "plan",
      "--",
      ...request.sanitizedArguments,
      request.objective
    ];
  },
  buildWritableExecArgs(request: AgentExecutionRequest): string[] {
    // A10.3 controlled writable path — reached ONLY after authorizeWritable() passes.
    // Uses the documented `--permission-mode acceptEdits` (§20); NEVER `--bare` (would
    // force an API key — §20 / ADR 0029). Same `--` marker + upstream hyphen-guard.
    // REQUIRES_VERIFICATION against the installed CLI (real snapshot, not the fixture).
    const model = safeModel(request.model);
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(model !== null ? ["--model", model] : []),
      "--permission-mode",
      "acceptEdits",
      "--",
      ...request.sanitizedArguments,
      request.objective
    ];
  },
  parseVersion(output: string): string | null {
    const match = SEMVER.exec(output);
    return match ? match[1] : null;
  },
  parseAuth: parseClaudeAuth,
  // A10-W.6: the Windows base env (home/config-path + system vars) the real claude CLI
  // needs to locate its claude.ai OAuth state and run, plus the optional config-dir
  // vars. Credential-shaped names are still dropped inside the runner (T-EXE-09), so
  // claude runs on its subscription OAuth (apiKeySource:none), never an API key.
  defaultEnvAllowlist: [...WINDOWS_BASE_ENV_ALLOWLIST, "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]
};

export class ClaudeAdapter extends RealAdapter {
  constructor(runner: ProcessRunner, options: RealAdapterOptions = {}) {
    super(runner, CLAUDE_ADAPTER_CONFIG, options);
  }
}
