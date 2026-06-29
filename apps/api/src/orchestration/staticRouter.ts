/**
 * Static Capability Router (A6.2) — maps a `TaskProfile` (A6.1) to a per-provider
 * capability score that the A4 owner-selection (`routing.ts`) consumes as its PRIMARY
 * factor (mandate §A6.2).
 *
 * Honest-by-default: TriForge has NO repository performance evidence yet (that is
 * A6.4/A6.5), so the router does NOT encode "provider X is better at Y" stereotypes.
 * Each rule must carry an EVIDENCE BASIS, a CONFIDENCE, a FALLBACK, a REASON and a
 * VERSION; the default rule set is conservative — providers start NEUTRAL (equal) and
 * are only adjusted by rules grounded in hard facts (a capability snapshot showing a
 * provider lacks a REQUIRED capability). Rules are overridable so A6.4/A6.5 can add
 * learned, evidence-bearing rules later. Pure + deterministic.
 */

import type { ProviderId } from "@triforge/shared";
import type { ExtendedProfile } from "./taskProfiler.js";
import type { TaskProfile } from "@triforge/shared";

export const STATIC_ROUTER_VERSION = "a6.2-static-router-1.0.0";

const BASELINE_SCORE = 0.5;

export interface RouterContext {
  /** Capabilities each provider is KNOWN to support (from version-bound snapshots). */
  providerCapabilities?: Record<ProviderId, string[]>;
  /**
   * The repository the routing is for. Repository-specific rules (A6.5) fire ONLY
   * when this matches their repo id — so a learned rule never auto-generalizes to
   * another repository.
   */
  repoId?: string;
}

export interface CapabilityRule {
  id: string;
  version: string;
  /** What grounds this rule — a fact, not a stereotype. */
  evidenceBasis: string;
  /** 0–1 confidence in the rule's adjustment. */
  confidence: number;
  /** What happens if the rule cannot be applied / its evidence is missing. */
  fallback: string;
  /**
   * Return per-provider score DELTAS (added to the running score, then clamped), or
   * null when the rule does not apply. `reason` documents why it fired.
   */
  apply(
    profile: TaskProfile,
    extended: ExtendedProfile,
    providers: readonly ProviderId[],
    ctx: RouterContext
  ): { deltas: Partial<Record<ProviderId, number>>; reason: string } | null;
}

export interface AppliedRule {
  id: string;
  version: string;
  evidenceBasis: string;
  confidence: number;
  reason: string;
}

export interface StaticRoutingResult {
  capabilityScores: Record<ProviderId, number>;
  appliedRules: AppliedRule[];
  rationale: string[];
  routerVersion: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Default rule set. Conservative and evidence-grounded — NO eternal stereotypes.
 */
export const DEFAULT_RULES: readonly CapabilityRule[] = [
  {
    id: "required-capability-snapshot",
    version: "1.0.0",
    evidenceBasis:
      "version-bound provider capability snapshots: a provider that does not support a capability the task requires cannot do it",
    confidence: 1,
    fallback: "if no snapshot is available, leave the score neutral (do not penalize)",
    apply: (_profile, extended, providers, ctx) => {
      const caps = ctx.providerCapabilities;
      if (caps === undefined) {
        return null; // no evidence → neutral
      }
      const deltas: Partial<Record<ProviderId, number>> = {};
      const reasons: string[] = [];
      for (const p of providers) {
        const supported = caps[p] ?? [];
        const missing = extended.requiredProviderCapabilities.filter((c) => !supported.includes(c));
        if (missing.length > 0) {
          deltas[p] = -1; // drive to 0 after clamp — it cannot do the task
          reasons.push(`${p} lacks required capability/ies [${missing.join(", ")}]`);
        }
      }
      if (Object.keys(deltas).length === 0) {
        return null;
      }
      return { deltas, reason: reasons.join("; ") };
    }
  },
  {
    id: "neutral-baseline",
    version: "1.0.0",
    evidenceBasis:
      "no repository performance evidence exists yet (A6.4/A6.5); providers are treated as equally capable until measured — explicitly NOT a stereotype",
    confidence: 0.5,
    fallback: "neutral scores; owner selection then degrades only by quota/availability (A4)",
    apply: () => null // documents the stance; applies no adjustment
  }
];

/**
 * Compute per-provider capability scores from a task profile, applying the rules in
 * order. Returns the scores plus the applied rules (each with its evidence basis and
 * confidence) for audit. Overridable: pass a custom `rules` set.
 */
export function routeStatically(
  profile: TaskProfile,
  extended: ExtendedProfile,
  providers: readonly ProviderId[],
  options: { rules?: readonly CapabilityRule[]; context?: RouterContext } = {}
): StaticRoutingResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const ctx = options.context ?? {};
  const scores: Record<string, number> = {};
  for (const p of providers) {
    scores[p] = BASELINE_SCORE;
  }
  const appliedRules: AppliedRule[] = [];
  const rationale: string[] = [`baseline ${BASELINE_SCORE} for all providers (no stereotype)`];

  for (const rule of rules) {
    const result = rule.apply(profile, extended, providers, ctx);
    if (result === null) {
      continue;
    }
    for (const [p, delta] of Object.entries(result.deltas)) {
      if (delta !== undefined && p in scores) {
        scores[p] = clamp01(scores[p] + delta);
      }
    }
    appliedRules.push({
      id: rule.id,
      version: rule.version,
      evidenceBasis: rule.evidenceBasis,
      confidence: rule.confidence,
      reason: result.reason
    });
    rationale.push(`rule ${rule.id} (conf ${rule.confidence}): ${result.reason}`);
  }

  return {
    capabilityScores: scores as Record<ProviderId, number>,
    appliedRules,
    rationale,
    routerVersion: STATIC_ROUTER_VERSION
  };
}
