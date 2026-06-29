/**
 * A8.8 Recovery panel (mandate §10 A8.8) — closes A8.
 *
 * Offers ONLY the recovery actions the run state allows (via `availableRecoveryActions`).
 * Presentational; an action button invokes the caller's handler.
 */

import { availableRecoveryActions, type RecoveryAction, type RunState, type WorktreeState } from "../lib/recovery.js";

const LABELS: Record<RecoveryAction, string> = {
  resume: "Resume",
  cancel: "Cancel",
  inspect_blocked: "Inspect blocked run",
  clean_stale_worktree: "Clean stale worktree",
  retry_auth: "Retry auth",
  retry_after_quota: "Retry after quota reset",
  abandon_repair: "Abandon repair",
  recover_artifacts: "Recover artifacts",
  inspect_rollback: "Inspect rollback"
};

export function RecoveryPanel({
  state,
  worktree,
  onAction
}: {
  state: RunState;
  worktree: WorktreeState;
  onAction?: (action: RecoveryAction) => void;
}): JSX.Element {
  const actions = availableRecoveryActions(state, worktree);
  return (
    <section aria-label="Recovery" className="recovery-panel">
      <h2>Recovery</h2>
      <p>{`run state: ${state}`}</p>
      {actions.length === 0 ? (
        <p className="none">no recovery actions available for this state</p>
      ) : (
        <ul className="actions">
          {actions.map((a) => (
            <li key={a}>
              <button type="button" data-action={a} onClick={() => onAction?.(a)}>
                {LABELS[a]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
