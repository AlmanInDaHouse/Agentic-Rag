/**
 * Adapter conformance harness (A2.2) — public surface.
 *
 * A reusable, black-box harness that validates ANY `ProviderAdapter` against the
 * A1 contract using only the public interface (`execute()` + `cancel()`) and the
 * emitted event stream. It depends on no mock internals and never calls the
 * mock-only `getResult()`; the terminal result is derived from the stream via the
 * provider-agnostic `deriveProviderResult`. The A3 real read-only Codex/Claude
 * adapters are validated by this same harness UNCHANGED.
 *
 * See docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md §12.
 */

export {
  runConformanceCheck,
  findInvariant,
  type HarnessMode,
  type InvariantStatus,
  type InvariantResult,
  type ConformanceOptions,
  type ConformanceReport
} from "./adapterHarness.js";
export {
  ConformanceInvariant,
  INVARIANT_TITLES,
  ALL_INVARIANT_IDS,
  type ConformanceInvariantId
} from "./invariants.js";
export {
  scanEventsForSecrets,
  shannonEntropy,
  type SecretFinding,
  type SecretSeverity
} from "./secretScan.js";
