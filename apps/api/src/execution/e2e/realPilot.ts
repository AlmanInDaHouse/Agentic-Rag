/**
 * A10-W.7 — real cross-vendor pilot orchestrator.
 *
 * Runs the FULL writable pipeline (`runWritableTask`) end-to-end with a REAL owner
 * provider and a REAL cross-vendor reviewer, on a DISPOSABLE fixture repo — never the
 * TriForge working tree. It reuses the battle-tested A5 machinery (worktree, allowed-
 * path policy, role enforcer, mutation ledger, quality gates, repair loop, governance,
 * governed merge) and injects two real-provider callbacks:
 *
 *  - OWNER (writable): the real owner adapter runs with `cwd = worktree` and writes
 *    files DIRECTLY (codex --sandbox workspace-write / claude acceptEdits). After the
 *    run, each changed file is REPLAYED into the mutation ledger through the path/role-
 *    checked `ctx.write` (idempotent same-content write), so reconcile attributes the
 *    real writes to the owner. A write the path policy refuses (out of scope) is NOT
 *    recorded → it surfaces as ledger/diff tampering downstream and the governance gate
 *    blocks it. (Deletions are not replayable via ctx.write; the fixture tasks
 *    add/modify only — a documented W.7 scope limit.)
 *  - REVIEWER (read-only): the real cross-vendor reviewer adapter runs with `cwd =
 *    worktree`, inspects the owner's changes, and is asked for a strict final line
 *    `REVIEW_VERDICT: PASS` / `REVIEW_VERDICT: FAIL: <reason>`. The verdict + the real
 *    gate result become structured ReviewFindings (a failing gate or a FAIL verdict is a
 *    `major` finding → the repair loop engages; a reviewer write attempt is a `blocker`).
 *
 * The gate command (e.g. `npm test` → `node --test`) runs through the
 * `TrustedCommandRunner` (resolves the Windows `.cmd` shim for the trusted gate argv).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AgentExecutionRequestSchema,
  type CapabilityBinding,
  type CapabilitySnapshot,
  type ProviderId,
  type ReviewFindings
} from "@triforge/shared";
import { ManualClock } from "../../providers/clock.js";
import { createRealAdapter, WINDOWS_BASE_ENV_ALLOWLIST, type WritableProfile } from "../../providers/real/index.js";
import { buildReviewFindings, type RawReviewFinding } from "../../orchestration/reviewProtocol.js";
import { NodeGitRunner } from "../worktree/index.js";
import { computeWorktreeChanges } from "../ledger/index.js";
import { TrustedCommandRunner } from "../command/trustedCommandRunner.js";
import type { GateSpec } from "../gates/index.js";
import {
  runWritableTask,
  type OwnerContext,
  type ReviewContext,
  type WritableRunReport
} from "./writableRun.js";

export type ReviewerVerdict = "pass" | "fail" | "uncertain";

export interface RealPilotConfig {
  owner: ProviderId;
  reviewer: ProviderId;
  /** Disposable base git repo the worktree is cut from. */
  fixtureRepoPath: string;
  /** Disposable worktree state root (outside the base repo). */
  stateRoot: string;
  runId: string;
  /** The owner's task objective. */
  task: string;
  /** Workspace-relative prefixes the owner may write (e.g. ["src"]). */
  writePaths: string[];
  /** Quality gates (e.g. [{ name:"tests", command:{ bin:"npm", args:["test"] } }]). */
  gates: GateSpec[];
  ownerModel?: string | null;
  reviewerModel?: string | null;
  maxRepairRounds?: number;
  perRunTimeoutMs?: number;
}

export interface RealPilotResult {
  report: WritableRunReport;
  reviewerVerdict: ReviewerVerdict;
  /** Last ~300 chars of the reviewer's message (sanitized; for evidence). */
  reviewerTail: string;
  ownerEventCount: number;
  ownerWroteFiles: string[];
  ownerReviewerWriteRefused: string[];
}

const PILOT_BINDING: CapabilityBinding = {
  threat: ["T-INT-14", "T-CMP-06"],
  control: ["A10-W.2 path policy", "A10-W.4 Job Object", "A5.5 mutation ledger", "A5.8 governance"],
  milestone: "A10-W.7",
  verification: ["realPilot.host.test.ts"],
  recovery: "revert the worktree branch; the fixture base is disposable",
  residualRisk: "RR-4"
};

/** Run a single real cross-vendor pilot end-to-end on a disposable fixture repo. */
export async function runRealPilot(config: RealPilotConfig): Promise<RealPilotResult> {
  const clock = new ManualClock();
  const gitRunner = new NodeGitRunner();
  const gateRunner = new TrustedCommandRunner();
  const timeoutMs = config.perRunTimeoutMs ?? 240_000;

  // Observe the REAL owner capability snapshot once (a cheap version probe). Writable
  // authorization requires write === "yes" + matching version + worktree cwd.
  const ownerSnapshot = (await createRealAdapter(config.owner).getCapabilities()) as CapabilitySnapshot;

  let ownerEventCount = 0;
  const ownerWroteFiles = new Set<string>();
  const refusedReplays = new Set<string>();
  let reviewerVerdict: ReviewerVerdict = "uncertain";
  let reviewerTail = "";

  const ownerImplement = async (ctx: OwnerContext, round: number): Promise<void> => {
    const profile: WritableProfile = {
      observedCapability: ownerSnapshot,
      binding: PILOT_BINDING,
      worktreeRoot: ctx.worktreePath
    };
    const adapter = createRealAdapter(config.owner, { writableProfile: profile });
    const objective =
      round === 0
        ? config.task
        : `${config.task}\n\nThe quality gates are STILL FAILING. Inspect the failing test output and fix the implementation so every test passes. Change only what is necessary.`;
    const request = AgentExecutionRequestSchema.parse({
      executionId: `${config.runId}-owner-r${round}`,
      provider: config.owner,
      objective,
      cwd: ctx.worktreePath,
      readOnly: false,
      timeoutMs,
      ...(config.ownerModel ? { model: config.ownerModel } : {})
    });
    for await (const _event of adapter.execute(request)) {
      ownerEventCount += 1;
    }
    // Replay the provider's real writes into the ledger via the path/role-checked write.
    const changes = await computeWorktreeChanges(gitRunner, ctx.worktreePath);
    for (const change of changes) {
      if (change.status === "delete") {
        continue; // not replayable via ctx.write (documented scope limit)
      }
      const abs = path.join(ctx.worktreePath, change.relPath);
      let content: string | null = null;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        content = null;
      }
      if (content === null) {
        continue;
      }
      const written = await ctx.write(change.relPath, content, `owner ${config.owner} edit (round ${round})`);
      if (written.ok) {
        ownerWroteFiles.add(change.relPath);
      } else {
        refusedReplays.add(`${change.relPath}: ${written.reason ?? "denied"}`);
      }
    }
  };

  const reviewerReview = async (ctx: ReviewContext, gatesPassed: boolean): Promise<ReviewFindings> => {
    const adapter = createRealAdapter(config.reviewer); // read-only (no writable profile)
    const objective =
      `You are a cross-vendor reviewer. Review the code changes in this repository for correctness and ` +
      `completeness against the task: "${config.task}". The automated quality gates currently ` +
      `${gatesPassed ? "PASS" : "FAIL"}. Read the changed files, then end your response with EXACTLY one line: ` +
      `"REVIEW_VERDICT: PASS" if the change is correct and complete, or ` +
      `"REVIEW_VERDICT: FAIL: <one-line reason>" if there is a real defect. Do not modify any files.`;
    const request = AgentExecutionRequestSchema.parse({
      executionId: `${config.runId}-reviewer`,
      provider: config.reviewer,
      objective,
      cwd: ctx.worktreePath,
      readOnly: true,
      timeoutMs,
      ...(config.reviewerModel ? { model: config.reviewerModel } : {})
    });
    const texts: string[] = [];
    let wroteUnderReview = false;
    for await (const event of adapter.execute(request)) {
      if (event.type === "agent.message") {
        texts.push((event.payload as { text: string }).text);
      } else if (event.type === "file.changed") {
        wroteUnderReview = true;
      }
    }
    const full = texts.join("\n");
    reviewerTail = full.slice(-300);
    const match = /REVIEW_VERDICT:\s*(PASS|FAIL)([^\n]*)/i.exec(full);
    reviewerVerdict = match ? (match[1].toUpperCase() === "PASS" ? "pass" : "fail") : "uncertain";

    const raw: RawReviewFinding[] = [];
    if (wroteUnderReview) {
      raw.push({
        severity: "blocker",
        category: "unauthorized_write",
        evidence: `reviewer ${config.reviewer} emitted file.changed under a read-only review`,
        impact: "the cross-vendor reviewer must be strictly read-only",
        requiredAction: "block and keep the reviewer read-only",
        confidence: 0.99
      });
    }
    if (!gatesPassed) {
      raw.push({
        severity: "major",
        category: "failing_gate",
        evidence: "the quality gates failed against the owner's changes",
        impact: "the task is not complete until the gates pass",
        requiredAction: "repair the implementation",
        confidence: 0.9
      });
    }
    if (reviewerVerdict === "fail") {
      raw.push({
        severity: "major",
        category: "reviewer_defect",
        evidence: (match?.[2]?.replace(/^:\s*/, "").trim() || "the cross-vendor reviewer reported a defect").slice(0, 160),
        impact: "the cross-vendor reviewer flagged a real defect",
        requiredAction: "repair per the reviewer's finding",
        confidence: 0.8
      });
    }
    const summary =
      raw.length === 0
        ? `cross-vendor review by ${config.reviewer}: PASS (gates pass, no defect)`
        : `cross-vendor review by ${config.reviewer}: ${raw.length} finding(s)`;
    return buildReviewFindings(
      config.reviewer,
      summary,
      raw.length > 0
        ? raw
        : [
            {
              severity: "observation",
              category: "clean_review",
              evidence: "cross-vendor reviewer found no defect and the gates pass",
              impact: "none observed",
              requiredAction: "proceed to the governed merge",
              confidence: 0.7
            }
          ]
    );
  };

  const report = await runWritableTask({
    baseRepoPath: config.fixtureRepoPath,
    stateRoot: config.stateRoot,
    runId: config.runId,
    taskId: "t1",
    owner: config.owner,
    reviewer: config.reviewer,
    task: config.task,
    pathPolicy: {
      readPaths: ["."],
      writePaths: config.writePaths,
      blockedPaths: [],
      maxFilesChanged: 10
    },
    gates: config.gates,
    processRunner: gateRunner,
    // The gate command (npm/node) needs the Windows base env (PATH, ComSpec, SystemRoot,
    // …) to launch; credential-shaped names are still dropped by curateEnv (T-EXE-09).
    envAllowlist: [...WINDOWS_BASE_ENV_ALLOWLIST],
    ownerImplement,
    reviewerReview,
    capabilityBinding: PILOT_BINDING,
    clock,
    gitRunner,
    maxRepairRounds: config.maxRepairRounds ?? 2
  });

  return {
    report,
    reviewerVerdict,
    reviewerTail,
    ownerEventCount,
    ownerWroteFiles: [...ownerWroteFiles],
    ownerReviewerWriteRefused: [...refusedReplays]
  };
}
