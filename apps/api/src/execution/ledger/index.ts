/**
 * Writable-execution runtime — Diff Capture + Mutation Ledger (A5.5).
 */
export {
  MutationLedger,
  redactSecrets,
  ledgerSha256,
  type MutationOperation,
  type MutationInput,
  type MutationEntry,
  type MutationLedgerOptions
} from "./mutationLedger.js";

export {
  computeWorktreeChanges,
  diffHash,
  type ChangeStatus,
  type WorktreeChange
} from "./worktreeState.js";

export { reconcile, type Reconciliation, type ReconciliationItem } from "./reconcile.js";
