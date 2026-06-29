/**
 * Writable-execution runtime — Autonomous Governance Decision (A5.8).
 */
export {
  buildGovernanceDecision,
  decideVerdict,
  verifyDecisionBinding,
  governanceSha256,
  GOVERNANCE_POLICY_VERSION,
  type GovernanceVerdict,
  type RepairTerminalState,
  type GovernanceInputs,
  type GovernanceRecord,
  type CurrentState,
  type BindingCheck
} from "./governanceGate.js";
