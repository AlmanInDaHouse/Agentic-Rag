import { describe, expect, it } from "vitest";
import {
  AgentPlanSchema,
  CrossReviewSchema,
  ReviewFindingsSchema,
  RoutingDecisionSchema,
  StrategyDecisionSchema,
  TaskProfileSchema,
  TaskSpecificationSchema,
  type ProviderAdapter,
  type ProviderId,
  type RoutingDecision,
  type TaskProfile,
  type TaskSpecification
} from "@triforge/shared";
import {
  ManualClock,
  MockClaudeAdapter,
  MockCodexAdapter,
  type ScenarioId
} from "../providers/mock/index.js";
import {
  QuotaManager,
  isErr,
  isOk,
  type ProviderBudgetConfig
} from "../providers/quota/index.js";
import {
  AUTHORITY_ORDER,
  resolveStrategy,
  runCollaboration,
  runFullDebate,
  runPair,
  runProviderStep,
  runSpecialist,
  selectMode,
  selectOwner,
  severityGate,
  UnresolvedStrategyError,
  type AuthorityEvidence,
  type CollaborationContext,
  type StrategyCandidate
} from "../orchestration/index.js";

// --- builders ------------------------------------------------------------

function makeProfile(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return TaskProfileSchema.parse({
    taskKind: "feature",
    complexity: "low",
    risk: "low",
    blastRadius: "file",
    reasoningDepthRequired: 0.1,
    repetitiveWorkRatio: 0.2,
    testBurden: 0.3,
    behavioralPreservationRequired: false,
    ...overrides
  });
}

function makeSpec(overrides: Partial<TaskSpecification> = {}): TaskSpecification {
  return TaskSpecificationSchema.parse({
    objective: "Implement the widget",
    acceptanceCriteria: ["criterion A", "criterion B"],
    ...overrides
  });
}

function makeRouting(owner: ProviderId, overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return RoutingDecisionSchema.parse({
    preferredOwner: owner,
    assignedOwner: owner,
    capabilityScore: 0.9,
    quotaAvailabilityScore: 0.9,
    historicalPerformanceScore: 0.7,
    risk: "low",
    degradedFromPreferredOwner: false,
    reason: ["test routing"],
    humanApprovalRequired: false,
    ...overrides
  });
}

function budget(
  provider: ProviderId,
  capacity: number | "unknown",
  extra: Partial<ProviderBudgetConfig> = {}
): ProviderBudgetConfig {
  return { provider, capacity, unit: `${provider}_invocations`, ...extra };
}

function quotaWith(configs: ProviderBudgetConfig[], clock?: ManualClock): QuotaManager {
  const manager = new QuotaManager(clock ? { clock } : {});
  for (const config of configs) {
    const result = manager.configureBudget(config);
    if (!result.ok) {
      throw new Error(`budget config failed for ${config.provider}: ${result.error.code}`);
    }
  }
  return manager;
}

function makeAdapters(opts: { codex?: ScenarioId; claude?: ScenarioId } = {}): Record<ProviderId, ProviderAdapter> {
  return {
    codex: new MockCodexAdapter({ scenario: opts.codex ?? "success" }),
    claude: new MockClaudeAdapter({ scenario: opts.claude ?? "success" })
  };
}

/** Assert NO real write leaked: read-only A4 must never surface a file.changed event. */
function assertNoWrites(steps: { events: { type: string }[] }[]): void {
  for (const step of steps) {
    for (const event of step.events) {
      expect(event.type).not.toBe("file.changed");
    }
  }
}

// --- Specialist mode -----------------------------------------------------

describe("A4 Specialist mode", () => {
  it("runs a single owner and does NOT invoke the second provider on a low-risk task", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "low", complexity: "low" }),
      spec: makeSpec(),
      routing: makeRouting("codex"),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runCollaboration(ctx);

    expect(result.mode).toBe("specialist");
    expect(result.status).toBe("completed");
    expect(result.secondProviderInvoked).toBe(false);
    expect(result.secondProviderTrigger).toBeNull();
    // The reviewer (claude) was never touched.
    expect(result.steps.some((step) => step.provider === "claude")).toBe(false);
    // Exactly the owner plan + owner execute steps ran.
    expect(result.steps.map((step) => step.phase)).toEqual(["plan", "execute"]);
    // One plan, one self-review, no cross-review, no strategy.
    expect(result.plans).toHaveLength(1);
    expect(result.crossReviews).toHaveLength(0);
    expect(result.reviewFindings).toHaveLength(1);
    expect(result.strategyDecision).toBeNull();
    // Artifacts validate against the A1 Zod schemas.
    expect(() => AgentPlanSchema.parse(result.plans[0])).not.toThrow();
    expect(() => ReviewFindingsSchema.parse(result.reviewFindings[0])).not.toThrow();
    expect(result.plans[0].owner).toBe("codex");
    expect(result.severityGate?.passed).toBe(true);
    assertNoWrites(result.steps);
  });

  it("invokes the second provider when a risk trigger fires (recorded reason)", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "high" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    // Invoke Specialist directly (so selection does not escalate the whole mode).
    const result = await runSpecialist(ctx);

    expect(result.mode).toBe("specialist");
    expect(result.status).toBe("completed");
    expect(result.secondProviderInvoked).toBe(true);
    expect(result.secondProviderTrigger).toContain("risk=high");
    const reviewStep = result.steps.find((step) => step.provider === "claude");
    expect(reviewStep?.phase).toBe("review");
    expect(result.crossReviews).toHaveLength(1);
    expect(() => CrossReviewSchema.parse(result.crossReviews[0])).not.toThrow();
    expect(result.reviewFindings).toHaveLength(2);
    assertNoWrites(result.steps);
  });

  it("flags an unauthorized write attempt by a reviewer as a blocking finding", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "high" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      // reviewer (claude) emits a file.changed under a read-only review.
      adapters: makeAdapters({ codex: "success", claude: "reviewerWriteAttempt" }),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runSpecialist(ctx);

    expect(result.secondProviderInvoked).toBe(true);
    expect(result.severityGate?.passed).toBe(false);
    expect(result.severityGate?.blocking.some((finding) => finding.severity === "blocker")).toBe(true);
    const crossFindings = result.reviewFindings.find((findings) => findings.reviewer === "claude");
    expect(crossFindings?.findings.some((finding) => finding.category === "unauthorized_write")).toBe(true);
  });
});

// --- Pair mode -----------------------------------------------------------

describe("A4 Pair mode", () => {
  it("runs proposal → critique → resolution → execution end to end", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ complexity: "high", risk: "medium", blastRadius: "module" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "medium" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runCollaboration(ctx);

    expect(result.mode).toBe("pair");
    expect(result.status).toBe("completed");
    expect(result.steps.map((step) => step.phase)).toEqual(["plan", "critique", "execute"]);
    expect(result.plans).toHaveLength(1);
    expect(result.crossReviews).toHaveLength(1);
    expect(result.reviewFindings).toHaveLength(2); // critique + self-review
    expect(result.strategyDecision).not.toBeNull();
    expect(() => StrategyDecisionSchema.parse(result.strategyDecision)).not.toThrow();
    expect(result.strategyDecision?.decidingAuthoritySource).toBe("spec");
    // L4: no authorityEvidence was supplied, so the spec ruling is a SYNTHESIZED default,
    // marked as such (the audit trail must not claim a real spec ruling decided this).
    expect(result.strategyResolution?.defaulted).toBe(true);
    expect(result.strategyDecision?.rationale).toContain("synthesized default");
    expect(() => CrossReviewSchema.parse(result.crossReviews[0])).not.toThrow();
    assertNoWrites(result.steps);
  });
});

// --- Full Debate mode ----------------------------------------------------

describe("A4 Full Debate mode", () => {
  it("produces independent plans, cross-reviews and an evidence-based resolution", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runCollaboration(ctx);

    expect(result.mode).toBe("full_debate");
    expect(result.status).toBe("completed");
    expect(result.steps.map((step) => step.phase)).toEqual([
      "plan",
      "plan",
      "review",
      "review",
      "execute"
    ]);
    // Two independent plans, two cross-reviews.
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((plan) => plan.owner).sort()).toEqual(["claude", "codex"]);
    expect(result.crossReviews).toHaveLength(2);
    expect(result.strategyDecision).not.toBeNull();
    for (const plan of result.plans) {
      expect(() => AgentPlanSchema.parse(plan)).not.toThrow();
    }
    for (const review of result.crossReviews) {
      expect(() => CrossReviewSchema.parse(review)).not.toThrow();
    }
    expect(() => StrategyDecisionSchema.parse(result.strategyDecision)).not.toThrow();
    assertNoWrites(result.steps);
  });

  it("resolves the debate by a higher authority over a higher-confidence plan (not majority)", async () => {
    // codex (owner) plan is the most confident; a safety invariant backs claude's plan.
    const evidence: AuthorityEvidence = {
      safety_invariants: {
        supports: "plan:claude",
        rationale: "claude's plan preserves a non-negotiable safety invariant"
      },
      risk_policy: { supports: "plan:codex", rationale: "risk policy mildly prefers codex" }
    };
    const ctx: CollaborationContext = {
      profile: makeProfile({ taskKind: "security", risk: "critical", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "critical" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)]),
      authorityEvidence: evidence,
      planConfidence: { codex: 0.95, claude: 0.1 }
    };

    const result = await runFullDebate(ctx);

    expect(result.status).toBe("completed");
    expect(result.strategyResolution?.decidingAuthoritySource).toBe("safety_invariants");
    expect(result.strategyResolution?.overrodeHighestConfidence).toBe(true);
    // Real authority evidence was supplied → NOT a synthesized default.
    expect(result.strategyResolution?.defaulted).toBe(false);
    expect(result.strategyDecision?.chosenOption).toBe("Adopt claude's plan");
  });
});

// --- Strategy resolution (authority order, never majority) ----------------

describe("A4 strategy resolution authority order", () => {
  it("a safety invariant beats a higher-confidence agent plan", () => {
    const candidates: StrategyCandidate[] = [
      { id: "safe", proposedBy: "claude", summary: "Safe path", confidence: 0.4 },
      { id: "fast", proposedBy: "codex", summary: "Fast path", confidence: 0.95 }
    ];
    const evidence: AuthorityEvidence = {
      safety_invariants: { supports: "safe", rationale: "the fast path violates a safety invariant" },
      // lower-priority signals AND the confident majority point at "fast" — they must lose.
      risk_policy: { supports: "fast", rationale: "risk policy prefers fast" }
    };

    const resolution = resolveStrategy({ candidates, evidence });

    expect(resolution.decidingAuthoritySource).toBe("safety_invariants");
    expect(resolution.chosen.id).toBe("safe");
    expect(resolution.overrodeHighestConfidence).toBe(true);
    expect(resolution.decision.chosenOption).toBe("Safe path");
    expect(resolution.decision.decidingAuthoritySource).toBe("safety_invariants");
    expect(() => StrategyDecisionSchema.parse(resolution.decision)).not.toThrow();
  });

  it("respects the full authority ranking order (higher source wins)", () => {
    const candidates: StrategyCandidate[] = [
      { id: "a", proposedBy: "codex", summary: "Option A", confidence: 0.5 },
      { id: "b", proposedBy: "claude", summary: "Option B", confidence: 0.5 }
    ];
    // spec (priority 2) backs A; acceptance_criteria (priority 3) backs B → spec wins.
    const evidence: AuthorityEvidence = {
      spec: { supports: "a", rationale: "the spec mandates option A" },
      acceptance_criteria: { supports: "b", rationale: "a criterion is easier with B" }
    };

    const resolution = resolveStrategy({ candidates, evidence });
    expect(resolution.decidingAuthoritySource).toBe("spec");
    expect(resolution.chosen.id).toBe("a");
  });

  it("refuses to fall back to majority when no authority can decide", () => {
    const candidates: StrategyCandidate[] = [
      { id: "a", proposedBy: "codex", summary: "Option A", confidence: 0.9 },
      { id: "b", proposedBy: "claude", summary: "Option B", confidence: 0.1 }
    ];
    expect(() => resolveStrategy({ candidates, evidence: {} })).toThrow(UnresolvedStrategyError);
  });

  it("exposes the canonical 9-source authority order", () => {
    expect(AUTHORITY_ORDER).toEqual([
      "safety_invariants",
      "spec",
      "acceptance_criteria",
      "code_evidence",
      "tests",
      "adrs",
      "threat_model",
      "risk_policy",
      "governance_decision"
    ]);
  });
});

// --- Quota interaction ---------------------------------------------------

describe("A4 quota gating", () => {
  it("halts the mode on a reserve violation WITHOUT running the adapter (no write)", async () => {
    // capacity 2 fully protected by implementation+review reserves → planning cannot reserve.
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "low" }),
      spec: makeSpec(),
      routing: makeRouting("codex"),
      adapters: makeAdapters(),
      quota: quotaWith([
        budget("codex", 2, { reserves: { implementation: 1, review: 1 } }),
        budget("claude", 10)
      ])
    };

    const result = await runSpecialist(ctx);

    expect(result.status).toBe("halted");
    expect(result.halt?.quotaError?.code).toBe("RUN_BUDGET_RESERVE_VIOLATION");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].blocked).toBe(true);
    // The adapter never executed: no events, no plan, no simulated write.
    expect(result.steps[0].events).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    assertNoWrites(result.steps);
  });

  it("halts on a hard stop before any step runs", async () => {
    const quota = quotaWith([budget("codex", 5), budget("claude", 5)]);
    expect(isOk(quota.hardStop("codex", "manual test stop"))).toBe(true);

    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "low" }),
      spec: makeSpec(),
      routing: makeRouting("codex"),
      adapters: makeAdapters(),
      quota
    };

    const result = await runSpecialist(ctx);

    expect(result.status).toBe("halted");
    expect(result.halt?.quotaError?.code).toBe("BUDGET_HARD_STOPPED");
    expect(result.steps[0].blocked).toBe(true);
    expect(result.steps[0].events).toHaveLength(0);
  });

  it("surfaces degraded routing when a provider reports quota exhaustion mid-stream", async () => {
    const quota = quotaWith([budget("codex", 5), budget("claude", 5)]);
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "low" }),
      spec: makeSpec(),
      routing: makeRouting("codex"),
      adapters: makeAdapters({ codex: "quotaExhausted" }),
      quota
    };

    const result = await runSpecialist(ctx);

    expect(result.status).toBe("halted");
    const planStep = result.steps[0];
    expect(planStep.blocked).toBe(false); // the step ran read-only...
    expect(planStep.result?.status).toBe("failed"); // ...but terminated as a quota failure.
    expect(planStep.degradedRoutingSuggested).toBe(true);
    expect(planStep.snapshot?.status).toBe("exhausted");
    // The budget is now hard-stopped: any subsequent step would be blocked.
    expect(isErr(quota.assertCanProceed("codex", { requireUnits: 1, purpose: "planning" }))).toBe(true);
  });
});

// --- Mode selection ------------------------------------------------------

describe("A4 mode selection", () => {
  it("defaults to Specialist for a clear low-risk task", () => {
    const selection = selectMode({
      profile: makeProfile({ risk: "low", complexity: "low" }),
      routing: makeRouting("codex"),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });
    expect(selection.mode).toBe("specialist");
    expect(selection.budgetConstrained).toBe(false);
  });

  it("selects Full Debate for architecture / high blast radius", () => {
    const selection = selectMode({
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      routing: makeRouting("codex", { risk: "high" }),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });
    expect(selection.mode).toBe("full_debate");
  });

  it("downgrades Full Debate to Pair when the budget cannot fund the debate after reserves", () => {
    const selection = selectMode({
      profile: makeProfile({ taskKind: "migration", risk: "high", blastRadius: "repository" }),
      routing: makeRouting("codex", { risk: "high" }),
      quota: quotaWith([
        budget("codex", 5),
        // claude can fund a review reservation but not a planning one (reserves protect it).
        budget("claude", 2, { reserves: { implementation: 1, review: 1 } })
      ])
    });
    expect(selection.requestedMode).toBe("full_debate");
    expect(selection.mode).toBe("pair");
    expect(selection.budgetConstrained).toBe(true);
  });

  it("downgrades Pair to Specialist when the budget cannot fund Pair after reserves", () => {
    const selection = selectMode({
      profile: makeProfile({ complexity: "high", risk: "medium" }),
      routing: makeRouting("codex", { risk: "medium" }),
      quota: quotaWith([
        budget("codex", 5),
        budget("claude", 1, { reserves: { implementation: 1 } })
      ])
    });
    expect(selection.requestedMode).toBe("pair");
    expect(selection.mode).toBe("specialist");
    expect(selection.budgetConstrained).toBe(true);
  });

  it("honors a human-forced mode", () => {
    const selection = selectMode({
      profile: makeProfile({ risk: "low" }),
      routing: makeRouting("codex"),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)]),
      forcedMode: "full_debate"
    });
    expect(selection.mode).toBe("full_debate");
    expect(selection.humanForced).toBe(true);
  });
});

// --- Owner selection / routing -------------------------------------------

describe("A4 owner selection (routing)", () => {
  it("chooses the preferred owner by capability when usable", () => {
    const routing = selectOwner({
      profile: makeProfile({ risk: "low" }),
      providers: ["codex", "claude"],
      capabilityScores: { codex: 0.9, claude: 0.5 },
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });
    expect(routing.preferredOwner).toBe("codex");
    expect(routing.assignedOwner).toBe("codex");
    expect(routing.degradedFromPreferredOwner).toBe(false);
    expect(routing.humanApprovalRequired).toBe(false);
    expect(() => RoutingDecisionSchema.parse(routing)).not.toThrow();
  });

  it("degrades to the alternate on a low-risk task when the preferred owner is unusable", () => {
    const quota = quotaWith([budget("codex", 5), budget("claude", 5)]);
    quota.hardStop("codex", "preferred owner exhausted");
    const routing = selectOwner({
      profile: makeProfile({ risk: "low" }),
      providers: ["codex", "claude"],
      capabilityScores: { codex: 0.9, claude: 0.5 },
      quota
    });
    expect(routing.preferredOwner).toBe("codex");
    expect(routing.assignedOwner).toBe("claude");
    expect(routing.degradedFromPreferredOwner).toBe(true);
    expect(routing.humanApprovalRequired).toBe(false);
  });

  it("pauses a critical task (human approval) instead of degrading silently", () => {
    const quota = quotaWith([budget("codex", 5), budget("claude", 5)]);
    quota.hardStop("codex", "preferred owner exhausted");
    const routing = selectOwner({
      profile: makeProfile({ risk: "critical" }),
      providers: ["codex", "claude"],
      capabilityScores: { codex: 0.9, claude: 0.5 },
      quota
    });
    expect(routing.assignedOwner).toBe("codex");
    expect(routing.degradedFromPreferredOwner).toBe(false);
    expect(routing.humanApprovalRequired).toBe(true);
  });

  it("pauses the collaboration when routing requires human approval", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "critical" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "critical", humanApprovalRequired: true }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };
    const result = await runCollaboration(ctx);
    expect(result.status).toBe("paused");
    expect(result.steps).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
  });
});

// --- Determinism ---------------------------------------------------------

describe("A4 determinism", () => {
  function buildContext(): CollaborationContext {
    return {
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };
  }

  it("produces identical artifacts and ordering for identical inputs (Full Debate)", async () => {
    const first = await runCollaboration(buildContext());
    const second = await runCollaboration(buildContext());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("produces identical artifacts for identical inputs (Pair)", async () => {
    const make = (): CollaborationContext => ({
      profile: makeProfile({ complexity: "high", risk: "medium" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "medium" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });
    const first = await runPair(make());
    const second = await runPair(make());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// --- Severity gate -------------------------------------------------------

describe("A4 review protocol severity gate", () => {
  it("passes when there are no blocker/critical findings and blocks otherwise", () => {
    const clean = severityGate([
      {
        severity: "minor",
        category: "style",
        file: null,
        line: null,
        evidence: "x",
        impact: "y",
        requiredAction: "z",
        missingTest: null,
        confidence: 0.5
      }
    ]);
    expect(clean.passed).toBe(true);

    const blocked = severityGate([
      {
        severity: "blocker",
        category: "safety",
        file: null,
        line: null,
        evidence: "x",
        impact: "y",
        requiredAction: "z",
        missingTest: null,
        confidence: 0.9
      }
    ]);
    expect(blocked.passed).toBe(false);
    expect(blocked.blocking).toHaveLength(1);
  });
});

// --- M1: escalation that cannot fund the reviewer review pauses (no doomed downgrade) -

describe("A4 hardening — escalation cannot fund reviewer review (M1)", () => {
  it("requires human approval instead of downgrading a high-risk task to a doomed mode", () => {
    const selection = selectMode({
      profile: makeProfile({ risk: "high" }),
      routing: makeRouting("codex", { risk: "high" }),
      quota: quotaWith([
        budget("codex", 5),
        // claude has a budget, but its review reservation is unfundable (protected by the
        // implementation reserve) — the very reservation a high-risk task MUST make.
        budget("claude", 1, { reserves: { implementation: 1 } })
      ])
    });

    expect(selection.requestedMode).toBe("pair");
    expect(selection.humanApprovalRequired).toBe(true);
    // It did NOT silently downgrade to a cheaper mode that would only halt later.
    expect(selection.mode).not.toBe("specialist");
    expect(selection.budgetConstrained).toBe(false);
  });

  it("pauses the run (no step, no write) on that path via runCollaboration", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ risk: "high" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota: quotaWith([
        budget("codex", 5),
        budget("claude", 1, { reserves: { implementation: 1 } })
      ])
    };

    const result = await runCollaboration(ctx);

    expect(result.status).toBe("paused");
    expect(result.steps).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.halt?.reason).toContain("human approval");
    assertNoWrites(result.steps);
  });
});

// --- M2: the severity gate is ENFORCED (halts before the simulated execute) -----------

describe("A4 hardening — enforced severity gate halts before execute (M2)", () => {
  it("Pair: a blocking critique halts before the simulated execute step (no execute runs)", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ complexity: "high", risk: "medium" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "medium" }),
      // reviewer (claude) attempts a write under the read-only critique → BLOCKER.
      adapters: makeAdapters({ codex: "success", claude: "reviewerWriteAttempt" }),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runPair(ctx);

    expect(result.status).toBe("halted");
    expect(result.severityGate?.passed).toBe(false);
    // Halted at the critique stage, BEFORE execute — only plan + critique ran.
    expect(result.steps.map((step) => step.phase)).toEqual(["plan", "critique"]);
    expect(result.steps.some((step) => step.phase === "execute")).toBe(false);
    expect(result.halt?.reason).toContain("severity gate");
  });

  it("Full Debate: a blocking cross-review halts before execute (no execute runs)", async () => {
    const ctx: CollaborationContext = {
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      // reviewer (claude) attempts a write under its read-only cross-review → BLOCKER.
      adapters: makeAdapters({ codex: "success", claude: "reviewerWriteAttempt" }),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    };

    const result = await runFullDebate(ctx);

    expect(result.status).toBe("halted");
    expect(result.severityGate?.passed).toBe(false);
    expect(result.steps.some((step) => step.phase === "execute")).toBe(false);
    expect(result.halt?.reason).toContain("severity gate");
  });
});

// --- L1: the shared pre-flight pauses DIRECT mode calls too ----------------------------

describe("A4 hardening — shared pre-flight pauses direct mode calls (L1)", () => {
  it("a directly-called mode pauses when routing requires human approval", async () => {
    const make = (): CollaborationContext => ({
      profile: makeProfile({ risk: "critical" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "critical", humanApprovalRequired: true }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });

    for (const run of [runSpecialist, runPair, runFullDebate]) {
      const result = await run(make());
      expect(result.status).toBe("paused");
      expect(result.steps).toHaveLength(0);
      expect(result.plans).toHaveLength(0);
    }
  });
});

// --- L2: an uncommitted reservation is released if the adapter throws mid-stream -------

describe("A4 hardening — reservation released on adapter throw (L2)", () => {
  it("releases an uncommitted reservation when the adapter throws mid-stream (no leak)", async () => {
    const quota = quotaWith([budget("codex", 5)]);
    expect(quota.getSnapshot("codex")?.reserved).toBe(0);

    const throwingAdapter = {
      provider: "codex" as ProviderId,
      execute() {
        async function* gen() {
          throw new Error("adapter boom mid-stream");
        }
        return gen();
      }
    } as unknown as ProviderAdapter;

    await expect(
      runProviderStep({
        adapter: throwingAdapter,
        quota,
        provider: "codex",
        purpose: "planning",
        amount: 1,
        phase: "plan",
        objective: "x",
        executionId: "leak-test-1"
      })
    ).rejects.toThrow(/boom/);

    // The reservation must have been released: capacity is fully restored, no leak.
    const after = quota.getSnapshot("codex");
    expect(after?.reserved).toBe(0);
    expect(after?.remaining).toBe(5);
  });
});

// --- L5: secondProviderInvoked reflects the ACTUAL reviewer step (not optimistic) ------

describe("A4 hardening — secondProviderInvoked reflects the actual reviewer step (L5)", () => {
  it("is false in Full Debate when the reviewer step never runs (blocked)", async () => {
    const quota = quotaWith([budget("codex", 10), budget("claude", 10)]);
    // Hard-stop claude so its planning step is BLOCKED (the adapter never runs).
    expect(isOk(quota.hardStop("claude", "reviewer unavailable"))).toBe(true);

    const result = await runFullDebate({
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota
    });

    expect(result.status).toBe("halted");
    // The reviewer (claude) plan step was blocked → the second provider was NOT invoked.
    expect(result.secondProviderInvoked).toBe(false);
    expect(result.secondProviderTrigger).toBeNull();
    const reviewerStep = result.steps.find((step) => step.provider === "claude");
    expect(reviewerStep?.blocked).toBe(true);
  });

  it("is true in Full Debate once the reviewer steps actually run", async () => {
    const result = await runFullDebate({
      profile: makeProfile({ taskKind: "architecture", risk: "high", blastRadius: "repository" }),
      spec: makeSpec(),
      routing: makeRouting("codex", { risk: "high" }),
      adapters: makeAdapters(),
      quota: quotaWith([budget("codex", 10), budget("claude", 10)])
    });

    expect(result.status).toBe("completed");
    expect(result.secondProviderInvoked).toBe(true);
    expect(result.secondProviderTrigger).toContain("both providers participate");
  });
});
