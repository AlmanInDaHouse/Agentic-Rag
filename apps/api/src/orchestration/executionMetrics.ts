/**
 * Execution Metrics (A6.4) — an append-only store of per-run outcomes used by the
 * adaptive router (A6.6) and repository profiles (A6.5) to learn from EVIDENCE
 * (mandate §A6.4).
 *
 * The metrics are protected against the five ways they could lie:
 *  - **duplication** — `record` is idempotent on a (runId, taskId) key; a repeat is
 *    ignored, so one run/task contributes exactly one sample;
 *  - **cross-run contamination** — every sample carries its `runId`; the store keys by
 *    it and never overwrites another run's sample;
 *  - **unverified provider self-reporting** — a sample's `provenance` is recorded;
 *    aggregates count ONLY `re_derived` samples (gates/ledger/governance), never a
 *    provider's own claim;
 *  - **missing samples** — an aggregate over zero samples reports `"unknown"`, never a
 *    fabricated 0 or rate;
 *  - **cherry-picking** — the store is append-only (no delete); aggregates use ALL
 *    matching samples and report the sample count `n`.
 *
 * Pure + deterministic (timestamps are supplied by the caller / injected clock).
 */

import type { FindingsSummary, ProviderId } from "@triforge/shared";

export type MetricProvenance = "re_derived" | "provider_reported";

export type MergeResult = "merged" | "blocked" | "rejected" | "reverted" | "not_attempted";

export interface RunMetric {
  runId: string;
  taskId: string;
  taskType: string;
  owner: ProviderId;
  reviewer: ProviderId;
  providerVersions: Partial<Record<ProviderId, string>>;
  mode: string;
  firstPassSuccess: boolean;
  repairRounds: number;
  findings: FindingsSummary;
  regressions: number;
  wallTimeMs: number;
  commandCount: number;
  filesChanged: number;
  diffSize: number;
  governanceDecision: string;
  mergeResult: MergeResult;
  rollback: boolean;
  failureReason: string | null;
  /** Where the numbers came from — only `re_derived` feeds aggregates. */
  provenance: MetricProvenance;
  recordedAt: string;
}

export interface RecordOutcome {
  recorded: boolean;
  reason: string;
}

export interface AggregateFilter {
  taskType?: string;
  owner?: ProviderId;
}

export interface Aggregate {
  /** Number of re-derived samples that matched (provider-reported are excluded). */
  n: number;
  firstPassSuccessRate: number | "unknown";
  avgRepairRounds: number | "unknown";
  mergeRate: number | "unknown";
  rollbackRate: number | "unknown";
  /** Samples excluded because they were provider-reported (unverified). */
  excludedUnverified: number;
}

function key(runId: string, taskId: string): string {
  return `${runId}␟${taskId}`; // ␟ unit separator — runId/taskId are not validated here
}

export class MetricsStore {
  private readonly byKey = new Map<string, RunMetric>();
  private readonly order: string[] = [];

  /** Append a sample. Idempotent on (runId, taskId): a repeat key is ignored. */
  record(metric: RunMetric): RecordOutcome {
    const k = key(metric.runId, metric.taskId);
    if (this.byKey.has(k)) {
      return { recorded: false, reason: "duplicate (runId, taskId) — idempotent, ignored" };
    }
    this.byKey.set(k, metric);
    this.order.push(k);
    return { recorded: true, reason: "recorded" };
  }

  /** All samples in insertion order (append-only — nothing is ever removed). */
  all(): readonly RunMetric[] {
    return this.order.map((k) => this.byKey.get(k)!);
  }

  /**
   * Aggregate over the matching, RE-DERIVED samples. Provider-reported samples are
   * retained in the store (audit) but excluded here. Zero samples → `"unknown"`.
   */
  aggregate(filter: AggregateFilter = {}): Aggregate {
    let excludedUnverified = 0;
    const matched: RunMetric[] = [];
    for (const m of this.all()) {
      if (filter.taskType !== undefined && m.taskType !== filter.taskType) {
        continue;
      }
      if (filter.owner !== undefined && m.owner !== filter.owner) {
        continue;
      }
      if (m.provenance !== "re_derived") {
        excludedUnverified += 1;
        continue;
      }
      matched.push(m);
    }
    const n = matched.length;
    if (n === 0) {
      return {
        n: 0,
        firstPassSuccessRate: "unknown",
        avgRepairRounds: "unknown",
        mergeRate: "unknown",
        rollbackRate: "unknown",
        excludedUnverified
      };
    }
    const firstPass = matched.filter((m) => m.firstPassSuccess).length / n;
    const repair = matched.reduce((s, m) => s + m.repairRounds, 0) / n;
    const merged = matched.filter((m) => m.mergeResult === "merged").length / n;
    const rolled = matched.filter((m) => m.rollback).length / n;
    return {
      n,
      firstPassSuccessRate: firstPass,
      avgRepairRounds: repair,
      mergeRate: merged,
      rollbackRate: rolled,
      excludedUnverified
    };
  }
}
