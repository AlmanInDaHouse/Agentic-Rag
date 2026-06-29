/**
 * Quota-Aware Router (A6.3) — the end-to-end routing composer (mandate §A6.3). It
 * combines:
 *
 *   capability (A6.2 static router)
 *   + provider availability + quota + reservations (A2.3 quota manager)
 *   + authentication state
 *   + task risk + historical repository performance + confidence
 *
 * into a final routing decision, reusing the A4 owner-selection (`routing.ts`, which
 * already does the risk-gated quota degradation) and adding the authentication gate +
 * an explicit terminal classification:
 *
 *  - low risk → fallback to the alternate allowed under policy;
 *  - medium risk → degradation is VISIBLE (`degradedFromPreferredOwner`);
 *  - high risk → degrades only with a recorded reason, else pauses;
 *  - critical risk → never degrades silently; an unusable preferred owner pauses;
 *  - quota UNKNOWN is never presented as guaranteed availability (A4 scores it ≤0.5);
 *  - quota EXHAUSTED on all providers → HARD STOP (await reset; NO paid fallback);
 *  - an unauthenticated provider is ineligible (auth gate).
 *
 * Pure + deterministic (the quota manager runs on an injected clock).
 */

import type { AuthenticationState, ProviderId, RoutingDecision, TaskProfile } from "@triforge/shared";
import type { QuotaManager } from "../providers/quota/index.js";
import { selectOwner } from "./routing.js";
import { routeStatically, type AppliedRule } from "./staticRouter.js";
import type { ExtendedProfile } from "./taskProfiler.js";

export const QUOTA_AWARE_ROUTER_VERSION = "a6.3-quota-aware-1.0.0";

export type RoutingStatus = "routed" | "paused" | "hard_stop";

export interface QuotaAwareRoutingInput {
  profile: TaskProfile;
  extended: ExtendedProfile;
  providers: readonly [ProviderId, ProviderId];
  quota: QuotaManager;
  /** Authentication state per provider (an unauthenticated provider is ineligible). */
  authState: Record<ProviderId, AuthenticationState>;
  /** Known provider capabilities (version-bound snapshots) for the A6.2 rules. */
  providerCapabilities?: Record<ProviderId, string[]>;
  /** Repository-specific historical performance per provider (0..1). */
  historicalPerformanceScores?: Record<ProviderId, number>;
  implementationUnits?: number;
}

export interface QuotaAwareRoutingResult {
  status: RoutingStatus;
  routing: RoutingDecision;
  capabilityScores: Record<ProviderId, number>;
  appliedRules: AppliedRule[];
  /** Providers excluded by the authentication gate. */
  authGated: ProviderId[];
  routerVersion: string;
  rationale: string[];
}

export function routeQuotaAware(input: QuotaAwareRoutingInput): QuotaAwareRoutingResult {
  const { profile, extended, providers, quota, authState } = input;
  const rationale: string[] = [];

  // 1. Capability scores from the honest A6.2 static router.
  const staticResult = routeStatically(profile, extended, providers, {
    context: { providerCapabilities: input.providerCapabilities }
  });
  rationale.push(...staticResult.rationale);

  // 2. Authentication gate: an unauthenticated provider is ineligible (and never a
  //    preferred/degradation target). Zero its capability AND mark it ineligible.
  const effectiveCap: Record<string, number> = { ...staticResult.capabilityScores };
  const authGated: ProviderId[] = [];
  for (const p of providers) {
    if (authState[p] !== "authenticated") {
      effectiveCap[p] = 0;
      authGated.push(p);
      rationale.push(`auth gate: ${p} is ${authState[p]} → ineligible`);
    }
  }

  // 3. A4 owner selection: capability (primary) + risk-gated quota degradation, with
  //    the auth-gated providers passed as ineligible so degradation never routes to one.
  const routing = selectOwner({
    profile,
    providers,
    capabilityScores: effectiveCap as Record<ProviderId, number>,
    historicalPerformanceScores: input.historicalPerformanceScores,
    quota,
    implementationUnits: input.implementationUnits,
    ineligibleProviders: authGated
  });

  rationale.push("no paid fallback — degradation uses only existing provider budgets");

  // 4. Terminal classification.
  let status: RoutingStatus = "routed";
  if (routing.humanApprovalRequired) {
    // A provider is hard-stopped when its budget/quota is exhausted (the quota
    // manager's own hard-stop signal). All providers hard-stopped → terminal.
    const hardStopped = (p: ProviderId): boolean => quota.getSnapshot(p)?.hardStopped === true;
    if (providers.every(hardStopped)) {
      status = "hard_stop";
      rationale.push("HARD STOP: all providers quota-exhausted (await quota reset; no paid fallback)");
    } else {
      status = "paused";
      rationale.push("PAUSED: no usable provider (auth or quota); human/owner intervention required");
    }
  } else {
    rationale.push(`routed → ${routing.assignedOwner}${routing.degradedFromPreferredOwner ? " (degraded, visible)" : ""}`);
  }

  return {
    status,
    routing,
    capabilityScores: staticResult.capabilityScores,
    appliedRules: staticResult.appliedRules,
    authGated,
    routerVersion: QUOTA_AWARE_ROUTER_VERSION,
    rationale
  };
}
