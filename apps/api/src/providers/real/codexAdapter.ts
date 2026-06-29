/**
 * Real read-only Codex CLI adapter (A3).
 *
 * Confines all Codex specifics to configuration: the `codex` binary, the version /
 * auth-probe / read-only headless `exec` argv, the version + auth parsers, the
 * Codex line mapper, and a version-bound capability fixture recorded against
 * codex 0.101.0 (OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20). All execution,
 * normalization and lifecycle logic is inherited from `RealAdapter`.
 *
 * Every Codex-specific argv/flag below is a dated, versioned assumption
 * (REQUIRES_VERIFICATION against the installed CLI in the manual live smoke). The
 * read-only invocation uses `--sandbox read-only`, the documented Codex read-only
 * sandbox flag (§20).
 */

import type { AgentExecutionRequest, AuthenticationState } from "@triforge/shared";
import { codexLineMapper } from "./codexNormalizer.js";
import { RealAdapter, type CapabilityFields, type RealAdapterConfig, type RealAdapterOptions } from "./realAdapter.js";
import type { ProcessExit, ProcessRunner } from "./processRunner.js";

const SEMVER = /(\d+\.\d+\.\d+[A-Za-z0-9.-]*)/;

/** Capability fixture for codex 0.101.0 (§20: flags observed via --help on 2026-06-28). */
const CODEX_CAPABILITIES_0_101_0: CapabilityFields = {
  headlessSupport: "yes", // `codex exec` observed
  structuredOutput: "yes", // `--output-schema` / `-o` observed
  eventStream: "yes", // `--json` (JSONL events) observed
  authProbe: "unknown", // login/logout subcommands observed; non-secret STATE probe unverified
  usageObservable: "unknown", // not observable via --help (REQUIRES_VERIFICATION)
  quotaObservable: "unknown", // not observable via --help (REQUIRES_VERIFICATION)
  readOnly: "yes", // `--sandbox read-only` observed
  write: "yes", // `--sandbox workspace-write` observed
  cancellation: "yes", // enforced by the adapter via the process group (no native flag)
  resume: "yes", // `exec resume` / `--last` observed
  unknownCapabilities: []
};

function parseCodexAuth(output: string, exit: ProcessExit): AuthenticationState {
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

export const CODEX_ADAPTER_CONFIG: RealAdapterConfig = {
  provider: "codex",
  bin: "codex",
  knownVersion: "0.101.0",
  versionArgs: ["--version"],
  // REQUIRES_VERIFICATION (ADR 0029): the non-secret auth-state probe command for
  // Codex. `login status` is an ASSUMPTION and MUST be confirmed NON-INTERACTIVE and
  // NON-SECRET against the installed CLI (the `login` verb could prompt) before any
  // wiring to NodeProcessRunner. It is reachable only via NodeProcessRunner / the
  // manual smoke (REAL_PROVIDER_ADAPTERS_SPEC §9) — never CI. Prefer a clearly
  // read-only status verb once verified.
  authProbeArgs: ["login", "status"],
  knownCapabilities: CODEX_CAPABILITIES_0_101_0,
  mapper: codexLineMapper,
  buildExecArgs(request: AgentExecutionRequest): string[] {
    // A3 is READ-ONLY only: `execute()` refuses `readOnly:false` upstream (writable
    // is A5-gated), so the sandbox is ALWAYS `read-only` here. The documented
    // writable flag `--sandbox workspace-write` is an A5-future spec note only
    // (REAL_PROVIDER_ADAPTERS_SPEC §7), never a runtime path.
    //
    // The `--` end-of-options marker forces everything after it to be positional, so
    // a flag-shaped objective/arg cannot override `--sandbox read-only` under
    // last-wins argv parsing (the adapter's hyphen-guard rejects such input before
    // we get here — defense in depth). REQUIRES_VERIFICATION that codex honors `--`.
    return [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--",
      ...request.sanitizedArguments,
      request.objective
    ];
  },
  parseVersion(output: string): string | null {
    const match = SEMVER.exec(output);
    return match ? match[1] : null;
  },
  parseAuth: parseCodexAuth,
  // Minimal allowlist for a headless probe/exec; the concrete runtime list is
  // repository-specific (CLI spec §12). Values are pulled from process.env only
  // inside NodeProcessRunner — never the full parent environment (T-EXE-09).
  defaultEnvAllowlist: ["PATH", "HOME"]
};

export class CodexAdapter extends RealAdapter {
  constructor(runner: ProcessRunner, options: RealAdapterOptions = {}) {
    super(runner, CODEX_ADAPTER_CONFIG, options);
  }
}
