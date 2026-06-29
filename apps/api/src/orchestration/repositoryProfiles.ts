/**
 * Repository-specific profiles (A6.5) — learns, FROM THIS REPOSITORY'S metrics only,
 * "in repo R, provider X performs better for task family Y", and emits evidence-bearing
 * `CapabilityRule`s the routers can consume (mandate §A6.5).
 *
 * Honest guarantees:
 *  - **no auto-generalization** — a derived rule is scoped to its `repoId` (via
 *    `RouterContext.repoId`) and is inert in any other repository;
 *  - **minimum sample** — a rule forms only when BOTH providers have at least
 *    `minSample` re-derived samples for the task family AND their first-pass success
 *    rates differ by at least `minDifference`; otherwise the profile reports UNKNOWN
 *    (no rule), never a fabricated preference;
 *  - **n + confidence** — every derived rule records the sample counts and a confidence
 *    derived from the observed difference.
 *
 * Pure + deterministic (reads the A6.4 `MetricsStore` aggregates).
 */

import type { ProviderId, TaskProfile } from "@triforge/shared";
import type { ExtendedProfile } from "./taskProfiler.js";
import type { CapabilityRule } from "./staticRouter.js";
import type { MetricsStore } from "./executionMetrics.js";

export const REPO_PROFILE_VERSION = "a6.5-repo-profile-1.0.0";

export interface RepoProfileOptions {
  /** Minimum re-derived samples per provider for a task family before a rule forms. */
  minSample?: number;
  /** Minimum first-pass success-rate difference to assert a preference. */
  minDifference?: number;
}

export interface ProviderTaskStat {
  taskType: string;
  provider: ProviderId;
  n: number;
  firstPassSuccessRate: number | "unknown";
}

export interface RepositoryProfile {
  repoId: string;
  stats: ProviderTaskStat[];
  /** Evidence-bearing, repo-scoped rules (only above the sample/difference gates). */
  rules: CapabilityRule[];
  /** Task families that had data but did not meet the gates (reported as UNKNOWN). */
  unknownFamilies: string[];
}

const DEFAULT_MIN_SAMPLE = 5;
const DEFAULT_MIN_DIFFERENCE = 0.2;

function rate(store: MetricsStore, taskType: string, provider: ProviderId): { n: number; rate: number | "unknown" } {
  const agg = store.aggregate({ taskType, owner: provider });
  return { n: agg.n, rate: agg.firstPassSuccessRate };
}

/**
 * Build the repository profile from the metrics store for `repoId`, deriving rules
 * only where the sample + difference gates are met. NEVER generalizes across repos.
 */
export function buildRepositoryProfile(
  store: MetricsStore,
  repoId: string,
  providers: readonly [ProviderId, ProviderId],
  taskFamilies: readonly string[],
  options: RepoProfileOptions = {}
): RepositoryProfile {
  const minSample = options.minSample ?? DEFAULT_MIN_SAMPLE;
  const minDifference = options.minDifference ?? DEFAULT_MIN_DIFFERENCE;
  const [a, b] = providers;

  const stats: ProviderTaskStat[] = [];
  const rules: CapabilityRule[] = [];
  const unknownFamilies: string[] = [];

  for (const taskType of taskFamilies) {
    const ra = rate(store, taskType, a);
    const rb = rate(store, taskType, b);
    stats.push({ taskType, provider: a, n: ra.n, firstPassSuccessRate: ra.rate });
    stats.push({ taskType, provider: b, n: rb.n, firstPassSuccessRate: rb.rate });

    // Gate: both providers need enough samples and a known rate.
    if (ra.n < minSample || rb.n < minSample || ra.rate === "unknown" || rb.rate === "unknown") {
      if (ra.n > 0 || rb.n > 0) {
        unknownFamilies.push(taskType);
      }
      continue;
    }
    const diff = ra.rate - rb.rate;
    if (Math.abs(diff) < minDifference) {
      unknownFamilies.push(taskType);
      continue;
    }
    const better: ProviderId = diff > 0 ? a : b;
    const worse: ProviderId = diff > 0 ? b : a;
    const betterRate = diff > 0 ? ra.rate : rb.rate;
    const worseRate = diff > 0 ? rb.rate : ra.rate;
    const confidence = Math.min(1, Math.abs(diff));

    rules.push({
      id: `repo-${repoId}-${taskType}-favor-${better}`,
      version: REPO_PROFILE_VERSION,
      evidenceBasis: `repository ${repoId} metrics: ${better} first-pass ${betterRate.toFixed(2)} vs ${worse} ${worseRate.toFixed(2)} on ${taskType} (n=${ra.n}/${rb.n})`,
      confidence,
      fallback: "neutral capability score for this task family",
      apply: (profile: TaskProfile, _ext: ExtendedProfile, _providers, ctx) => {
        // Repo-scoped: only fire in the repository the rule was learned from.
        if (ctx.repoId !== repoId || profile.taskKind !== taskType) {
          return null;
        }
        return {
          deltas: { [better]: confidence * 0.3 } as Partial<Record<ProviderId, number>>,
          reason: `repo ${repoId}: favor ${better} on ${taskType} (conf ${confidence.toFixed(2)})`
        };
      }
    });
  }

  return { repoId, stats, rules, unknownFamilies };
}
