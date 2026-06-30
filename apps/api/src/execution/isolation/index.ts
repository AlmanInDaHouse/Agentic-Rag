/**
 * Writable-execution runtime — Real Isolation Boundary (A10.2). See ADR 0055.
 */
export {
  ISOLATION_INVARIANTS,
  WSL2_IS_NOT_A_SANDBOX,
  PROVIDER_ENV_ALLOWLIST,
  SENSITIVE_HOST_PATH_SEGMENTS,
  DEFAULT_ISOLATION_LIMITS,
  buildProviderEnv,
  findEnvLeaks,
  scanGitFilterDrivers,
  gitFilterNeutralizationFlags,
  cwdWithinWorktree,
  type IsolationInvariantId,
  type IsolationLimits
} from "./isolationBoundary.js";
