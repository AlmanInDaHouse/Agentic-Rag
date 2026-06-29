/**
 * Owner selection (A4 routing input) — produces a validated `RoutingDecision`.
 *
 * Technical capability is the PRIMARY factor in choosing `preferredOwner`; quota
 * availability may change `assignedOwner`, but a change is ALWAYS visible
 * (`degradedFromPreferredOwner: true` + a recorded `reason`). Risk gates the
 * degradation (Vision §16 / quota spec "Quota-Aware Routing"):
 *
 *  - low / medium risk → may degrade to the alternate when the preferred owner is
 *    unusable;
 *  - high risk → may degrade only with a recorded reason; if no acceptable alternate
 *    exists the run pauses (`humanApprovalRequired: true`);
 *  - critical risk → never degrades silently: an unusable preferred owner pauses for
 *    a human (`humanApprovalRequired: true`).
 *
 * Provider-agnostic: the only provider-named values are the `ProviderId` enum members
 * passed in. Pure and deterministic — usability is read from the quota manager's
 * snapshots (which run on an injected clock); no clock or randomness here.
 */

import {
  RoutingDecisionSchema,
  type ProviderId,
  type RoutingDecision,
  type TaskProfile
} from "@triforge/shared";
import { isOk, type QuotaManager } from "../providers/quota/index.js";

export interface OwnerSelectionInput {
  profile: TaskProfile;
  /** The exactly-two candidate providers. */
  providers: readonly [ProviderId, ProviderId];
  /** Capability score per provider (0..1). PRIMARY factor in `preferredOwner`. */
  capabilityScores: Record<ProviderId, number>;
  /** Repository-specific historical performance per provider (0..1). Optional. */
  historicalPerformanceScores?: Record<ProviderId, number>;
  quota: QuotaManager;
  /** Units the owner will need for implementation (reserve-feasibility probe). */
  implementationUnits?: number;
  /**
   * Providers that are unusable for reasons ORTHOGONAL to quota (e.g. unauthenticated;
   * A6.3 auth gate). Treated as not usable in addition to the quota checks; degradation
   * never routes to one. Default: none.
   */
  ineligibleProviders?: readonly ProviderId[];
}

const DEFAULT_IMPLEMENTATION_UNITS = 1;
const DEFAULT_HISTORICAL_SCORE = 0.5;

/** Choose an owner and produce a validated `RoutingDecision`. */
export function selectOwner(input: OwnerSelectionInput): RoutingDecision {
  const [a, b] = input.providers;
  const implUnits = input.implementationUnits ?? DEFAULT_IMPLEMENTATION_UNITS;
  const cap = input.capabilityScores;
  const hist: Partial<Record<ProviderId, number>> = input.historicalPerformanceScores ?? {};

  // Primary: capability. Deterministic tiebreak → the first provider.
  const preferredOwner: ProviderId = cap[a] >= cap[b] ? a : b;
  const alternate: ProviderId = preferredOwner === a ? b : a;

  const reason: string[] = [
    `preferredOwner=${preferredOwner} by capability (${fmt(cap[preferredOwner])} vs ${fmt(cap[alternate])})`
  ];

  const ineligible = new Set<ProviderId>(input.ineligibleProviders ?? []);
  const usable = (provider: ProviderId): boolean =>
    !ineligible.has(provider) && providerUsable(input.quota, provider, implUnits);
  const preferredUsable = usable(preferredOwner);
  const alternateUsable = usable(alternate);
  const risk = input.profile.risk;

  let assignedOwner: ProviderId = preferredOwner;
  let degradedFromPreferredOwner = false;
  let humanApprovalRequired = false;

  if (preferredUsable) {
    reason.push(`${preferredOwner} is usable (budget + availability ok)`);
  } else if (risk === "critical") {
    // Critical tasks must NOT degrade silently — pause for a human.
    humanApprovalRequired = true;
    reason.push(
      `critical task: preferred owner ${preferredOwner} is unusable; not degrading silently — human approval required`
    );
  } else if (risk === "high") {
    if (alternateUsable) {
      assignedOwner = alternate;
      degradedFromPreferredOwner = true;
      reason.push(`high-risk degraded ${preferredOwner} → ${alternate} (preferred owner unusable; recorded)`);
    } else {
      humanApprovalRequired = true;
      reason.push(
        `high-risk task: neither preferred (${preferredOwner}) nor alternate (${alternate}) is usable — human approval required`
      );
    }
  } else {
    // low / medium risk
    if (alternateUsable) {
      assignedOwner = alternate;
      degradedFromPreferredOwner = true;
      reason.push(`${risk}-risk degraded ${preferredOwner} → ${alternate} (preferred owner unusable)`);
    } else {
      humanApprovalRequired = true;
      reason.push(`no usable provider for a ${risk}-risk task — human approval required`);
    }
  }

  return RoutingDecisionSchema.parse({
    preferredOwner,
    assignedOwner,
    capabilityScore: clamp01(cap[assignedOwner] ?? 0),
    quotaAvailabilityScore: quotaAvailabilityScore(input.quota, assignedOwner, implUnits),
    historicalPerformanceScore: clamp01(hist[assignedOwner] ?? DEFAULT_HISTORICAL_SCORE),
    risk,
    degradedFromPreferredOwner,
    reason,
    humanApprovalRequired
  });
}

/** The provider opposite to `owner` in a two-provider assignment. */
export function reviewerFor(owner: ProviderId, providers: readonly [ProviderId, ProviderId]): ProviderId {
  return owner === providers[0] ? providers[1] : providers[0];
}

/** A provider is usable when a budget exists and an implementation reserve would pass the gate. */
function providerUsable(quota: QuotaManager, provider: ProviderId, implUnits: number): boolean {
  if (!quota.hasBudget(provider)) {
    return false;
  }
  return isOk(quota.assertCanProceed(provider, { requireUnits: implUnits, purpose: "implementation" }));
}

/** A 0..1 availability score derived from the budget snapshot (never fabricated). */
function quotaAvailabilityScore(quota: QuotaManager, provider: ProviderId, implUnits: number): number {
  const snapshot = quota.getSnapshot(provider);
  if (!snapshot) {
    return 0;
  }
  if (snapshot.degradedRoutingSuggested) {
    return 0;
  }
  if (!providerUsable(quota, provider, implUnits)) {
    return 0;
  }
  if (!snapshot.capacityKnown || snapshot.utilization === null) {
    // Available but capacity is unknown: report a mid score, never a fabricated 1.0.
    return 0.5;
  }
  return clamp01(1 - snapshot.utilization);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function fmt(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
}
