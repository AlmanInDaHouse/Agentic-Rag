/**
 * A8.8 Recovery view-model (mandate §10 A8.8) — closes A8.
 *
 * Derives the recovery ACTIONS available for a run from its STATE — never offering an
 * action the state does not allow (e.g. a running run is not resumable). Pure +
 * deterministic.
 */

export type RunState =
  | "running"
  | "paused"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled"
  | "exhausted_quota"
  | "auth_expired"
  | "repair_exhausted";

export interface WorktreeState {
  stale: boolean;
  hasRollback: boolean;
  hasArtifacts: boolean;
}

export type RecoveryAction =
  | "resume"
  | "cancel"
  | "inspect_blocked"
  | "clean_stale_worktree"
  | "retry_auth"
  | "retry_after_quota"
  | "abandon_repair"
  | "recover_artifacts"
  | "inspect_rollback";

/** A run is still active (cancellable) in these states. */
const CANCELLABLE: ReadonlySet<RunState> = new Set<RunState>([
  "running",
  "paused",
  "blocked",
  "exhausted_quota",
  "auth_expired",
  "repair_exhausted"
]);

/**
 * The recovery actions valid for `state` + worktree condition. The set is DERIVED — an
 * action only appears when the state allows it.
 */
export function availableRecoveryActions(state: RunState, wt: WorktreeState): RecoveryAction[] {
  const actions = new Set<RecoveryAction>();

  if (CANCELLABLE.has(state)) {
    actions.add("cancel");
  }
  if (state === "paused") {
    actions.add("resume");
  }
  if (state === "blocked") {
    actions.add("inspect_blocked");
  }
  if (state === "exhausted_quota") {
    actions.add("retry_after_quota");
  }
  if (state === "auth_expired") {
    actions.add("retry_auth");
  }
  if (state === "repair_exhausted") {
    actions.add("abandon_repair");
  }

  // Worktree-condition-derived actions (independent of the run state).
  if (wt.stale) {
    actions.add("clean_stale_worktree");
  }
  if (wt.hasArtifacts) {
    actions.add("recover_artifacts");
  }
  if (wt.hasRollback) {
    actions.add("inspect_rollback");
  }

  return [...actions];
}
