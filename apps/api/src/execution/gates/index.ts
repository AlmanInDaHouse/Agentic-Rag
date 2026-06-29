/**
 * Writable-execution runtime — Quality Gate Runner (A5.6).
 */
export {
  QualityGateRunner,
  type GateSpec,
  type GateOutcome,
  type QualityGateRunResult,
  type QualityGateRunnerOptions
} from "./qualityGateRunner.js";

export { detectGateTampering, type GateTamperingReport } from "./gateTampering.js";
