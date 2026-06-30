/**
 * Integrated runtime (A10-W.8b) — public surface. The productionized writable pipeline
 * behind the API/UI: provider-mode selection (mock | capability-gated real), worktree
 * execution, sequence-numbered event streaming, store-backed reconstruction.
 */

export {
  IntegratedRunService,
  type IntegratedRunDeps
} from "./integratedRunService.js";
export { InMemoryIntegratedRunStore } from "./inMemoryStore.js";
export { buildRunPlan, INTEGRATED_BINDING, type RunControls, type StageSink, type RunPlan } from "./runCallbacks.js";
export {
  TERMINAL_RUN_STATUSES,
  type CollaborationModeName,
  type IntegratedRunStatus,
  type IntegratedRunBudget,
  type IntegratedRunSpec,
  type ProviderProvenance,
  type IntegratedRunEvent,
  type IntegratedRunRecord,
  type IntegratedRunPatch,
  type IntegratedRunStore
} from "./types.js";
