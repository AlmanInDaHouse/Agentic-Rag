/**
 * Writable run orchestrator (A5.9) — wires the full writable-execution pipeline end to
 * end, composing every A5 piece over an isolated worktree (mandate §A5.9). This is the
 * MVP: TriForge completes a low-risk writable task with a single owner, a read-only
 * reviewer, a repair loop, quality gates, a re-derived GovernanceDecision and a
 * governed merge — real writes confined to an isolated worktree/branch, NEVER the live
 * tree or `main`.
 *
 * The owner and reviewer "intelligence" are INJECTED (mock providers in the E2E; real
 * adapters later), while the infrastructure is real: WorktreeManager (A5.1), allowed-
 * path policy (A5.2), command policy/supervisor (A5.3), owner/reviewer enforcement
 * (A5.4), mutation ledger + reconcile (A5.5), quality gates + tampering (A5.6), repair
 * loop (A5.7) and governance gate (A5.8). The owner can ONLY write through the
 * path/role-checked `write` on its context, so out-of-bounds writes are impossible.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CapabilityBinding, FindingsSummary, ProviderId, ReviewFindings, TestSummary } from "@triforge/shared";
import type { Clock } from "../../providers/clock.js";
import { WorktreeManager, type GitRunner } from "../worktree/index.js";
import { PathPolicyEngine, type AllowedPathPolicy } from "../path/index.js";
import { OwnershipRegistry, RoleEnforcer, type Actor } from "../role/index.js";
import { MutationLedger, computeWorktreeChanges, diffHash, reconcile } from "../ledger/index.js";
import { QualityGateRunner, detectGateTampering, type GateSpec } from "../gates/index.js";
import { RepairLoop, type GateOutcomeLite } from "../repair/index.js";
import { buildGovernanceDecision, type GovernanceRecord, type RepairTerminalState } from "../governance/index.js";
import { CommandPolicy, CommandSupervisor, type CommandPolicyConfig } from "../command/index.js";
import type { ProcessRunner } from "../../providers/real/processRunner.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A pipeline-stage event for the integrated runtime's live timeline (A10-W.8b). The
 *  orchestrator assigns sequence numbers and persists; this hook only reports. */
export interface WritableRunStageEvent {
  type: string;
  payload: Record<string, unknown>;
  provider?: ProviderId | null;
}
export type WritableRunEventSink = (event: WritableRunStageEvent) => void | Promise<void>;

export interface OwnerContext {
  worktreePath: string;
  /** Authorized write: role + path checked; writes the file and records the mutation. */
  write(relPath: string, content: string, reason: string): Promise<{ ok: boolean; reason?: string }>;
}

export interface ReviewContext {
  worktreePath: string;
  read(relPath: string): Promise<{ ok: boolean; content?: string; reason?: string }>;
}

export type OwnerImplement = (ctx: OwnerContext, round: number) => Promise<void>;
export type ReviewerReview = (ctx: ReviewContext, gatesPassed: boolean) => Promise<ReviewFindings>;

export interface WritableTaskConfig {
  baseRepoPath: string;
  stateRoot: string;
  runId: string;
  taskId: string;
  owner: ProviderId;
  reviewer: ProviderId;
  task: string;
  pathPolicy: AllowedPathPolicy;
  gates: GateSpec[];
  /** Process runner the worktree-bound command supervisor uses (Fake in the E2E). */
  processRunner: ProcessRunner;
  commandConfig?: CommandPolicyConfig;
  envAllowlist?: string[];
  ownerImplement: OwnerImplement;
  reviewerReview: ReviewerReview;
  capabilityBinding: CapabilityBinding;
  clock: Clock;
  gitRunner: GitRunner;
  maxRepairRounds?: number;
  /** Merge the worktree branch on a `merge` verdict. Default true; Competitive Mode
   *  (A7) sets false so the orchestrator merges only the winner. */
  autoMerge?: boolean;
  /** Clean up the worktree at the end. Default true; A7 keeps both candidates alive
   *  to compare, then cleans up itself. */
  autoCleanup?: boolean;
  /** Optional live-timeline sink (A10-W.8b). Emits pipeline milestones (worktree,
   *  repair rounds, gates, review, governance, merge, cleanup) as they happen; the
   *  owner/reviewer callbacks emit their own provider-level events. Never throws into
   *  the pipeline (errors are swallowed) — observability must not break execution. */
  onEvent?: WritableRunEventSink;
  /** Capture the worktree diff (vs HEAD) into the report before cleanup (A10-W.8b) so
   *  the UI diff/review panel has real content. Default false (the A5 E2E does not need it). */
  captureDiff?: boolean;
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface WritableRunReport {
  worktreePath: string;
  branch: string;
  repairState: RepairTerminalState;
  governance: GovernanceRecord;
  merged: boolean;
  mergeReason: string;
  ledgerEntryCount: number;
  reconciledTampered: boolean;
  gateTampered: boolean;
  cleanedUp: boolean;
  /** Populated only when `captureDiff` is set (A10-W.8b). */
  changedFiles: ChangedFile[];
  diffText: string | null;
}

const EMPTY_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };

function summariseFindings(findings: ReviewFindings): FindingsSummary {
  const s = { ...EMPTY_FINDINGS };
  for (const f of findings.findings) {
    s[f.severity] += 1;
  }
  return s;
}

/** Run the full writable pipeline for one task. */
export async function runWritableTask(config: WritableTaskConfig): Promise<WritableRunReport> {
  const wtm = new WorktreeManager({
    baseRepoPath: config.baseRepoPath,
    stateRoot: config.stateRoot,
    gitRunner: config.gitRunner,
    clock: config.clock
  });
  const emit: WritableRunEventSink = async (event) => {
    if (!config.onEvent) return;
    try {
      await config.onEvent(event);
    } catch {
      /* observability must never break execution */
    }
  };

  const handle = await wtm.create({ runId: config.runId, taskId: config.taskId });
  const worktreePath = handle.path;
  const branch = handle.metadata.branch;
  await emit({ type: "worktree.created", payload: { worktreePath, branch } });

  const ownership = new OwnershipRegistry({ clock: config.clock });
  ownership.acquire({ runId: config.runId, taskId: config.taskId }, config.owner);

  const pathPolicy = new PathPolicyEngine({ workspaceRoot: worktreePath, policy: config.pathPolicy, clock: config.clock });
  // Command policy + supervisor are bound to the worktree once it exists.
  const commandPolicy = new CommandPolicy({ workspaceRoot: worktreePath, config: config.commandConfig });
  const supervisor = new CommandSupervisor({
    policy: commandPolicy,
    runner: config.processRunner,
    clock: config.clock,
    envAllowlist: config.envAllowlist
  });
  const ledger = new MutationLedger({
    runId: config.runId,
    taskId: config.taskId,
    owner: config.owner,
    worktree: worktreePath,
    branch,
    clock: config.clock,
    ledgerPath: path.join(config.stateRoot, "ledgers", `${config.runId}-${config.taskId}.jsonl`)
  });

  // The command policy is the supervisor's; role gate composes path + (a permissive)
  // command policy view. We reuse the supervisor's policy indirectly via authorizeWrite
  // here, which only needs the path policy.
  const enforcer = new RoleEnforcer({
    unit: { runId: config.runId, taskId: config.taskId },
    ownership,
    pathPolicy,
    commandPolicy,
    clock: config.clock
  });

  const ownerActor: Actor = { id: config.owner, role: "owner" };
  const reviewerActor: Actor = { id: config.reviewer, role: "reviewer" };

  const ownerCtx: OwnerContext = {
    worktreePath,
    write: async (relPath, content, reason) => {
      const decision = enforcer.authorizeWrite(ownerActor, relPath);
      if (!decision.allowed) {
        return { ok: false, reason: decision.denyReason ?? "denied" };
      }
      const abs = decision.pathDecision?.realPath ?? path.join(worktreePath, relPath);
      let hashBefore: string | null = null;
      try {
        hashBefore = sha256(await fs.readFile(abs, "utf8"));
      } catch {
        hashBefore = null;
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
      await ledger.record({
        file: decision.pathDecision?.relPath ?? relPath,
        operation: hashBefore === null ? "create" : "modify",
        hashBefore,
        hashAfter: sha256(content),
        tool: config.owner,
        reason,
        policyDecisionRef: `role:${decision.role}`
      });
      return { ok: true };
    }
  };

  const reviewCtx: ReviewContext = {
    worktreePath,
    read: async (relPath) => {
      const decision = enforcer.authorizeRead(reviewerActor, relPath);
      if (!decision.allowed) {
        return { ok: false, reason: decision.denyReason ?? "denied" };
      }
      try {
        const content = await fs.readFile(decision.pathDecision?.realPath ?? path.join(worktreePath, relPath), "utf8");
        return { ok: true, content };
      } catch {
        return { ok: false, reason: "not_found" };
      }
    }
  };

  const gateRunner = new QualityGateRunner({
    supervisor,
    cwd: worktreePath,
    gates: config.gates,
    clock: config.clock
  });

  let lastFindings: ReviewFindings = { reviewer: config.reviewer, summary: "", findings: [] };
  let lastTampered = false;
  let lastReconTampered = false;

  const loop = new RepairLoop({
    clock: config.clock,
    limits: { maxRounds: config.maxRepairRounds ?? 3 },
    steps: {
      implement: async (round) => {
        await emit({ type: "repair.round.started", payload: { round }, provider: config.owner });
        await config.ownerImplement(ownerCtx, round);
        const changes = await computeWorktreeChanges(config.gitRunner, worktreePath);
        lastReconTampered = reconcile(ledger.entries(), changes).tampered;
        lastTampered = detectGateTampering(changes).tampered;
        await emit({
          type: "mutations.recorded",
          payload: {
            round,
            filesChanged: changes.map((c) => c.relPath),
            reconciledTampered: lastReconTampered,
            gateTampered: lastTampered
          },
          provider: config.owner
        });
        return {
          diffHash: diffHash(changes),
          filesChanged: changes.map((c) => c.relPath),
          commandCount: 0,
          outputBytes: 0
        };
      },
      runGates: async (): Promise<GateOutcomeLite> => {
        const result = await gateRunner.run();
        await emit({ type: "gates.completed", payload: { status: result.overallStatus } });
        return { overallStatus: result.overallStatus };
      },
      review: async (gates) => {
        const findings = await config.reviewerReview(reviewCtx, gates.overallStatus === "passed");
        // Surface integrity tampering as a blocker so the loop blocks on it.
        const withTamper: ReviewFindings =
          lastReconTampered || lastTampered
            ? {
                ...findings,
                findings: [
                  ...findings.findings,
                  {
                    severity: "blocker",
                    category: "integrity",
                    file: null,
                    line: null,
                    evidence: "ledger/gate tampering detected",
                    impact: "unattributed change",
                    requiredAction: "block",
                    missingTest: null,
                    confidence: 1
                  }
                ]
              }
            : findings;
        lastFindings = withTamper;
        await emit({
          type: "review.completed",
          payload: { summary: withTamper.summary, findings: summariseFindings(withTamper) },
          provider: config.reviewer
        });
        return withTamper;
      }
    }
  });

  const loopResult = await loop.run();

  // Re-derive the final evidence for the governance decision.
  const finalChanges = await computeWorktreeChanges(config.gitRunner, worktreePath);
  const finalDiffHash = diffHash(finalChanges);
  const reconciliation = reconcile(ledger.entries(), finalChanges);
  const tampering = detectGateTampering(finalChanges);
  const finalGate = await gateRunner.run();
  const tests: TestSummary = { passed: 0, failed: 0, skipped: 0, total: 0 };

  const governance = buildGovernanceDecision({
    task: config.task,
    specHash: sha256(config.task),
    acceptanceCriteria: [],
    contextHash: sha256(branch),
    owner: config.owner,
    reviewer: config.reviewer,
    worktree: worktreePath,
    branch,
    diffHash: finalDiffHash,
    ledgerHeadHash: ledger.headHash(),
    ledgerTampered: reconciliation.tampered,
    gateTampered: tampering.tampered,
    gatesPassed: finalGate.overallStatus === "passed",
    gateTestedDiffHash: finalDiffHash,
    gateResultHash: sha256(JSON.stringify(finalGate.gates)),
    findings: summariseFindings(lastFindings),
    tests,
    repairState: loopResult.state,
    repairRounds: loopResult.rounds,
    quota: null,
    unresolvedRisks: [],
    capabilityBinding: config.capabilityBinding
  });

  await emit({
    type: "governance.decided",
    payload: { verdict: governance.verdict, diffHash: finalDiffHash, repairState: loopResult.state }
  });

  const autoMerge = config.autoMerge ?? true;
  const autoCleanup = config.autoCleanup ?? true;
  let merged = false;
  let mergeReason = autoMerge ? `verdict=${governance.verdict}` : `verdict=${governance.verdict} (autoMerge off)`;
  if (autoMerge && governance.verdict === "merge") {
    merged = await commitAndMerge(config, worktreePath, branch);
    mergeReason = merged ? "governed merge completed" : "merge failed";
  }
  await emit({ type: merged ? "merge.completed" : "merge.skipped", payload: { merged, mergeReason, branch } });

  // Capture the diff (vs HEAD) before cleanup so the UI has real content (A10-W.8b).
  const changedFiles: ChangedFile[] = finalChanges.map((c) => ({ path: c.relPath, status: c.status }));
  let diffText: string | null = null;
  if (config.captureDiff) {
    try {
      const d = await config.gitRunner.run(["diff", "HEAD"], { cwd: worktreePath });
      diffText = d.code === 0 ? d.stdout : null;
    } catch {
      diffText = null;
    }
    await emit({ type: "diff.captured", payload: { changedFiles, hasPatch: diffText !== null } });
  }

  // Cleanup the worktree + branch (the change, if merged, is already on the base branch).
  // Competitive Mode keeps the worktree (autoCleanup=false) so it can compare candidates.
  let cleanedUp = false;
  if (autoCleanup) {
    cleanedUp = true;
    try {
      await wtm.cleanup(config.runId, config.taskId);
    } catch {
      cleanedUp = false;
    }
  }
  await emit({ type: "cleanup.completed", payload: { cleanedUp } });

  return {
    worktreePath,
    branch,
    repairState: loopResult.state,
    governance,
    merged,
    mergeReason,
    ledgerEntryCount: ledger.entries().length,
    reconciledTampered: reconciliation.tampered,
    gateTampered: tampering.tampered,
    cleanedUp,
    changedFiles,
    diffText
  };
}

/** Commit the owner's worktree changes on its branch, then merge into the base branch. */
async function commitAndMerge(config: WritableTaskConfig, worktreePath: string, branch: string): Promise<boolean> {
  return mergeWorktreeBranch(config.gitRunner, config.baseRepoPath, worktreePath, branch, `triforge: ${config.task}`);
}

/**
 * Commit a worktree's changes on its branch and merge it into the base branch via the
 * hardened GitRunner. Exported for Competitive Mode (A7), which merges only the winning
 * candidate. Returns true on a clean merge.
 */
export async function mergeWorktreeBranch(
  gitRunner: GitRunner,
  baseRepoPath: string,
  worktreePath: string,
  branch: string,
  message: string
): Promise<boolean> {
  const identity = ["-c", "user.email=triforge@local", "-c", "user.name=TriForge"];
  const add = await gitRunner.run(["add", "-A"], { cwd: worktreePath });
  if (add.code !== 0) {
    return false;
  }
  const commit = await gitRunner.run([...identity, "commit", "-m", message], { cwd: worktreePath });
  if (commit.code !== 0) {
    return false;
  }
  const merge = await gitRunner.run([...identity, "merge", "--no-ff", "--no-edit", branch], { cwd: baseRepoPath });
  return merge.code === 0;
}
