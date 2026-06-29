/**
 * Mock provider framework (A2.1) — public surface.
 *
 * Deterministic test/dev provider doubles that implement the A1 `ProviderAdapter`
 * contracts. No real CLIs, no network, no credentials, no writes. The runtime
 * stays mock-only and is not wired to execute these. See
 * docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md.
 */

export { ManualClock, DEFAULT_CLOCK_EPOCH_MS, type Clock } from "../clock.js";
export {
  runScenario,
  deriveProviderResult,
  makeEvidenceRef,
  payloadByteLength,
  DEFAULT_TICK_MS,
  type ScenarioStep,
  type EmitStep,
  type DelayStep,
  type CancelStep,
  type ScenarioDefinition,
  type ScenarioProbe,
  type ScenarioConformance,
  type CancelState,
  type CapabilityFlag,
  type EngineContext
} from "./scenarioEngine.js";
export {
  createScenarioCatalog,
  SCENARIO_IDS,
  CONFORMANT_SCENARIO_IDS,
  VIOLATING_SCENARIO_IDS,
  FAKE_AWS_ACCESS_KEY,
  OVERSIZED_TEXT,
  type ScenarioId
} from "./scenarios.js";
export {
  BaseMockAdapter,
  MockCodexAdapter,
  MockClaudeAdapter,
  type MockAdapterOptions
} from "./mockAdapter.js";
