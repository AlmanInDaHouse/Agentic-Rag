import { z } from "zod";
import { ProviderIdSchema, ProviderQuotaSchema } from "./common.js";

/**
 * Artifact contracts (A1.4).
 *
 * The 12 provider-agnostic, Zod-validated artifacts that flow through the
 * collaboration lifecycle (Vision §14). TriForge owns and validates these
 * records; providers only emit events and proposals. The provider knowledge here
 * is vocabulary only — `ProviderIdSchema` (plus the inherited quota-flavor tokens
 * that live in `common.ts`); there is no Codex/Claude-specific logic or
 * per-provider branching.
 */

// Mirrors RiskLevelSchema from the shared barrel (low|medium|high|critical).
// Defined locally to keep this module free of a circular import through the
// barrel that re-exports it. The values are kept identical by contract.
const riskLevel = z.enum(["low", "medium", "high", "critical"]);

// --- 1. TaskSpecification -----------------------------------------------
export const TaskSpecificationSchema = z
  .object({
    objective: z.string().min(1),
    scope: z.array(z.string()).default([]),
    nonGoals: z.array(z.string()).default([]),
    invariants: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(z.string()).default([]),
    failureModes: z.array(z.string()).default([]),
    relationToPriorDecisions: z.array(z.string()).default([])
  })
  .strict();

// --- 2. ContextManifest -------------------------------------------------
export const ContextManifestEntrySchema = z
  .object({
    sourceId: z.string().min(1),
    sourceType: z.string().min(1),
    provenance: z.string(),
    contentHash: z.string().min(1),
    retrievalRef: z.string().nullable().default(null)
  })
  .strict();

export const ContextManifestSchema = z
  .object({
    generatedAt: z.string().datetime(),
    entries: z.array(ContextManifestEntrySchema).default([])
  })
  .strict();

// --- 3. AgentPlan -------------------------------------------------------
export const AgentPlanStepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    description: z.string().min(1),
    expectedOutcome: z.string().nullable().default(null)
  })
  .strict();

export const AgentPlanSchema = z
  .object({
    owner: ProviderIdSchema,
    rationale: z.string(),
    steps: z.array(AgentPlanStepSchema).default([])
  })
  .strict();

// --- 4. CrossReview -----------------------------------------------------
export const CrossReviewFindingSchema = z
  .object({
    summary: z.string().min(1),
    agreement: z.enum(["agree", "disagree", "uncertain"]).default("uncertain"),
    detail: z.string().nullable().default(null)
  })
  .strict();

export const CrossReviewSchema = z
  .object({
    reviewer: ProviderIdSchema,
    target: z.string().min(1),
    findings: z.array(CrossReviewFindingSchema).default([])
  })
  .strict();

// --- 5. StrategyDecision (authority order, mandate §A4.5) ---------------
export const AuthoritySourceSchema = z.enum([
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

export const StrategyDecisionSchema = z
  .object({
    chosenOption: z.string().min(1),
    consideredOptions: z.array(z.string()).default([]),
    // Authority order applied to resolve the decision (highest first).
    authoritySourceRanking: z.array(AuthoritySourceSchema).default([]),
    // The authority source that actually resolved the decision.
    decidingAuthoritySource: AuthoritySourceSchema,
    rationale: z.string()
  })
  .strict();

// --- 6. TaskProfile (EXACT Vision §16 shape) ----------------------------
export const ComplexitySchema = z.enum(["low", "medium", "high"]);
export const BlastRadiusSchema = z.enum(["file", "module", "package", "repository"]);

export const TaskProfileSchema = z
  .object({
    taskKind: z.string().min(1),
    complexity: ComplexitySchema,
    risk: riskLevel,
    blastRadius: BlastRadiusSchema,
    reasoningDepthRequired: z.number(),
    repetitiveWorkRatio: z.number(),
    testBurden: z.number(),
    behavioralPreservationRequired: z.boolean()
  })
  .strict();

// --- 7. RoutingDecision (EXACT Vision §16 shape) ------------------------
export const RoutingDecisionSchema = z
  .object({
    preferredOwner: ProviderIdSchema,
    assignedOwner: ProviderIdSchema,
    capabilityScore: z.number(),
    quotaAvailabilityScore: z.number(),
    historicalPerformanceScore: z.number(),
    risk: riskLevel,
    degradedFromPreferredOwner: z.boolean(),
    reason: z.array(z.string()).default([]),
    humanApprovalRequired: z.boolean()
  })
  .strict();

// --- Shared summaries (used by several artifacts) -----------------------
export const TestSummarySchema = z
  .object({
    passed: z.number().int().nonnegative().default(0),
    failed: z.number().int().nonnegative().default(0),
    skipped: z.number().int().nonnegative().default(0),
    total: z.number().int().nonnegative().default(0)
  })
  .strict();

export const MutationSummarySchema = z
  .object({
    filesCreated: z.number().int().nonnegative().default(0),
    filesModified: z.number().int().nonnegative().default(0),
    filesDeleted: z.number().int().nonnegative().default(0)
  })
  .strict();

// --- 8. ImplementationResult --------------------------------------------
export const ImplementationResultSchema = z
  .object({
    owner: ProviderIdSchema,
    diffHash: z.string().min(1),
    filesChanged: z.array(z.string()).default([]),
    commands: z.array(z.string()).default([]),
    tests: TestSummarySchema,
    mutationSummary: MutationSummarySchema
  })
  .strict();

// --- 9. ReviewFindings (finding shape per mandate §A4.4) ----------------
export const FindingSeveritySchema = z.enum([
  "blocker",
  "critical",
  "major",
  "minor",
  "observation"
]);

export const ReviewFindingSchema = z
  .object({
    severity: FindingSeveritySchema,
    category: z.string().min(1),
    file: z.string().nullable().default(null),
    line: z.number().int().nonnegative().nullable().default(null),
    evidence: z.string(),
    impact: z.string(),
    requiredAction: z.string(),
    missingTest: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export const ReviewFindingsSchema = z
  .object({
    reviewer: ProviderIdSchema,
    summary: z.string(),
    findings: z.array(ReviewFindingSchema).default([])
  })
  .strict();

// --- 10. QualityGateResult ----------------------------------------------
export const QualityGateNameSchema = z.enum([
  "unit",
  "integration",
  "e2e",
  "typecheck",
  "lint",
  "build",
  "dependency",
  "security",
  "codeGraph",
  "custom"
]);

export const QualityGateStatusSchema = z.enum(["passed", "failed", "skipped", "unknown"]);

export const QualityGateSchema = z
  .object({
    name: QualityGateNameSchema,
    status: QualityGateStatusSchema,
    detail: z.string().nullable().default(null)
  })
  .strict();

export const QualityGateResultSchema = z
  .object({
    overallStatus: QualityGateStatusSchema,
    gates: z.array(QualityGateSchema).default([])
  })
  .strict();

// --- Findings summary (counts by severity) ------------------------------
export const FindingsSummarySchema = z
  .object({
    blocker: z.number().int().nonnegative().default(0),
    critical: z.number().int().nonnegative().default(0),
    major: z.number().int().nonnegative().default(0),
    minor: z.number().int().nonnegative().default(0),
    observation: z.number().int().nonnegative().default(0)
  })
  .strict();

// --- 11. GovernanceDecision (binding per threat model §11.2) ------------
export const MergeDecisionSchema = z.enum(["merge", "block", "hold"]);

/**
 * The 6 capability-binding fields. Every writable capability must bind to all
 * six before it is authorized (PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md §11):
 * threat IDs, the implemented controls, the delivering milestone, the passing
 * verification (SATs), the recovery path, and the accepted residual risk.
 */
export const CapabilityBindingSchema = z
  .object({
    threat: z.array(z.string()).min(1),
    control: z.array(z.string()).min(1),
    milestone: z.string().min(1),
    verification: z.array(z.string()).min(1),
    recovery: z.string().min(1),
    residualRisk: z.string().min(1)
  })
  .strict();

export const GovernanceDecisionSchema = z
  .object({
    task: z.string().min(1),
    specRef: z.string().min(1),
    owner: ProviderIdSchema,
    reviewer: ProviderIdSchema,
    contextRef: z.string().min(1),
    diffHash: z.string().min(1),
    tests: TestSummarySchema,
    findingsSummary: FindingsSummarySchema,
    quota: ProviderQuotaSchema.nullable().default(null),
    risks: z.array(z.string()).default([]),
    mergeDecision: MergeDecisionSchema,
    justification: z.string().min(1),
    capabilityBinding: CapabilityBindingSchema
  })
  .strict();

// --- 12. RunFinalReport (mandate §5.10 / §A1.4) -------------------------
export const RunFinalStateSchema = z.enum([
  "completed",
  "failed",
  "blocked",
  "merged",
  "reverted",
  "paused"
]);

export const RunFinalReportSchema = z
  .object({
    objective: z.string().min(1),
    baseSha: z.string().min(1),
    branch: z.string().min(1),
    commit: z.string().nullable().default(null),
    pr: z.string().nullable().default(null),
    mergeSha: z.string().nullable().default(null),
    files: z.array(z.string()).default([]),
    tests: TestSummarySchema,
    findings: FindingsSummarySchema,
    decisions: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    finalState: RunFinalStateSchema,
    nextObjective: z.string().nullable().default(null)
  })
  .strict();

// --- Inferred types -----------------------------------------------------
export type TaskSpecification = z.infer<typeof TaskSpecificationSchema>;
export type ContextManifestEntry = z.infer<typeof ContextManifestEntrySchema>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;
export type CrossReviewFinding = z.infer<typeof CrossReviewFindingSchema>;
export type CrossReview = z.infer<typeof CrossReviewSchema>;
export type AuthoritySource = z.infer<typeof AuthoritySourceSchema>;
export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;
export type Complexity = z.infer<typeof ComplexitySchema>;
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;
export type TaskProfile = z.infer<typeof TaskProfileSchema>;
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
export type TestSummary = z.infer<typeof TestSummarySchema>;
export type MutationSummary = z.infer<typeof MutationSummarySchema>;
export type ImplementationResult = z.infer<typeof ImplementationResultSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewFindings = z.infer<typeof ReviewFindingsSchema>;
export type QualityGateName = z.infer<typeof QualityGateNameSchema>;
export type QualityGateStatus = z.infer<typeof QualityGateStatusSchema>;
export type QualityGate = z.infer<typeof QualityGateSchema>;
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;
export type FindingsSummary = z.infer<typeof FindingsSummarySchema>;
export type MergeDecision = z.infer<typeof MergeDecisionSchema>;
export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
export type RunFinalState = z.infer<typeof RunFinalStateSchema>;
export type RunFinalReport = z.infer<typeof RunFinalReportSchema>;
