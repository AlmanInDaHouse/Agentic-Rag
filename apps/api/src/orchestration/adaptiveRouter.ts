/**
 * Protected Adaptive Router (A6.6) — the top of the routing stack and the closure of
 * A6. It composes the A6.2 static (neutral) baseline with the A6.5 repository-learned
 * rules into an adaptive capability score, but ONLY behind a set of guards (mandate
 * §A6.6). When any guard fails it FALLS BACK to the static neutral routing, and every
 * decision is EXPLAINABLE (which rules fired, their confidence, the guard outcomes).
 *
 * Guards (all must hold to apply learned rules):
 *  - **human override** — if provided, it wins outright (audited);
 *  - **minimum sample + confidence** — only learned rules with `confidence ≥
 *    minConfidence` qualify (A6.5 already gated them on a minimum sample);
 *  - **fallback exists** — the static neutral routing is always the fallback;
 *  - **explainable** — the result carries the rule trace + guard outcomes;
 *  - **sparse data must not dominate** — learned deltas are bounded (A6.5) and only
 *    qualifying rules apply; with none, routing stays neutral;
 *  - **security/correctness over speed** — for a critical-risk or security-sensitive
 *    task the learned (speed-oriented) rules are NOT applied; routing stays
 *    conservative/neutral.
 *
 * Pure + deterministic.
 */

import type { ProviderId, TaskProfile } from "@triforge/shared";
import type { ExtendedProfile } from "./taskProfiler.js";
import { DEFAULT_RULES, routeStatically, type AppliedRule, type CapabilityRule } from "./staticRouter.js";

export const ADAPTIVE_ROUTER_VERSION = "a6.6-adaptive-router-1.0.0";

export type RoutingMode = "override" | "adaptive" | "static";

export interface AdaptiveRoutingInput {
  profile: TaskProfile;
  extended: ExtendedProfile;
  providers: readonly [ProviderId, ProviderId];
  repoId: string;
  /** Repo-scoped learned rules from A6.5 (already sample-gated). */
  repoRules: readonly CapabilityRule[];
  providerCapabilities?: Record<ProviderId, string[]>;
  /** Minimum rule confidence to activate a learned rule. Default 0.6. */
  minConfidence?: number;
  /** A human override that forces the owner (audited, wins outright). */
  humanOverride?: ProviderId;
}

export interface AdaptiveRoutingResult {
  mode: RoutingMode;
  capabilityScores: Record<ProviderId, number>;
  preferredOwner: ProviderId;
  /** Learned rules that actually fired (empty for static/override). */
  activatedRules: AppliedRule[];
  /** True when the learned routing was NOT applied (guard failed → static fallback). */
  fallbackUsed: boolean;
  guardOutcomes: Record<string, boolean>;
  explanation: string[];
  routerVersion: string;
}

const DEFAULT_MIN_CONFIDENCE = 0.6;

function argmax(scores: Record<ProviderId, number>, providers: readonly [ProviderId, ProviderId]): ProviderId {
  const [a, b] = providers;
  return (scores[a] ?? 0) >= (scores[b] ?? 0) ? a : b;
}

export function routeAdaptive(input: AdaptiveRoutingInput): AdaptiveRoutingResult {
  const { profile, extended, providers, repoId } = input;
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const explanation: string[] = [];

  // Guard 0: human override wins outright (audited, explainable).
  if (input.humanOverride !== undefined) {
    const forced = input.humanOverride;
    const other = providers[0] === forced ? providers[1] : providers[0];
    const scores = { [forced]: 1, [other]: 0 } as Record<ProviderId, number>;
    explanation.push(`human override: forced owner = ${forced}`);
    return {
      mode: "override",
      capabilityScores: scores,
      preferredOwner: forced,
      activatedRules: [],
      fallbackUsed: false,
      guardOutcomes: { humanOverride: true },
      explanation,
      routerVersion: ADAPTIVE_ROUTER_VERSION
    };
  }

  // Guards for learned activation.
  const securitySensitive = profile.risk === "critical" || extended.securitySensitivity >= 0.7;
  const qualifyingRules = input.repoRules.filter((r) => r.confidence >= minConfidence);
  const guardOutcomes: Record<string, boolean> = {
    notSecuritySensitive: !securitySensitive,
    hasConfidentLearnedRule: qualifyingRules.length > 0,
    fallbackAvailable: true,
    humanOverride: false
  };
  const activate = !securitySensitive && qualifyingRules.length > 0;

  if (securitySensitive) {
    explanation.push("security/correctness-sensitive task: learned routing NOT applied (no speed-over-correctness)");
  }
  if (qualifyingRules.length === 0) {
    explanation.push(`no learned rule meets confidence ≥ ${minConfidence}: routing stays neutral`);
  }

  const rules: readonly CapabilityRule[] = activate ? [...DEFAULT_RULES, ...qualifyingRules] : DEFAULT_RULES;
  const staticResult = routeStatically(profile, extended, providers, {
    rules,
    context: { providerCapabilities: input.providerCapabilities, repoId }
  });
  explanation.push(activate ? "adaptive: applied learned repository rules" : "fallback: static neutral routing");
  explanation.push(...staticResult.rationale);

  return {
    mode: activate ? "adaptive" : "static",
    capabilityScores: staticResult.capabilityScores,
    preferredOwner: argmax(staticResult.capabilityScores, providers),
    activatedRules: staticResult.appliedRules,
    fallbackUsed: !activate,
    guardOutcomes,
    explanation,
    routerVersion: ADAPTIVE_ROUTER_VERSION
  };
}
