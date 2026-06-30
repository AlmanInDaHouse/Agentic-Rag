/**
 * Real read-only Codex CLI adapter (A3).
 *
 * Confines all Codex specifics to configuration: the `codex` binary, the version /
 * auth-probe / read-only headless `exec` argv, the version + auth parsers, the
 * Codex line mapper, and a version-bound capability snapshot OBSERVED against
 * codex 0.142.4 (A10-W.6 real-host probe; OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20). All execution,
 * normalization and lifecycle logic is inherited from `RealAdapter`.
 *
 * Every Codex-specific argv/flag below is a dated, versioned assumption
 * (REQUIRES_VERIFICATION against the installed CLI in the manual live smoke). The
 * read-only invocation uses `--sandbox read-only`, the documented Codex read-only
 * sandbox flag (§20).
 */

import type { AgentExecutionRequest, AuthenticationState } from "@triforge/shared";
import { codexLineMapper } from "./codexNormalizer.js";
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
 * Capability snapshot for codex 0.142.4 — OBSERVED on a real Windows host (A10-W.6
 * real-provider probe, 2026-06-30; subscription ChatGPT auth, OPENAI_API_KEY stripped).
 * Upgraded from 0.101.0: that pin was a model/version dead-zone with the ChatGPT
 * account (only gpt-5.5 offered, but gpt-5.5 requires a newer CLI; gpt-5/gpt-5-codex
 * not offered on ChatGPT accounts). 0.142.4 runs gpt-5.5 read-only AND writable.
 */
const CODEX_CAPABILITIES_0_142_4: CapabilityFields = {
  headlessSupport: "yes", // `codex exec` ran headless (stdin closed) — observed
  structuredOutput: "yes", // `--output-schema` / `-o` observed
  eventStream: "yes", // `--json` JSONL stream observed (thread/turn/item.completed/turn.completed)
  authProbe: "yes", // `codex login status` → "Logged in using ChatGPT" (non-secret state)
  usageObservable: "yes", // turn.completed.usage observed (input/output/cached/reasoning tokens)
  quotaObservable: "unknown", // no quota/rate-limit signal emitted by codex in the probes
  readOnly: "yes", // `--sandbox read-only` honored (no file.changed; fixture unchanged)
  write: "yes", // `--sandbox workspace-write` wrote the target file (file_change observed)
  cancellation: "yes", // enforced by the Job Object (kill-on-close tree reap)
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
  knownVersion: "0.142.4",
  versionArgs: ["--version"],
  // REQUIRES_VERIFICATION (ADR 0029): the non-secret auth-state probe command for
  // Codex. `login status` is an ASSUMPTION and MUST be confirmed NON-INTERACTIVE and
  // NON-SECRET against the installed CLI (the `login` verb could prompt) before any
  // wiring to NodeProcessRunner. It is reachable only via NodeProcessRunner / the
  // manual smoke (REAL_PROVIDER_ADAPTERS_SPEC §9) — never CI. Prefer a clearly
  // read-only status verb once verified.
  authProbeArgs: ["login", "status"],
  knownCapabilities: CODEX_CAPABILITIES_0_142_4,
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
    const model = safeModel(request.model);
    return [
      "exec",
      "--json",
      ...(model !== null ? ["-m", model] : []),
      "--sandbox",
      "read-only",
      "--",
      ...request.sanitizedArguments,
      request.objective
    ];
  },
  buildWritableExecArgs(request: AgentExecutionRequest): string[] {
    // A10.3 controlled writable path — reached ONLY after authorizeWritable() passes
    // (observed write capability + binding + version + worktree cwd). Uses the
    // documented `--sandbox workspace-write` (§20). Same `--` end-of-options marker +
    // upstream hyphen-guard so a flag-shaped objective cannot widen the sandbox.
    // REQUIRES_VERIFICATION against the installed CLI (real snapshot, not the fixture).
    const model = safeModel(request.model);
    return [
      "exec",
      "--json",
      ...(model !== null ? ["-m", model] : []),
      "--sandbox",
      "workspace-write",
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
  // A10-W.6: the Windows base env (home/config-path + system vars) the real codex CLI
  // needs to locate %USERPROFILE%\.codex\auth.json and run, plus CODEX_HOME if the
  // owner set a custom config dir. Credential-shaped names are still dropped inside the
  // runner (T-EXE-09), so codex runs on its ChatGPT subscription, never a leaked key.
  defaultEnvAllowlist: [...WINDOWS_BASE_ENV_ALLOWLIST, "CODEX_HOME"]
};

export class CodexAdapter extends RealAdapter {
  constructor(runner: ProcessRunner, options: RealAdapterOptions = {}) {
    super(runner, CODEX_ADAPTER_CONFIG, options);
  }
}
