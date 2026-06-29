/**
 * Competitive Mode (A7) — runs the SAME task through two ISOLATED candidate worktrees
 * (one per provider) and selects the winner by re-derived comparative evidence, never
 * by narrative or majority (mandate §A7 / §9). It is opt-in by policy and gated on
 * sufficient budget.
 *
 * Each candidate runs the A5.9 `runWritableTask` pipeline (worktree → owner →
 * path/command policy → ledger → gates → review → governance) with `autoMerge:false`
 * and `autoCleanup:false`, so both candidates stay isolated and unmerged until the
 * selection is made. The candidates share the SAME TaskSpecification, allowed-path
 * policy, gate set and acceptance harness, but have INDEPENDENT worktrees, ledgers and
 * reviewers — no mutual access, no artifact contamination. The selector merges ONLY the
 * winner's branch and cleans up both worktrees (the loser's evidence is preserved in its
 * report before cleanup).
 */

import type { CapabilityBinding, ProviderId } from "@triforge/shared";
import type { Clock } from "../../providers/clock.js";
import type { GitRunner } from "../worktree/index.js";
import { WorktreeManager } from "../worktree/index.js";
import type { AllowedPathPolicy } from "../path/index.js";
import type { GateSpec } from "../gates/index.js";
import type { CommandPolicyConfig } from "../command/index.js";
import type { ProcessRunner } from "../../providers/real/processRunner.js";
import type { GovernanceRecord } from "../governance/index.js";
import {
  runWritableTask,
  mergeWorktreeBranch,
  type OwnerImplement,
  type ReviewerReview,
  type WritableRunReport
} from "../e2e/index.js";

export interface CompetitiveCandidate {
  provider: ProviderId;
  /** Distinct run id → an isolated worktree per candidate. */
  runId: string;
  ownerImplement: OwnerImplement;
  reviewerReview: ReviewerReview;
}

export interface CompetitiveBudget {
  /** Competitive Mode must be explicitly opted into. */
  optIn: boolean;
  availableUnits: number;
  /** Units one candidate run needs (the competition needs 2×). */
  requiredUnitsPerCandidate: number;
}

export interface CompetitiveConfig {
  baseRepoPath: string;
  stateRoot: string;
  taskId: string;
  task: string;
  pathPolicy: AllowedPathPolicy;
  gates: GateSpec[];
  processRunner: ProcessRunner;
  commandConfig?: CommandPolicyConfig;
  envAllowlist?: string[];
  capabilityBinding: CapabilityBinding;
  clock: Clock;
  gitRunner: GitRunner;
  maxRepairRounds?: number;
  candidates: [CompetitiveCandidate, CompetitiveCandidate];
  budget: CompetitiveBudget;
}

export interface CandidateResult {
  provider: ProviderId;
  runId: string;
  report: WritableRunReport;
  score: number;
  scoreReason: string;
}

export interface CompetitiveResult {
  ran: boolean;
  reason: string;
  candidates: CandidateResult[];
  winner: ProviderId | null;
  /** The winner's re-derived governance record (the selection's evidence). */
  selectionDecision: GovernanceRecord | null;
  comparison: string[];
  merged: boolean;
}

/** Score a candidate from RE-DERIVED evidence (not narrative). Higher is better. */
function scoreCandidate(report: WritableRunReport): { score: number; reason: string } {
  if (report.reconciledTampered || report.gateTampered) {
    return { score: -100000, reason: "tampered (ledger/gate) — disqualified" };
  }
  const f = report.governance.inputs.findings;
  const findingPenalty = f.blocker * 100000 + f.critical * 10000 + f.major * 1000 + f.minor * 10 + f.observation;
  const passBonus = report.governance.verdict === "merge" ? 100000 : 0;
  // Smaller change wins ties (simplicity/maintainability proxy).
  const score = passBonus - findingPenalty - report.ledgerEntryCount;
  const reason = `verdict=${report.governance.verdict}, findings(b${f.blocker}/c${f.critical}/m${f.major}), ledger=${report.ledgerEntryCount}`;
  return { score, reason };
}

export async function runCompetitive(config: CompetitiveConfig): Promise<CompetitiveResult> {
  // Policy + budget gate (opt-in; enough budget for BOTH candidates).
  if (!config.budget.optIn) {
    return empty("competitive mode not opted in by policy");
  }
  if (config.budget.availableUnits < config.budget.requiredUnitsPerCandidate * 2) {
    return empty(
      `insufficient budget for competition: have ${config.budget.availableUnits}, need ${config.budget.requiredUnitsPerCandidate * 2}`
    );
  }

  const comparison: string[] = [];
  const results: CandidateResult[] = [];

  // Run each candidate in its OWN isolated worktree; the reviewer is the OTHER provider.
  for (const candidate of config.candidates) {
    const reviewer: ProviderId =
      candidate.provider === config.candidates[0].provider
        ? config.candidates[1].provider
        : config.candidates[0].provider;
    const report = await runWritableTask({
      baseRepoPath: config.baseRepoPath,
      stateRoot: config.stateRoot,
      runId: candidate.runId,
      taskId: config.taskId,
      owner: candidate.provider,
      reviewer,
      task: config.task,
      pathPolicy: config.pathPolicy,
      gates: config.gates,
      processRunner: config.processRunner,
      commandConfig: config.commandConfig,
      envAllowlist: config.envAllowlist,
      ownerImplement: candidate.ownerImplement,
      reviewerReview: candidate.reviewerReview,
      capabilityBinding: config.capabilityBinding,
      clock: config.clock,
      gitRunner: config.gitRunner,
      maxRepairRounds: config.maxRepairRounds,
      autoMerge: false,
      autoCleanup: false
    });
    const { score, reason } = scoreCandidate(report);
    results.push({ provider: candidate.provider, runId: candidate.runId, report, score, scoreReason: reason });
    comparison.push(`${candidate.provider}: ${reason} → score ${score}`);
  }

  // Selection by re-derived evidence: only a candidate whose governance says `merge`
  // can win; among those, the higher score.
  const eligible = results.filter((r) => r.report.governance.verdict === "merge").sort((a, b) => b.score - a.score);
  let winner: ProviderId | null = null;
  let selectionDecision: GovernanceRecord | null = null;
  let merged = false;

  if (eligible.length > 0) {
    const top = eligible[0];
    winner = top.provider;
    selectionDecision = top.report.governance;
    comparison.push(`selected ${winner} (governance verdict=merge, top score ${top.score})`);
    merged = await mergeWorktreeBranch(
      config.gitRunner,
      config.baseRepoPath,
      top.report.worktreePath,
      top.report.branch,
      `triforge (competitive: ${winner}): ${config.task}`
    );
  } else {
    comparison.push("no candidate reached a merge verdict — no selection");
  }

  // Cleanup BOTH candidate worktrees (the loser's evidence is preserved in its report).
  const wtm = new WorktreeManager({
    baseRepoPath: config.baseRepoPath,
    stateRoot: config.stateRoot,
    gitRunner: config.gitRunner,
    clock: config.clock
  });
  for (const r of results) {
    try {
      await wtm.cleanup(r.runId, config.taskId);
    } catch {
      /* best-effort cleanup */
    }
  }

  return {
    ran: true,
    reason: winner ? `selected ${winner}` : "no winner",
    candidates: results,
    winner,
    selectionDecision,
    comparison,
    merged
  };
}

function empty(reason: string): CompetitiveResult {
  return { ran: false, reason, candidates: [], winner: null, selectionDecision: null, comparison: [reason], merged: false };
}
