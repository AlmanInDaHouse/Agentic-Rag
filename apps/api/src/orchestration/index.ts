/**
 * Collaboration runtime (A4) — public surface.
 *
 * A pure, deterministic, in-memory orchestration layer that coordinates PLANNING,
 * CRITIQUE, RESOLUTION and REVIEW between two providers over the A1 contracts, driven
 * by the A2 mock adapters and the A2.3 quota manager. It performs NO real writes and
 * NO real CLI execution — every "execution" is simulated by consuming an adapter's
 * normalized event stream (writable execution is A5, gated on the A0.5 capability
 * binding). It is NOT wired into the Fastify routes; the runtime stays mock-only.
 *
 * See docs/specs/COLLABORATION_RUNTIME_SPEC.md and ADR 0035.
 */

export {
  // modes + selection
  runCollaboration,
  runSpecialist,
  runPair,
  runFullDebate,
  selectMode,
  deriveUncertainty,
  specialistEscalation,
  // types
  type CollaborationMode,
  type CollaborationCosts,
  type CollaborationContext,
  type CollaborationStatus,
  type CollaborationHalt,
  type CollaborationRunResult,
  type ModeSelection,
  type ModeSelectionInput
} from "./collaborationModes.js";

export {
  selectOwner,
  reviewerFor,
  type OwnerSelectionInput
} from "./routing.js";

export {
  runProviderStep,
  stepSucceeded,
  type CollaborationPhase,
  type ProviderStepInput,
  type ProviderStepRecord,
  type StepQuotaError
} from "./providerStep.js";

export {
  reviewFindingsFromEvents,
  normalizeReviewFinding,
  buildReviewFindings,
  summarizeSeverity,
  severityGate,
  BLOCKING_SEVERITIES,
  ALL_SEVERITIES,
  type RawReviewFinding,
  type SeverityGateResult,
  type FromEventsOptions
} from "./reviewProtocol.js";

export {
  resolveStrategy,
  AUTHORITY_ORDER,
  UnresolvedStrategyError,
  type StrategyCandidate,
  type AuthorityRuling,
  type AuthorityEvidence,
  type StrategyResolutionInput,
  type StrategyResolution
} from "./strategyResolution.js";

export {
  profileTask,
  TASK_PROFILER_VERSION,
  type ProfileSignals,
  type ExtendedProfile,
  type ProfileOverride,
  type ProfileResult
} from "./taskProfiler.js";

export {
  routeStatically,
  DEFAULT_RULES,
  STATIC_ROUTER_VERSION,
  type RouterContext,
  type CapabilityRule,
  type AppliedRule,
  type StaticRoutingResult
} from "./staticRouter.js";

export {
  routeQuotaAware,
  QUOTA_AWARE_ROUTER_VERSION,
  type RoutingStatus,
  type QuotaAwareRoutingInput,
  type QuotaAwareRoutingResult
} from "./quotaAwareRouter.js";

export {
  MetricsStore,
  type RunMetric,
  type MetricProvenance,
  type MergeResult,
  type RecordOutcome,
  type AggregateFilter,
  type Aggregate
} from "./executionMetrics.js";

export {
  buildRepositoryProfile,
  REPO_PROFILE_VERSION,
  type RepoProfileOptions,
  type ProviderTaskStat,
  type RepositoryProfile
} from "./repositoryProfiles.js";

export {
  routeAdaptive,
  ADAPTIVE_ROUTER_VERSION,
  type RoutingMode,
  type AdaptiveRoutingInput,
  type AdaptiveRoutingResult
} from "./adaptiveRouter.js";
