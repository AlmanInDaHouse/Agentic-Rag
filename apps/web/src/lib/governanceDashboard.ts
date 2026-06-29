/**
 * A8.6 Governance Dashboard view-model (mandate §10 A8.6).
 *
 * Lets a user OBSERVE the governance of a run: the autonomous merge decision (A5.8
 * verdict + rationale), policy/command/blocked decisions (A5.2/A5.3), risk and quota
 * state (A6.3), rollback, cancel, and the HUMAN OVERRIDE — which is shown as AUDITED
 * (actor + reason + timestamp). It invents no decision (an absent field renders as
 * null/empty, not a fabricated value) and sanitizes all free text. Pure + deterministic.
 */

import { safeText } from "./sanitize.js";

export interface PolicyDecision {
  kind: string;
  outcome: string;
  detail: string;
}

export interface HumanOverride {
  actor: string;
  reason: string;
  at: string;
}

export interface GovernanceObservation {
  mergeVerdict?: string;
  mergeRationale?: string;
  policyDecisions?: PolicyDecision[];
  riskState?: string;
  quotaState?: string;
  rollback?: boolean;
  cancelled?: boolean;
  humanOverride?: HumanOverride;
}

export interface GovernanceView {
  merge: { verdict: string; rationale: string } | null;
  decisions: PolicyDecision[];
  riskState: string;
  quotaState: string;
  rollback: boolean;
  cancelled: boolean;
  /** Present only when a human override occurred — always shown as audited. */
  humanOverride: HumanOverride | null;
}

function s(text: string): string {
  return safeText(text, 2000).text;
}

export function buildGovernanceDashboard(obs: GovernanceObservation): GovernanceView {
  return {
    merge:
      obs.mergeVerdict !== undefined
        ? { verdict: obs.mergeVerdict, rationale: s(obs.mergeRationale ?? "") }
        : null,
    decisions: (obs.policyDecisions ?? []).map((d) => ({
      kind: s(d.kind),
      outcome: s(d.outcome),
      detail: s(d.detail)
    })),
    riskState: obs.riskState ?? "unknown",
    quotaState: obs.quotaState ?? "unknown",
    rollback: obs.rollback ?? false,
    cancelled: obs.cancelled ?? false,
    humanOverride:
      obs.humanOverride !== undefined
        ? { actor: s(obs.humanOverride.actor), reason: s(obs.humanOverride.reason), at: obs.humanOverride.at }
        : null
  };
}
