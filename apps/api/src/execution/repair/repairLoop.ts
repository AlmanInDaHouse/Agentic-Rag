/**
 * Repair Loop (A5.7) — the bounded loop that drives a writable run to a terminal
 * decision (mandate §A5.7):
 *
 *   owner implementation → quality gates → reviewer findings → owner repair → gates …
 *
 * It is BOUNDED on every axis (rounds, wall-time, commands, files changed, output
 * bytes, quota) and detects no-progress / repeated findings, cancellation and a hard
 * stop, so it ALWAYS terminates in one of:
 *   accepted | rejected | blocked | exhausted | cancelled | failed
 * — never an infinite loop.
 *
 * The three steps are INJECTED (owner implement / gate run / reviewer review), so the
 * mock-first writable E2E (A5.9) wires the mock providers + the A5.6 gate runner, and
 * unit tests inject deterministic steps. The loop itself owns only the control flow,
 * the limits and the terminal-state decision.
 */

import type { FindingSeverity, ReviewFindings, QualityGateStatus } from "@triforge/shared";

export type RepairState =
  | "accepted"
  | "rejected"
  | "blocked"
  | "exhausted"
  | "cancelled"
  | "failed";

export interface ImplementOutcome {
  /** The A5.5 diff hash after this round's implementation (no-progress detection). */
  diffHash: string;
  /** Files changed this round (accumulated as a union for the files limit). */
  filesChanged: string[];
  /** Commands run this round (accumulated for the command limit). */
  commandCount: number;
  /** Output bytes produced this round (accumulated for the output limit). */
  outputBytes: number;
  /** Quota consumed this round (accumulated for the quota limit). */
  quotaConsumed?: number;
}

export interface GateOutcomeLite {
  overallStatus: QualityGateStatus;
}

export interface RepairSteps {
  /** Owner implementation/repair for a round. */
  implement: (round: number) => Promise<ImplementOutcome>;
  /** Run the quality gates (A5.6). */
  runGates: () => Promise<GateOutcomeLite>;
  /** Reviewer produces findings from the round's state. */
  review: (gates: GateOutcomeLite, round: number) => Promise<ReviewFindings>;
}

export interface RepairLimits {
  maxRounds: number;
  maxWallTimeMs?: number;
  maxCommands?: number;
  maxFilesChanged?: number;
  maxOutputBytes?: number;
  maxQuota?: number;
  /** Consecutive no-progress rounds tolerated before rejecting. Default 2. */
  noProgressLimit?: number;
}

export interface RoundRecord {
  round: number;
  diffHash: string;
  gateStatus: QualityGateStatus;
  findingCounts: Record<FindingSeverity, number>;
  decision: "accepted" | "repair" | "blocked" | "no_progress";
}

export interface RepairResult {
  state: RepairState;
  rounds: number;
  reason: string;
  history: RoundRecord[];
  totals: { commands: number; files: number; outputBytes: number; quota: number };
}

export interface RepairLoopOptions {
  steps: RepairSteps;
  limits: RepairLimits;
  clock: { now(): number };
  /** Polled before each round; returns true to cancel. */
  isCancelled?: () => boolean;
  onRound?: (record: RoundRecord) => void;
}

const SEVERITIES: FindingSeverity[] = ["blocker", "critical", "major", "minor", "observation"];

function countBySeverity(findings: ReviewFindings): Record<FindingSeverity, number> {
  const counts = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 } as Record<
    FindingSeverity,
    number
  >;
  for (const f of findings.findings) {
    counts[f.severity] += 1;
  }
  return counts;
}

/** A stable signature of a finding set, for repeated-finding detection. */
function findingsSignature(findings: ReviewFindings): string {
  return findings.findings
    .map((f) => `${f.severity}:${f.category}:${f.file ?? ""}:${f.requiredAction}`)
    .sort()
    .join("|");
}

export class RepairLoop {
  private readonly opts: RepairLoopOptions;

  constructor(options: RepairLoopOptions) {
    this.opts = options;
  }

  async run(): Promise<RepairResult> {
    const limits = this.opts.limits;
    const noProgressLimit = limits.noProgressLimit ?? 2;
    const history: RoundRecord[] = [];
    const totals = { commands: 0, files: 0, outputBytes: 0, quota: 0 };
    const fileSet = new Set<string>();
    let prevDiffHash: string | null = null;
    let prevSignature: string | null = null;
    let noProgress = 0;
    const startedAt = this.opts.clock.now();

    for (let round = 0; round < limits.maxRounds; round += 1) {
      if (this.opts.isCancelled?.()) {
        return this.finish("cancelled", round, "cancelled before round", history, totals);
      }

      let impl: ImplementOutcome;
      let gates: GateOutcomeLite;
      let findings: ReviewFindings;
      try {
        impl = await this.opts.steps.implement(round);
        gates = await this.opts.steps.runGates();
        findings = await this.opts.steps.review(gates, round);
      } catch (error) {
        return this.finish(
          "failed",
          round,
          `step threw: ${(error as Error).message}`,
          history,
          totals
        );
      }

      // Accumulate usage for the limits.
      totals.commands += impl.commandCount;
      totals.outputBytes += impl.outputBytes;
      totals.quota += impl.quotaConsumed ?? 0;
      for (const f of impl.filesChanged) {
        fileSet.add(f);
      }
      totals.files = fileSet.size;

      const counts = countBySeverity(findings);
      const signature = findingsSignature(findings);
      const blocking = counts.blocker;
      const needsRepair = counts.critical + counts.major > 0 || gates.overallStatus !== "passed";

      // No-progress: the owner produced the same diff, or the same finding set recurs.
      const sameDiff = prevDiffHash !== null && impl.diffHash === prevDiffHash;
      const sameFindings = prevSignature !== null && signature === prevSignature && signature !== "";
      if ((sameDiff || sameFindings) && (needsRepair || blocking > 0)) {
        noProgress += 1;
      } else {
        noProgress = 0;
      }

      let decision: RoundRecord["decision"];
      if (blocking > 0) {
        decision = "blocked";
      } else if (gates.overallStatus === "passed" && !needsRepair) {
        decision = "accepted";
      } else if (noProgress >= noProgressLimit) {
        decision = "no_progress";
      } else {
        decision = "repair";
      }

      const record: RoundRecord = {
        round,
        diffHash: impl.diffHash,
        gateStatus: gates.overallStatus,
        findingCounts: counts,
        decision
      };
      history.push(record);
      try {
        this.opts.onRound?.(record);
      } catch {
        /* observer must not break the loop */
      }

      if (decision === "accepted") {
        return this.finish("accepted", round + 1, "gates passed, no blocking findings", history, totals);
      }
      if (decision === "blocked") {
        return this.finish("blocked", round + 1, `${blocking} blocker finding(s)`, history, totals);
      }
      if (decision === "no_progress") {
        return this.finish("rejected", round + 1, "no progress across repair rounds", history, totals);
      }

      // Resource limits → exhausted.
      const limitHit = this.limitHit(limits, totals, startedAt);
      if (limitHit !== null) {
        return this.finish("exhausted", round + 1, limitHit, history, totals);
      }

      prevDiffHash = impl.diffHash;
      prevSignature = signature;
    }

    return this.finish("exhausted", limits.maxRounds, "max repair rounds reached", history, totals);
  }

  private limitHit(
    limits: RepairLimits,
    totals: RepairResult["totals"],
    startedAt: number
  ): string | null {
    if (limits.maxCommands !== undefined && totals.commands > limits.maxCommands) {
      return "command limit exceeded";
    }
    if (limits.maxFilesChanged !== undefined && totals.files > limits.maxFilesChanged) {
      return "files-changed limit exceeded";
    }
    if (limits.maxOutputBytes !== undefined && totals.outputBytes > limits.maxOutputBytes) {
      return "output limit exceeded";
    }
    if (limits.maxQuota !== undefined && totals.quota > limits.maxQuota) {
      return "quota exhausted";
    }
    if (limits.maxWallTimeMs !== undefined && this.opts.clock.now() - startedAt > limits.maxWallTimeMs) {
      return "wall-time limit exceeded";
    }
    return null;
  }

  private finish(
    state: RepairState,
    rounds: number,
    reason: string,
    history: RoundRecord[],
    totals: RepairResult["totals"]
  ): RepairResult {
    return { state, rounds, reason, history, totals };
  }
}

export { SEVERITIES as repairFindingSeverities };
