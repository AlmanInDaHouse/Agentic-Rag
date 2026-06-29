/**
 * Collaboration modes (A4.1–A4.3) + mode selection.
 *
 * A pure, deterministic collaboration runtime that coordinates PLANNING, CRITIQUE,
 * RESOLUTION and REVIEW between two providers — WITHOUT any real writes and WITHOUT
 * any real CLI execution. Every "execution" step is simulated by consuming a (mock,
 * in tests) adapter's normalized event stream to its terminal through the quota
 * manager; nothing on disk or in any process is ever mutated (writable execution is
 * A5, gated on the A0.5 capability binding).
 *
 * Three modes (mandate §16):
 *  - Specialist (default): owner plans → owner "executes" → self-review; the second
 *    provider participates ONLY when a recorded risk/policy trigger fires.
 *  - Pair: owner proposes → second provider critiques → strategy resolution → owner
 *    executes.
 *  - Full Debate: both providers produce independent plans → cross-review →
 *    agreements/disagreements → evidence-based resolution (StrategyDecision).
 *
 * Mode selection is driven by risk + uncertainty, then constrained by a budget check
 * that mirrors the quota spec's reserve logic: a mode the budget cannot fund AFTER
 * the implementation/review reserves are protected is downgraded (Full Debate → Pair
 * → Specialist), never selected silently.
 *
 * Provider-agnostic: the only provider-named values are `ProviderId` members; there
 * is no Codex/Claude-specific branching. Every produced stage is a validated A1
 * artifact (parsed with its Zod schema).
 */

import {
  AgentPlanSchema,
  CrossReviewSchema,
  type AgentPlan,
  type CrossReview,
  type ProviderAdapter,
  type ProviderEvent,
  type ProviderId,
  type ReviewFindings,
  type RoutingDecision,
  type StrategyDecision,
  type TaskProfile,
  type TaskSpecification
} from "@triforge/shared";
import {
  type ReservationPurpose,
  type QuotaManager
} from "../providers/quota/index.js";
import {
  runProviderStep,
  stepSucceeded,
  type CollaborationPhase,
  type ProviderStepRecord,
  type StepQuotaError
} from "./providerStep.js";
import {
  reviewFindingsFromEvents,
  severityGate,
  type SeverityGateResult
} from "./reviewProtocol.js";
import {
  AUTHORITY_ORDER,
  resolveStrategy,
  type AuthorityEvidence,
  type StrategyCandidate,
  type StrategyResolution
} from "./strategyResolution.js";
import { reviewerFor } from "./routing.js";

// --- public types --------------------------------------------------------

export type CollaborationMode = "specialist" | "pair" | "full_debate";

/** Per-phase capacity units a run consumes from a provider budget. */
export interface CollaborationCosts {
  planning?: number;
  implementation?: number;
  review?: number;
}

interface ResolvedCosts {
  planning: number;
  implementation: number;
  review: number;
}

/** Input to a collaboration run. Adapters are mocks in tests; never real in A4. */
export interface CollaborationContext {
  profile: TaskProfile;
  spec: TaskSpecification;
  /** Owner selection result (see `routing.ts`). `assignedOwner` is the owner. */
  routing: RoutingDecision;
  /** One adapter per provider. Mock adapters in tests; A4 never runs a real CLI. */
  adapters: Record<ProviderId, ProviderAdapter>;
  quota: QuotaManager;
  /** The two providers in priority order. Defaults to `["codex", "claude"]`. */
  providers?: readonly [ProviderId, ProviderId];
  costs?: CollaborationCosts;
  /** Objective string for execution requests. Defaults to `spec.objective`. */
  objective?: string;
  /** Authority-order evidence for strategy resolution (Pair / Full Debate). */
  authorityEvidence?: AuthorityEvidence;
  /** Informational per-provider plan confidence (0..1). Never a tiebreaker. */
  planConfidence?: Partial<Record<ProviderId, number>>;
  /** Explicit uncertainty (0..1). Defaults to a value derived from the profile. */
  uncertainty?: number;
  /** Force a mode (human opt-in). Bypasses risk/uncertainty selection. */
  forcedMode?: CollaborationMode;
}

export interface ModeSelection {
  mode: CollaborationMode;
  /** What risk + uncertainty alone selected, before the budget check. */
  requestedMode: CollaborationMode;
  uncertainty: number;
  reason: string[];
  /** True when the requested mode was downgraded because the budget could not fund it. */
  budgetConstrained: boolean;
  /** True when a human forced the mode. */
  humanForced: boolean;
  /**
   * True when selection itself requires a human decision: an escalation-triggered task
   * (risk high/critical, behavioral preservation, or uncertainty ≥ 0.6) whose MANDATORY
   * reviewer review cannot be funded. The run pauses before any step rather than
   * downgrading to a cheaper mode that would only halt later (consistent with the
   * `routing.ts` critical posture).
   */
  humanApprovalRequired: boolean;
}

export type CollaborationStatus = "completed" | "halted" | "paused";

export interface CollaborationHalt {
  phase: CollaborationPhase;
  provider: ProviderId;
  reason: string;
  /** Present when a quota gate / reserve blocked the step (adapter never ran). */
  quotaError: StepQuotaError | null;
  /** Present when a step ran but did not complete cleanly. */
  failedResultStatus: string | null;
}

export interface CollaborationRunResult {
  mode: CollaborationMode;
  modeSelection: ModeSelection;
  routing: RoutingDecision;
  taskProfile: TaskProfile;
  owner: ProviderId;
  reviewer: ProviderId;
  /** 1 plan (Specialist/Pair) or 2 plans (Full Debate). */
  plans: AgentPlan[];
  crossReviews: CrossReview[];
  reviewFindings: ReviewFindings[];
  /** The resolved strategy (Pair / Full Debate); null for Specialist. */
  strategyDecision: StrategyDecision | null;
  /** The full strategy resolution (records the deciding authority source). */
  strategyResolution: StrategyResolution | null;
  /** Severity gate over all findings (null when no review happened). */
  severityGate: SeverityGateResult | null;
  steps: ProviderStepRecord[];
  secondProviderInvoked: boolean;
  secondProviderTrigger: string | null;
  status: CollaborationStatus;
  halt: CollaborationHalt | null;
}

const DEFAULT_PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];
const DEFAULT_COSTS: ResolvedCosts = { planning: 1, implementation: 1, review: 1 };
const DEBATE_TASK_KINDS = /architecture|security|migration/i;
const DEFAULT_OWNER_CONFIDENCE = 0.7;
const DEFAULT_REVIEWER_CONFIDENCE = 0.65;

// --- uncertainty + triggers ---------------------------------------------

/**
 * Derive an uncertainty score (0..1) from the task profile. By runtime convention
 * `reasoningDepthRequired` is treated as a normalized 0..1 signal; values outside
 * the range saturate. An explicit override always wins.
 */
export function deriveUncertainty(profile: TaskProfile, override?: number): number {
  if (override !== undefined) {
    return clamp01(override);
  }
  return clamp01(profile.reasoningDepthRequired);
}

function debateTriggers(profile: TaskProfile, uncertainty: number): string[] {
  const reasons: string[] = [];
  if (DEBATE_TASK_KINDS.test(profile.taskKind)) {
    reasons.push(`taskKind "${profile.taskKind}" (architecture/security/migration) requires Full Debate`);
  }
  if (profile.risk === "critical") {
    reasons.push("critical risk requires Full Debate");
  }
  if (profile.blastRadius === "repository" || profile.blastRadius === "package") {
    reasons.push(`high blast radius (${profile.blastRadius}) requires Full Debate`);
  }
  if (uncertainty >= 0.7) {
    reasons.push(`high uncertainty (${uncertainty.toFixed(2)}) requires Full Debate`);
  }
  return reasons;
}

function pairTriggers(profile: TaskProfile, uncertainty: number): string[] {
  const reasons: string[] = [];
  if (profile.risk === "high") {
    reasons.push("high risk warrants Pair");
  }
  if (profile.complexity === "high") {
    reasons.push("high complexity warrants Pair");
  }
  if (profile.behavioralPreservationRequired) {
    reasons.push("behavioral preservation required → Pair");
  }
  if (uncertainty >= 0.4) {
    reasons.push(`moderate uncertainty (${uncertainty.toFixed(2)}) warrants Pair`);
  }
  return reasons;
}

// --- mode selection ------------------------------------------------------

export interface ModeSelectionInput {
  profile: TaskProfile;
  routing: RoutingDecision;
  quota: QuotaManager;
  providers?: readonly [ProviderId, ProviderId];
  costs?: CollaborationCosts;
  uncertainty?: number;
  forcedMode?: CollaborationMode;
}

/**
 * Select a collaboration mode from risk + uncertainty, then constrain it by a
 * first-reservation feasibility probe that mirrors the reserve logic (a mode the budget
 * cannot fund AFTER the implementation/review reserves are protected is downgraded,
 * never silent). Exception (M1): when an escalation-triggered task cannot fund the
 * MANDATORY reviewer review, selection does not downgrade to a doomed cheaper mode —
 * it sets `humanApprovalRequired` so the run pauses for a human decision.
 */
export function selectMode(input: ModeSelectionInput): ModeSelection {
  const uncertainty = deriveUncertainty(input.profile, input.uncertainty);

  if (input.forcedMode) {
    return {
      mode: input.forcedMode,
      requestedMode: input.forcedMode,
      uncertainty,
      reason: [`mode forced to "${input.forcedMode}" by human opt-in`],
      budgetConstrained: false,
      humanForced: true,
      humanApprovalRequired: false
    };
  }

  const providers = input.providers ?? DEFAULT_PROVIDERS;
  const costs = resolveCosts(input.costs);
  const owner = input.routing.assignedOwner;
  const reviewer = reviewerFor(owner, providers);

  const dTriggers = debateTriggers(input.profile, uncertainty);
  const pTriggers = pairTriggers(input.profile, uncertainty);

  let requestedMode: CollaborationMode;
  const reason: string[] = [];
  if (dTriggers.length > 0) {
    requestedMode = "full_debate";
    reason.push(...dTriggers);
  } else if (pTriggers.length > 0) {
    requestedMode = "pair";
    reason.push(...pTriggers);
  } else {
    requestedMode = "specialist";
    reason.push(`clear ${input.profile.risk}-risk task → Specialist (economical default)`);
  }

  // First-reservation feasibility probe: each provider must be able to fund the FIRST
  // reservation it would make in the mode WITHOUT breaching the protected
  // implementation/review reserves. This is a probe (the first reservation per
  // provider), not a full per-mode cost profile — a later step can still hit the
  // per-step quota gate; that is handled by `runProviderStep`.
  const feasibleDebate =
    input.quota.canReserve(owner, costs.planning, "planning") &&
    input.quota.canReserve(reviewer, costs.planning, "planning");
  const feasiblePair =
    input.quota.canReserve(owner, costs.planning, "planning") &&
    input.quota.canReserve(reviewer, costs.review, "review");

  // An escalation-triggered task forces a MANDATORY reviewer review in EVERY mode
  // (Pair/Full Debate always cross-review; Specialist escalates per
  // `specialistEscalation`). If that reviewer review cannot be funded, no cheaper mode
  // can complete — downgrading would only halt later.
  const escalates = specialistEscalation(input.profile, uncertainty) !== null;
  const reviewerCanFundReview = input.quota.canReserve(reviewer, costs.review, "review");

  let mode = requestedMode;
  let budgetConstrained = false;
  let humanApprovalRequired = false;

  if (mode === "full_debate" && !feasibleDebate) {
    mode = "pair";
    budgetConstrained = true;
    reason.push("budget cannot fund Full Debate after reserves are protected → downgraded to Pair");
  }
  if (mode === "pair" && !feasiblePair) {
    if (escalates && !reviewerCanFundReview) {
      // M1: do NOT silently downgrade to a mode that will halt. The mandatory reviewer
      // review is the very reservation that just proved unfundable — pause for a human
      // decision instead of picking a doomed cheaper mode (mirrors the critical-routing
      // posture in routing.ts).
      humanApprovalRequired = true;
      reason.push(
        `escalation-triggered task cannot fund the mandatory reviewer review on ${reviewer}; ` +
          `not downgrading to a mode that will halt — human approval required`
      );
    } else {
      mode = "specialist";
      budgetConstrained = true;
      reason.push("budget cannot fund Pair after reserves are protected → downgraded to Specialist");
    }
  }

  return {
    mode,
    requestedMode,
    uncertainty,
    reason,
    budgetConstrained,
    humanForced: false,
    humanApprovalRequired
  };
}

// --- top-level dispatcher ------------------------------------------------

/**
 * Run a collaboration: select the mode (unless forced), then dispatch. A shared
 * pre-flight (`preflightPause`, also run by every mode runner) PAUSES the run without
 * executing any step — and therefore without any simulated write — when routing
 * requires a human (e.g. a critical task whose preferred owner is unusable) OR when
 * mode selection requires a human (an escalation-triggered task that cannot fund the
 * mandatory reviewer review; see `selectMode`).
 */
export async function runCollaboration(context: CollaborationContext): Promise<CollaborationRunResult> {
  const ctx = normalizeContext(context);
  const owner = ctx.routing.assignedOwner;
  const reviewer = reviewerFor(owner, ctx.providers);

  const selection = selectMode({
    profile: ctx.profile,
    routing: ctx.routing,
    quota: ctx.quota,
    providers: ctx.providers,
    costs: ctx.costs,
    uncertainty: ctx.uncertainty,
    forcedMode: ctx.forcedMode
  });

  const paused = preflightPause(ctx, selection, selection.mode, owner, reviewer);
  if (paused) {
    return paused;
  }

  switch (selection.mode) {
    case "full_debate":
      return runFullDebate(ctx, selection);
    case "pair":
      return runPair(ctx, selection);
    default:
      return runSpecialist(ctx, selection);
  }
}

// --- internal normalized context ----------------------------------------

interface RuntimeContext {
  profile: TaskProfile;
  spec: TaskSpecification;
  routing: RoutingDecision;
  adapters: Record<ProviderId, ProviderAdapter>;
  quota: QuotaManager;
  providers: readonly [ProviderId, ProviderId];
  costs: ResolvedCosts;
  objective: string;
  authorityEvidence: AuthorityEvidence;
  planConfidence: Partial<Record<ProviderId, number>>;
  uncertainty?: number;
  forcedMode?: CollaborationMode;
}

function normalizeContext(context: CollaborationContext): RuntimeContext {
  return {
    profile: context.profile,
    spec: context.spec,
    routing: context.routing,
    adapters: context.adapters,
    quota: context.quota,
    providers: context.providers ?? DEFAULT_PROVIDERS,
    costs: resolveCosts(context.costs),
    objective: context.objective ?? context.spec.objective,
    authorityEvidence: context.authorityEvidence ?? {},
    planConfidence: context.planConfidence ?? {},
    uncertainty: context.uncertainty,
    forcedMode: context.forcedMode
  };
}

// --- the three modes -----------------------------------------------------

/** Specialist: single owner; the second provider only on a recorded trigger. */
export async function runSpecialist(
  context: CollaborationContext,
  selection?: ModeSelection
): Promise<CollaborationRunResult> {
  const ctx = normalizeContext(context);
  const sel = selection ?? specialistSelection(ctx);
  const owner = ctx.routing.assignedOwner;
  const reviewer = reviewerFor(owner, ctx.providers);
  const paused = preflightPause(ctx, sel, "specialist", owner, reviewer);
  if (paused) {
    return paused;
  }
  const result = emptyResult(ctx, "specialist", sel, owner, reviewer);
  const step = makeStepRunner(ctx);

  // 1. Owner produces a plan.
  const planStep = await step({ provider: owner, purpose: "planning", amount: ctx.costs.planning, phase: "plan" });
  result.steps.push(planStep);
  if (!stepSucceeded(planStep)) {
    return haltWith(result, planStep, "owner planning did not complete");
  }
  result.plans.push(buildAgentPlan(owner, ctx, planStep.events));

  // 2. Owner "executes" (simulated via the event stream; read-only, no real write).
  const execStep = await step({
    provider: owner,
    purpose: "implementation",
    amount: ctx.costs.implementation,
    phase: "execute"
  });
  result.steps.push(execStep);
  if (!stepSucceeded(execStep)) {
    return haltWith(result, execStep, "owner execution did not complete");
  }

  // 3. Self-review.
  result.reviewFindings.push(
    reviewFindingsFromEvents(owner, execStep.events, { kind: "self", target: `${owner} implementation` })
  );

  // 4. Conditional second provider (cross-vendor review on a recorded trigger only).
  const trigger = specialistEscalation(ctx.profile, sel.uncertainty);
  if (trigger) {
    const reviewStep = await step({ provider: reviewer, purpose: "review", amount: ctx.costs.review, phase: "review" });
    result.steps.push(reviewStep);
    if (!stepSucceeded(reviewStep)) {
      return haltWith(result, reviewStep, "cross-vendor review did not complete");
    }
    result.secondProviderInvoked = true;
    result.secondProviderTrigger = trigger;
    result.crossReviews.push(buildCrossReview(reviewer, owner, ctx, reviewStep.events));
    result.reviewFindings.push(
      reviewFindingsFromEvents(reviewer, reviewStep.events, { kind: "cross", target: `${owner} implementation` })
    );
  }

  return finalize(result);
}

/** Pair: owner proposes → reviewer critiques → resolution → owner executes. */
export async function runPair(
  context: CollaborationContext,
  selection?: ModeSelection
): Promise<CollaborationRunResult> {
  const ctx = normalizeContext(context);
  const sel = selection ?? { ...specialistSelection(ctx), mode: "pair", requestedMode: "pair" };
  const owner = ctx.routing.assignedOwner;
  const reviewer = reviewerFor(owner, ctx.providers);
  const paused = preflightPause(ctx, sel, "pair", owner, reviewer);
  if (paused) {
    return paused;
  }
  const result = emptyResult(ctx, "pair", sel, owner, reviewer);
  const step = makeStepRunner(ctx);

  // 1. Owner proposes a plan.
  const planStep = await step({ provider: owner, purpose: "planning", amount: ctx.costs.planning, phase: "plan" });
  result.steps.push(planStep);
  if (!stepSucceeded(planStep)) {
    return haltWith(result, planStep, "owner proposal did not complete");
  }
  result.plans.push(buildAgentPlan(owner, ctx, planStep.events));

  // 2. Second provider critiques.
  const critiqueStep = await step({ provider: reviewer, purpose: "review", amount: ctx.costs.review, phase: "critique" });
  result.steps.push(critiqueStep);
  if (!stepSucceeded(critiqueStep)) {
    return haltWith(result, critiqueStep, "critique did not complete");
  }
  result.secondProviderInvoked = true;
  result.secondProviderTrigger = "pair mode: second provider always critiques";
  result.crossReviews.push(buildCrossReview(reviewer, owner, ctx, critiqueStep.events));
  result.reviewFindings.push(
    reviewFindingsFromEvents(reviewer, critiqueStep.events, { kind: "cross", target: `${owner} plan` })
  );

  // A4.4 severity gate (ENFORCED): no execution proceeds with an open blocker/critical
  // finding. Evaluate after the critique stage and HALT before the simulated execute
  // step (spec §A4.4 / Vision §15). The A5 merge gate builds on this.
  const critiqueGate = severityGate(result.reviewFindings.flatMap((findings) => findings.findings));
  if (!critiqueGate.passed) {
    return haltOnSeverityGate(result, critiqueGate, "critique", reviewer);
  }

  // 3. Resolution (authority order; never majority).
  const candidates: StrategyCandidate[] = [
    {
      id: "owner_plan",
      proposedBy: owner,
      summary: `Proceed with ${owner}'s plan`,
      confidence: confidenceFor(ctx, owner, DEFAULT_OWNER_CONFIDENCE)
    },
    {
      id: "reviewer_revision",
      proposedBy: reviewer,
      summary: `Revise per ${reviewer}'s critique`,
      confidence: confidenceFor(ctx, reviewer, DEFAULT_REVIEWER_CONFIDENCE)
    }
  ];
  const resolution = resolveWith(ctx, candidates, "owner_plan");
  result.strategyDecision = resolution.decision;
  result.strategyResolution = resolution;

  // 4. Owner executes (simulated, read-only).
  const execStep = await step({
    provider: owner,
    purpose: "implementation",
    amount: ctx.costs.implementation,
    phase: "execute"
  });
  result.steps.push(execStep);
  if (!stepSucceeded(execStep)) {
    return haltWith(result, execStep, "owner execution did not complete");
  }
  result.reviewFindings.push(
    reviewFindingsFromEvents(owner, execStep.events, { kind: "self", target: `${owner} implementation` })
  );

  return finalize(result);
}

/** Full Debate: independent plans → cross-review → evidence-based resolution. */
export async function runFullDebate(
  context: CollaborationContext,
  selection?: ModeSelection
): Promise<CollaborationRunResult> {
  const ctx = normalizeContext(context);
  const sel = selection ?? { ...specialistSelection(ctx), mode: "full_debate", requestedMode: "full_debate" };
  const owner = ctx.routing.assignedOwner;
  const reviewer = reviewerFor(owner, ctx.providers);
  const paused = preflightPause(ctx, sel, "full_debate", owner, reviewer);
  if (paused) {
    return paused;
  }
  const result = emptyResult(ctx, "full_debate", sel, owner, reviewer);
  // `secondProviderInvoked` is set from the ACTUAL reviewer step outcome below, not
  // optimistically here (a blocked/failed reviewer step never "invoked" it).
  const step = makeStepRunner(ctx);

  // 1. Independent plans.
  const planOwner = await step({ provider: owner, purpose: "planning", amount: ctx.costs.planning, phase: "plan" });
  result.steps.push(planOwner);
  if (!stepSucceeded(planOwner)) {
    return haltWith(result, planOwner, "owner plan did not complete");
  }
  result.plans.push(buildAgentPlan(owner, ctx, planOwner.events));

  const planReviewer = await step({ provider: reviewer, purpose: "planning", amount: ctx.costs.planning, phase: "plan" });
  result.steps.push(planReviewer);
  if (!stepSucceeded(planReviewer)) {
    return haltWith(result, planReviewer, "second provider plan did not complete");
  }
  // L5: the reviewer step actually ran and succeeded → the second provider was invoked.
  result.secondProviderInvoked = true;
  result.secondProviderTrigger = "full debate: both providers participate";
  result.plans.push(buildAgentPlan(reviewer, ctx, planReviewer.events));

  // 2. Cross-review (each provider reviews the other's plan).
  const crByOwner = await step({ provider: owner, purpose: "review", amount: ctx.costs.review, phase: "review" });
  result.steps.push(crByOwner);
  if (!stepSucceeded(crByOwner)) {
    return haltWith(result, crByOwner, "owner cross-review did not complete");
  }
  result.crossReviews.push(buildCrossReview(owner, reviewer, ctx, crByOwner.events));
  result.reviewFindings.push(
    reviewFindingsFromEvents(owner, crByOwner.events, { kind: "cross", target: `${reviewer} plan` })
  );

  const crByReviewer = await step({ provider: reviewer, purpose: "review", amount: ctx.costs.review, phase: "review" });
  result.steps.push(crByReviewer);
  if (!stepSucceeded(crByReviewer)) {
    return haltWith(result, crByReviewer, "second provider cross-review did not complete");
  }
  result.crossReviews.push(buildCrossReview(reviewer, owner, ctx, crByReviewer.events));
  result.reviewFindings.push(
    reviewFindingsFromEvents(reviewer, crByReviewer.events, { kind: "cross", target: `${owner} plan` })
  );

  // A4.4 severity gate (ENFORCED): no execution proceeds with an open blocker/critical
  // finding. Evaluate after the cross-review stage and HALT before the simulated execute
  // step (spec §A4.4 / Vision §15). The A5 merge gate builds on this.
  const crossReviewGate = severityGate(result.reviewFindings.flatMap((findings) => findings.findings));
  if (!crossReviewGate.passed) {
    return haltOnSeverityGate(result, crossReviewGate, "review", reviewer);
  }

  // 3. Evidence-based resolution over the two independent plans (authority order).
  const candidates: StrategyCandidate[] = [
    {
      id: `plan:${owner}`,
      proposedBy: owner,
      summary: `Adopt ${owner}'s plan`,
      confidence: confidenceFor(ctx, owner, DEFAULT_OWNER_CONFIDENCE)
    },
    {
      id: `plan:${reviewer}`,
      proposedBy: reviewer,
      summary: `Adopt ${reviewer}'s plan`,
      confidence: confidenceFor(ctx, reviewer, DEFAULT_REVIEWER_CONFIDENCE)
    }
  ];
  const resolution = resolveWith(ctx, candidates, `plan:${owner}`);
  result.strategyDecision = resolution.decision;
  result.strategyResolution = resolution;

  // 4. Resolved owner executes (simulated, read-only).
  const execStep = await step({
    provider: owner,
    purpose: "implementation",
    amount: ctx.costs.implementation,
    phase: "execute"
  });
  result.steps.push(execStep);
  if (!stepSucceeded(execStep)) {
    return haltWith(result, execStep, "owner execution did not complete");
  }
  result.reviewFindings.push(
    reviewFindingsFromEvents(owner, execStep.events, { kind: "self", target: `${owner} implementation` })
  );

  return finalize(result);
}

// --- shared helpers ------------------------------------------------------

interface StepArgs {
  provider: ProviderId;
  purpose: ReservationPurpose;
  amount: number;
  phase: CollaborationPhase;
}

function makeStepRunner(ctx: RuntimeContext): (args: StepArgs) => Promise<ProviderStepRecord> {
  const counter = { seq: 0 };
  return (args: StepArgs) => {
    counter.seq += 1;
    const executionId = `a4-${args.phase}-${args.provider}-${counter.seq}`;
    return runProviderStep({
      adapter: ctx.adapters[args.provider],
      quota: ctx.quota,
      provider: args.provider,
      purpose: args.purpose,
      amount: args.amount,
      phase: args.phase,
      objective: ctx.objective,
      executionId
    });
  };
}

/** When the second provider participates in Specialist: a recorded trigger or null. */
export function specialistEscalation(profile: TaskProfile, uncertainty: number): string | null {
  if (profile.risk === "critical") {
    return "risk=critical requires a cross-vendor review";
  }
  if (profile.risk === "high") {
    return "risk=high requires a cross-vendor review";
  }
  if (profile.behavioralPreservationRequired) {
    return "behavioral preservation requires a cross-vendor review";
  }
  if (uncertainty >= 0.6) {
    return `uncertainty ${uncertainty.toFixed(2)} requires a cross-vendor review`;
  }
  return null;
}

function specialistSelection(ctx: RuntimeContext): ModeSelection {
  const uncertainty = deriveUncertainty(ctx.profile, ctx.uncertainty);
  return {
    mode: "specialist",
    requestedMode: "specialist",
    uncertainty,
    reason: ["direct mode invocation"],
    budgetConstrained: false,
    humanForced: false,
    humanApprovalRequired: false
  };
}

/**
 * Shared pre-flight used by `runCollaboration` AND every mode runner so a DIRECT mode
 * call honors the same pause posture as the dispatcher: when routing OR mode selection
 * requires a human decision, the run PAUSES before any step (no execution, no simulated
 * write). Returns a paused result, or null when the run may proceed.
 */
function preflightPause(
  ctx: RuntimeContext,
  selection: ModeSelection,
  mode: CollaborationMode,
  owner: ProviderId,
  reviewer: ProviderId
): CollaborationRunResult | null {
  const routingPause = ctx.routing.humanApprovalRequired;
  const selectionPause = selection.humanApprovalRequired;
  if (!routingPause && !selectionPause) {
    return null;
  }
  const paused = emptyResult(ctx, mode, selection, owner, reviewer);
  paused.status = "paused";
  paused.halt = {
    phase: "plan",
    provider: owner,
    reason: selectionPause
      ? `mode selection requires human approval (escalation-triggered task cannot fund the ` +
        `mandatory reviewer review on ${reviewer}); run paused before any step ` +
        `(no execution, no writes)`
      : "routing requires human approval; run paused before any step (no execution, no writes)",
    quotaError: null,
    failedResultStatus: null
  };
  return paused;
}

function buildAgentPlan(owner: ProviderId, ctx: RuntimeContext, events: ProviderEvent[]): AgentPlan {
  const planSteps = planStepsFromEvents(events);
  let steps: { index: number; description: string; expectedOutcome: string | null }[];
  if (planSteps.length > 0) {
    steps = planSteps.map((planStep, index) => ({
      index,
      description: planStep.title,
      expectedOutcome: ctx.spec.acceptanceCriteria[index] ?? null
    }));
  } else {
    const criteria =
      ctx.spec.acceptanceCriteria.length > 0 ? ctx.spec.acceptanceCriteria : [ctx.spec.objective];
    steps = criteria.map((criterion, index) => ({
      index,
      description: `Address: ${criterion}`,
      expectedOutcome: criterion
    }));
  }
  return AgentPlanSchema.parse({
    owner,
    rationale:
      `Plan by ${owner} for "${ctx.spec.objective}" ` +
      `(risk=${ctx.profile.risk}, complexity=${ctx.profile.complexity}, blastRadius=${ctx.profile.blastRadius}).`,
    steps
  });
}

function planStepsFromEvents(events: ProviderEvent[]): { title: string; status: string }[] {
  let steps: { title: string; status: string }[] = [];
  for (const event of events) {
    if (event.type === "plan.updated") {
      steps = (event.payload as { steps: { title: string; status: string }[] }).steps;
    }
  }
  return steps;
}

function buildCrossReview(
  reviewer: ProviderId,
  targetOwner: ProviderId,
  ctx: RuntimeContext,
  events: ProviderEvent[]
): CrossReview {
  const agreement = agreementFromEvents(events);
  const verb = agreement === "agree" ? "concurs with" : agreement === "disagree" ? "objects to" : "is uncertain about";
  return CrossReviewSchema.parse({
    reviewer,
    target: `plan:${targetOwner}`,
    findings: [
      {
        summary: `${reviewer} ${verb} ${targetOwner}'s plan for "${ctx.spec.objective}"`,
        agreement,
        detail: `Derived from the read-only ${reviewer} review stream (terminal + warnings/file-change signals).`
      }
    ]
  });
}

function agreementFromEvents(events: ProviderEvent[]): "agree" | "disagree" | "uncertain" {
  const failed = events.some((event) => event.type === "run.failed");
  const wroteUnderReview = events.some((event) => event.type === "file.changed");
  const warned = events.some((event) => event.type === "warning.raised");
  if (failed || wroteUnderReview) {
    return "disagree";
  }
  if (warned) {
    return "uncertain";
  }
  return "agree";
}

function resolveWith(
  ctx: RuntimeContext,
  candidates: StrategyCandidate[],
  defaultWinnerId: string
): StrategyResolution {
  const ids = new Set(candidates.map((candidate) => candidate.id));
  if (hasUsableRuling(ctx.authorityEvidence, ids)) {
    return resolveStrategy({ candidates, evidence: ctx.authorityEvidence });
  }
  // L4: no real authority evidence was supplied. Synthesize a NON-BINDING default that
  // grounds the assigned owner's option, but mark it `defaulted` and make the rationale
  // explicit so the StrategyDecision audit trail never claims a real spec ruling decided
  // the conflict. (Still authority-keyed, never agent majority.)
  const resolution = resolveStrategy({
    candidates,
    evidence: {
      spec: {
        supports: defaultWinnerId,
        rationale:
          `No authority evidence was supplied for this conflict; defaulting to the owner ` +
          `option grounded in the spec objective "${ctx.spec.objective}" ` +
          `(synthesized default, NOT a real spec ruling)`
      }
    }
  });
  return { ...resolution, defaulted: true };
}

function hasUsableRuling(evidence: AuthorityEvidence, ids: Set<string>): boolean {
  for (const source of AUTHORITY_ORDER) {
    const ruling = evidence[source];
    if (ruling && ids.has(ruling.supports)) {
      return true;
    }
  }
  return false;
}

function confidenceFor(ctx: RuntimeContext, provider: ProviderId, fallback: number): number {
  return clamp01(ctx.planConfidence[provider] ?? fallback);
}

function emptyResult(
  ctx: RuntimeContext,
  mode: CollaborationMode,
  selection: ModeSelection,
  owner: ProviderId,
  reviewer: ProviderId
): CollaborationRunResult {
  return {
    mode,
    modeSelection: selection,
    routing: ctx.routing,
    taskProfile: ctx.profile,
    owner,
    reviewer,
    plans: [],
    crossReviews: [],
    reviewFindings: [],
    strategyDecision: null,
    strategyResolution: null,
    severityGate: null,
    steps: [],
    secondProviderInvoked: false,
    secondProviderTrigger: null,
    status: "completed",
    halt: null
  };
}

function haltWith(
  result: CollaborationRunResult,
  step: ProviderStepRecord,
  reason: string
): CollaborationRunResult {
  result.status = "halted";
  result.halt = {
    phase: step.phase,
    provider: step.provider,
    reason: step.blocked
      ? `${reason}: blocked by quota gate (${step.quotaError?.code ?? "unknown"})`
      : `${reason}: ${step.result?.status ?? "no terminal"}`,
    quotaError: step.quotaError,
    failedResultStatus: step.result?.status ?? null
  };
  // Still attach the severity gate over whatever review findings exist.
  if (result.reviewFindings.length > 0) {
    result.severityGate = severityGate(result.reviewFindings.flatMap((findings) => findings.findings));
  }
  return result;
}

/**
 * Halt a mode because the ENFORCED severity gate failed: an open blocker/critical
 * finding means no execution may proceed (spec §A4.4 / Vision §15). Records the gate
 * result and the blocking findings as the halt reason. No step failed here — the gate
 * itself stopped the run BEFORE the simulated execute step.
 */
function haltOnSeverityGate(
  result: CollaborationRunResult,
  gate: SeverityGateResult,
  phase: CollaborationPhase,
  provider: ProviderId
): CollaborationRunResult {
  result.status = "halted";
  result.severityGate = gate;
  const blockingSummary = gate.blocking
    .map((finding) => `${finding.severity}:${finding.category}`)
    .join(", ");
  result.halt = {
    phase,
    provider,
    reason:
      `severity gate FAILED before execute: open blocker/critical finding(s) ` +
      `[${blockingSummary}] — no execution proceeds with an open blocker/critical ` +
      `(spec §A4.4 / Vision §15)`,
    quotaError: null,
    failedResultStatus: null
  };
  return result;
}

function finalize(result: CollaborationRunResult): CollaborationRunResult {
  if (result.reviewFindings.length > 0) {
    result.severityGate = severityGate(result.reviewFindings.flatMap((findings) => findings.findings));
  }
  return result;
}

function resolveCosts(costs?: CollaborationCosts): ResolvedCosts {
  return {
    planning: costs?.planning ?? DEFAULT_COSTS.planning,
    implementation: costs?.implementation ?? DEFAULT_COSTS.implementation,
    review: costs?.review ?? DEFAULT_COSTS.review
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
