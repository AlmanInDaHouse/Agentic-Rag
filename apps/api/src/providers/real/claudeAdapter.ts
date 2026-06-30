/**
 * Real read-only Claude Code adapter (A3).
 *
 * Confines all Claude specifics to configuration: the `claude` binary, the version
 * / auth-probe / read-only headless `-p` argv, the version + auth parsers, the
 * Claude line mapper, and a version-bound capability fixture recorded against
 * claude 2.1.195 (OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20). All execution,
 * normalization and lifecycle logic is inherited from `RealAdapter`.
 *
 * Every Claude-specific argv/flag below is a dated, versioned assumption
 * (REQUIRES_VERIFICATION against the installed CLI in the manual live smoke). The
 * read-only invocation uses `--permission-mode plan` (the assumed read-only/plan
 * preset; the exact preset is unverified, §20) plus the structured
 * `--output-format stream-json` event stream. It MUST NOT use `--bare`, which the
 * installed 2.1.195 `--help` confirms forces an API key and bypasses subscription
 * OAuth (§20 cross-cutting exclusion; ADR 0029).
 */

import type { AgentExecutionRequest, AuthenticationState } from "@triforge/shared";
import { claudeLineMapper } from "./claudeNormalizer.js";
import { RealAdapter, type CapabilityFields, type RealAdapterConfig, type RealAdapterOptions } from "./realAdapter.js";
import type { ProcessExit, ProcessRunner } from "./processRunner.js";

const SEMVER = /(\d+\.\d+\.\d+[A-Za-z0-9.-]*)/;

/** Capability fixture for claude 2.1.195 (§20: flags observed via --help on 2026-06-28). */
const CLAUDE_CAPABILITIES_2_1_195: CapabilityFields = {
  headlessSupport: "yes", // `-p` / `--print` observed
  structuredOutput: "yes", // `--output-format json` observed
  eventStream: "yes", // `--output-format stream-json` observed
  authProbe: "unknown", // no confirmed non-secret auth-state probe (open question §23)
  usageObservable: "unknown", // result/stream usage payload unverified (REQUIRES_VERIFICATION)
  quotaObservable: "unknown", // not observable via --help (REQUIRES_VERIFICATION)
  readOnly: "unknown", // --permission-mode observed; exact read-only preset unverified (§20)
  write: "unknown", // write-limited flags observed; exact preset unverified (§20)
  cancellation: "yes", // enforced by the adapter via the process group (no native flag)
  resume: "yes", // `--resume` / `--session-id` / `--fork-session` observed
  unknownCapabilities: []
};

function parseClaudeAuth(output: string, exit: ProcessExit): AuthenticationState {
  if (exit.reason === "spawn_error") {
    return "unknown";
  }
  const text = output.toLowerCase();
  if (text.includes("expired")) {
    return "expired";
  }
  if (text.includes("not logged in") || text.includes("login required") || text.includes("unauthenticated")) {
    return "required";
  }
  if (text.includes("logged in") || text.includes("authenticated")) {
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
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
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
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
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
  defaultEnvAllowlist: ["PATH", "HOME"]
};

export class ClaudeAdapter extends RealAdapter {
  constructor(runner: ProcessRunner, options: RealAdapterOptions = {}) {
    super(runner, CLAUDE_ADAPTER_CONFIG, options);
  }
}
