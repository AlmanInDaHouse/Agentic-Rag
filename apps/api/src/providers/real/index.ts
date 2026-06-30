/**
 * Real read-only provider adapters (A3) — public surface.
 *
 * Real Codex/Claude adapters that implement the A1 `ProviderAdapter` contract over
 * an injectable `ProcessRunner` and a per-provider output normalizer. They are
 * read-only and are NOT wired into the running server (the runtime stays mock-only
 * until a later milestone). In CI/tests they are driven exclusively by
 * `FakeProcessRunner`; `NodeProcessRunner` (the only `child_process` site) is
 * production-only and exercised solely by the manual live smoke.
 *
 * See docs/specs/REAL_PROVIDER_ADAPTERS_SPEC.md and ADR 0034.
 */

export {
  type ProcessRunner,
  type ProcessRunSpec,
  type RunningProcess,
  type ProcessOutputLine,
  type ProcessStream,
  type ProcessExit,
  type ProcessTerminationReason,
  type FakeProcessScript,
  type FakeScriptSource,
  FakeProcessRunner,
  NodeProcessRunner,
  curateEnv,
  isCredentialEnvName
} from "./processRunner.js";

export {
  normalizeProcess,
  makeRealEvidenceRef,
  DEFAULT_TICK_MS,
  type ProviderLineMapper,
  type MappedLine,
  type NormalizedEvent,
  type MappableEventType,
  type NormalizeArgs
} from "./normalizerCore.js";

export { codexLineMapper } from "./codexNormalizer.js";
export { claudeLineMapper } from "./claudeNormalizer.js";

export {
  RealAdapter,
  safeModel,
  WINDOWS_BASE_ENV_ALLOWLIST,
  type RealAdapterConfig,
  type RealAdapterOptions,
  type CapabilityFields
} from "./realAdapter.js";
export { CodexAdapter, CODEX_ADAPTER_CONFIG } from "./codexAdapter.js";
export { ClaudeAdapter, CLAUDE_ADAPTER_CONFIG } from "./claudeAdapter.js";

// A10-W.6 — native Windows real-launch wiring (Job Object + safe exe resolution).
export { PlatformProcessRunner } from "./platformProcessRunner.js";
export {
  resolveProviderLauncher,
  type ResolvedLauncher,
  type LauncherResolverDeps
} from "./windowsLauncher.js";
export { createRealAdapter, type RealAdapterFactoryOptions } from "./realAdapterFactory.js";

export {
  authorizeWritable,
  type WritableProfile,
  type WritableAuthorization,
  type WritableContext
} from "./writableProfile.js";
