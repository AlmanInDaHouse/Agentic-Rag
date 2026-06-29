/**
 * Ledger reconciliation (A5.5) — re-grounds the mutation ledger against the REAL
 * worktree changes (`worktreeState.ts`) to detect an UNATTRIBUTED change: a file the
 * worktree actually changed that the ledger does not record (or records with a
 * different post-hash). This is the integrity check the governance gate (A5.8)
 * consults — a forged structured result or an out-of-band mutation marks the run
 * tampered and blocks the merge (SAT-A5-6; T-INJ-11, T-INT-04).
 */

import type { MutationEntry } from "./mutationLedger.js";
import type { WorktreeChange } from "./worktreeState.js";

export interface ReconciliationItem {
  relPath: string;
  /** The current worktree content hash (null for a delete). */
  worktreeHash: string | null;
  /** The hash the ledger last recorded for this file, if any. */
  ledgerHash: string | null;
  detail: string;
}

export interface Reconciliation {
  /** Worktree changes that match a ledger entry (path + post-hash). */
  attributed: ReconciliationItem[];
  /** Worktree changes with NO matching ledger entry, or a post-hash mismatch. */
  unattributed: ReconciliationItem[];
  /** Ledger files no longer present in the worktree changes (e.g. reverted). */
  stale: string[];
  /** True iff there is at least one unattributed change → the run is tampered. */
  tampered: boolean;
}

/**
 * Reconcile ledger entries against the real worktree changes. The ledger's recorded
 * state per file is "last write wins" (its final `hashAfter`/operation).
 */
export function reconcile(
  ledgerEntries: readonly MutationEntry[],
  worktreeChanges: readonly WorktreeChange[]
): Reconciliation {
  // Final recorded post-hash per file (last entry wins). A delete records null.
  const recorded = new Map<string, string | null>();
  for (const e of ledgerEntries) {
    recorded.set(e.file, e.hashAfter);
    if (e.operation === "rename" && e.renamedFrom) {
      recorded.set(e.renamedFrom, null); // the old path is gone
    }
  }

  const attributed: ReconciliationItem[] = [];
  const unattributed: ReconciliationItem[] = [];
  const seen = new Set<string>();

  for (const change of worktreeChanges) {
    seen.add(change.relPath);
    const ledgerHash = recorded.has(change.relPath) ? recorded.get(change.relPath)! : undefined;
    if (ledgerHash === undefined) {
      unattributed.push({
        relPath: change.relPath,
        worktreeHash: change.hash,
        ledgerHash: null,
        detail: "file changed in the worktree but not recorded in the ledger"
      });
      continue;
    }
    if (ledgerHash !== change.hash) {
      unattributed.push({
        relPath: change.relPath,
        worktreeHash: change.hash,
        ledgerHash,
        detail: "worktree content hash does not match the ledger's recorded hash"
      });
      continue;
    }
    attributed.push({
      relPath: change.relPath,
      worktreeHash: change.hash,
      ledgerHash,
      detail: "matches the ledger"
    });
  }

  const stale: string[] = [];
  for (const file of recorded.keys()) {
    if (!seen.has(file) && recorded.get(file) !== null) {
      stale.push(file);
    }
  }

  return { attributed, unattributed, stale, tampered: unattributed.length > 0 };
}
