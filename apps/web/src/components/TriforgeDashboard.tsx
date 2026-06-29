/**
 * TriForge dashboard (A8) — the product interface for the writable-execution runtime.
 *
 * Grows across A8.1–A8.8 (provider status, task composer, run timeline, artifact
 * explorer, diff/review, governance dashboard, budget/quota, recovery). It composes the
 * presentational panels over the stable A1 contracts; each panel renders only what the
 * backend reports and invents no state. Mounted as the TriForge view in a later A8 step
 * (kept separate from the legacy context dashboard in `App.tsx` for now).
 */

import { ProviderStatusPanel } from "./ProviderStatus.js";
import { TaskComposer } from "./TaskComposer.js";
import { RunTimeline } from "./RunTimeline.js";
import { ArtifactExplorer } from "./ArtifactExplorer.js";
import { DiffReview } from "./DiffReview.js";
import { GovernanceDashboard } from "./GovernanceDashboard.js";
import { BudgetQuota } from "./BudgetQuota.js";
import { RecoveryPanel } from "./RecoveryPanel.js";
import type { ProviderStatusSnapshot } from "../lib/providerStatus.js";
import type { ComposedTask } from "../lib/taskComposer.js";
import type { RunEvent } from "../lib/runTimeline.js";
import type { RunArtifacts } from "../lib/artifactExplorer.js";
import type { DiffReviewInput } from "../lib/diffReview.js";
import type { GovernanceObservation } from "../lib/governanceDashboard.js";
import type { QuotaSnapshotInput } from "../lib/budgetQuota.js";
import type { RecoveryAction, RunState, WorktreeState } from "../lib/recovery.js";

export interface TriforgeDashboardProps {
  providerStatus: ProviderStatusSnapshot[];
  runEvents?: RunEvent[];
  artifacts?: RunArtifacts;
  review?: DiffReviewInput;
  governance?: GovernanceObservation;
  quota?: QuotaSnapshotInput[];
  recovery?: { state: RunState; worktree: WorktreeState };
  onCreateTask?: (task: ComposedTask) => void;
  onRecoveryAction?: (action: RecoveryAction) => void;
}

export function TriforgeDashboard({
  providerStatus,
  runEvents = [],
  artifacts = {},
  review,
  governance = {},
  quota = [],
  recovery,
  onCreateTask,
  onRecoveryAction
}: TriforgeDashboardProps): JSX.Element {
  return (
    <main className="triforge-dashboard">
      <h1>TriForge</h1>
      <ProviderStatusPanel snapshots={providerStatus} />
      <TaskComposer onSubmit={onCreateTask} />
      <RunTimeline events={runEvents} />
      <ArtifactExplorer artifacts={artifacts} />
      {review ? <DiffReview review={review} /> : null}
      <GovernanceDashboard observation={governance} />
      <BudgetQuota snapshots={quota} />
      {recovery ? (
        <RecoveryPanel state={recovery.state} worktree={recovery.worktree} onAction={onRecoveryAction} />
      ) : null}
    </main>
  );
}
