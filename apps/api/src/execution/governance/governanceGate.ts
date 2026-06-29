/**
 * Autonomous Governance Decision (A5.8) — the replacement for the old human commit
 * gate (ADR 0031). It computes a merge verdict from RE-DERIVED evidence, never from a
 * provider's narrative (ADR 0032; threat-model T-INT-01/02/04/10/11), and binds the
 * decision to the exact diff / ledger / gate state so it cannot be replayed or applied
 * to a changed diff.
 *
 * Hard merge preconditions (ALL required for `merge`):
 *  - the repair loop terminated `accepted` (A5.7);
 *  - quality gates `passed` (A5.6, real exit codes — not a claim);
 *  - the mutation ledger reconciles against the real worktree (A5.5, not tampered);
 *  - no gate-tampering (deleted tests / weakened CI);
 *  - no open blocker/critical finding;
 *  - the gates were run against THIS diff (`gateTestedDiffHash === diffHash`).
 * Any failure downgrades the verdict to `block`/`reject`; a `merge` is never
 * self-asserted. Human override remains available but is not required.
 */

import { createHash } from "node:crypto";
import {
  GovernanceDecisionSchema,
  type CapabilityBinding,
  type FindingsSummary,
  type GovernanceDecision,
  type MergeDecision,
  type ProviderId,
  type ProviderQuota,
  type TestSummary
} from "@triforge/shared";

export const GOVERNANCE_POLICY_VERSION = "a5.8-governance-1.0.0";

export type GovernanceVerdict = "merge" | "reject" | "repair" | "block" | "cancel";

export type RepairTerminalState =
  | "accepted"
  | "rejected"
  | "blocked"
  | "exhausted"
  | "cancelled"
  | "failed";

export interface GovernanceInputs {
  task: string;
  specHash: string;
  acceptanceCriteria: string[];
  contextHash: string;
  owner: ProviderId;
  reviewer: ProviderId;
  worktree: string;
  branch: string;
  /** The diff hash under decision (A5.5). */
  diffHash: string;
  /** The mutation ledger head hash (A5.5). */
  ledgerHeadHash: string;
  /** Whether the ledger reconciled against the real worktree (A5.5). */
  ledgerTampered: boolean;
  /** Whether gate-tampering (deleted tests / weakened CI) was detected (A5.6). */
  gateTampered: boolean;
  /** Overall quality-gate status (A5.6). */
  gatesPassed: boolean;
  /** The diff hash the gates were actually run against (A5.6). */
  gateTestedDiffHash: string;
  /** A hash of the quality-gate result (A5.6) — binds the decision to that result. */
  gateResultHash: string;
  findings: FindingsSummary;
  tests: TestSummary;
  repairState: RepairTerminalState;
  repairRounds: number;
  quota: ProviderQuota | null;
  unresolvedRisks: string[];
  capabilityBinding: CapabilityBinding;
}

export interface GovernanceRecord {
  verdict: GovernanceVerdict;
  rationale: string;
  policyVersion: string;
  /** The exact state the decision is bound to (replay / post-change protection). */
  binding: {
    diffHash: string;
    ledgerHeadHash: string;
    gateResultHash: string;
  };
  inputs: GovernanceInputs;
  /** The A1 GovernanceDecision artifact (validated against the shared schema). */
  artifact: GovernanceDecision;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Decide the verdict from re-derived evidence using hard, non-overridable rules. */
export function decideVerdict(inputs: GovernanceInputs): { verdict: GovernanceVerdict; rationale: string } {
  // Terminal states that are never a merge.
  if (inputs.repairState === "cancelled") {
    return { verdict: "cancel", rationale: "run cancelled" };
  }
  if (inputs.repairState === "failed") {
    return { verdict: "block", rationale: "run failed during execution" };
  }

  // Integrity violations → block (these dominate any 'accepted' state).
  if (inputs.ledgerTampered) {
    return { verdict: "block", rationale: "mutation ledger does not reconcile with the real worktree (tampered)" };
  }
  if (inputs.gateTampered) {
    return { verdict: "block", rationale: "gate tampering detected (deleted tests / weakened CI)" };
  }
  if (inputs.findings.blocker > 0 || inputs.findings.critical > 0) {
    return {
      verdict: "block",
      rationale: `open ${inputs.findings.blocker} blocker / ${inputs.findings.critical} critical finding(s)`
    };
  }
  if (inputs.gateTestedDiffHash !== inputs.diffHash) {
    return { verdict: "block", rationale: "quality gates were not run against the decision diff (stale gates)" };
  }
  if (!inputs.gatesPassed) {
    return { verdict: "block", rationale: "quality gates did not pass" };
  }

  // Repair-loop outcomes.
  if (inputs.repairState === "blocked") {
    return { verdict: "block", rationale: "repair loop terminated blocked" };
  }
  if (inputs.repairState === "rejected" || inputs.repairState === "exhausted") {
    return { verdict: "reject", rationale: `repair loop terminated ${inputs.repairState}` };
  }

  // All hard preconditions satisfied AND the loop accepted → merge.
  if (inputs.repairState === "accepted") {
    return { verdict: "merge", rationale: "accepted: gates passed, ledger reconciled, no blocker/critical findings" };
  }
  // Unreachable: every RepairTerminalState is handled above. Fail closed.
  return { verdict: "block", rationale: "preconditions incomplete" };
}

/** Map the rich verdict to the A1 MergeDecision enum (merge/block/hold). */
function toMergeDecision(verdict: GovernanceVerdict): MergeDecision {
  if (verdict === "merge") {
    return "merge";
  }
  if (verdict === "repair") {
    return "hold";
  }
  return "block"; // reject / block / cancel
}

/** Build the governance record + the validated A1 GovernanceDecision artifact. */
export function buildGovernanceDecision(inputs: GovernanceInputs): GovernanceRecord {
  const { verdict, rationale } = decideVerdict(inputs);
  const artifact = GovernanceDecisionSchema.parse({
    task: inputs.task,
    specRef: inputs.specHash,
    owner: inputs.owner,
    reviewer: inputs.reviewer,
    contextRef: inputs.contextHash,
    diffHash: inputs.diffHash,
    tests: inputs.tests,
    findingsSummary: inputs.findings,
    quota: inputs.quota,
    risks: inputs.unresolvedRisks,
    mergeDecision: toMergeDecision(verdict),
    justification: rationale,
    capabilityBinding: inputs.capabilityBinding
  });
  return {
    verdict,
    rationale,
    policyVersion: GOVERNANCE_POLICY_VERSION,
    binding: {
      diffHash: inputs.diffHash,
      ledgerHeadHash: inputs.ledgerHeadHash,
      gateResultHash: inputs.gateResultHash
    },
    inputs,
    artifact
  };
}

export interface CurrentState {
  diffHash: string;
  ledgerHeadHash: string;
  gateResultHash: string;
}

export interface BindingCheck {
  valid: boolean;
  reason: string;
}

/**
 * Verify a previously-built decision still binds the CURRENT re-derived state before
 * acting on it. Prevents: approval replay, using a decision over a different diff, a
 * diff modified after the decision, and acting on an expired gate result. A `merge`
 * decision whose binding no longer matches MUST NOT be acted upon.
 */
export function verifyDecisionBinding(record: GovernanceRecord, current: CurrentState): BindingCheck {
  if (record.binding.diffHash !== current.diffHash) {
    return { valid: false, reason: "diff changed since the decision (replay / post-decision modification)" };
  }
  if (record.binding.ledgerHeadHash !== current.ledgerHeadHash) {
    return { valid: false, reason: "mutation ledger changed since the decision" };
  }
  if (record.binding.gateResultHash !== current.gateResultHash) {
    return { valid: false, reason: "quality-gate result changed since the decision (expired gates)" };
  }
  return { valid: true, reason: "decision binding matches the current state" };
}

export { sha256 as governanceSha256 };
