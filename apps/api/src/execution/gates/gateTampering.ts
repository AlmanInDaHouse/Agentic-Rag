/**
 * Gate-tampering detection (A5.6) — flags worktree changes that would let a run
 * "pass" by WEAKENING the checks rather than satisfying them: deleting test files,
 * or editing CI workflows / the gate scripts in the root manifest (mandate §A5.6
 * "test deletion detection / CI config change detection"; threat-model T-INT-07/08,
 * T-GIT-07). The governance gate (A5.8) treats a positive report as a blocker.
 *
 * Operates on the A5.5 `WorktreeChange[]` (already computed from the real worktree),
 * so it is provider-narrative-independent.
 */

import type { WorktreeChange } from "../ledger/index.js";

export interface GateTamperingReport {
  /** Test files deleted in this change set. */
  deletedTests: string[];
  /** CI workflow / gate-config files modified or deleted in this change set. */
  ciConfigChanges: string[];
  /** True iff anything above was found → the run weakened its own checks. */
  tampered: boolean;
}

const TEST_FILE = /(^|\/)(__tests__\/|tests?\/)|\.(test|spec)\.[cm]?[jt]sx?$/i;
const CI_CONFIG =
  /(^|\/)\.github\/workflows\/|(^|\/)(vitest|jest|playwright|tsconfig|eslint)[.\w-]*\.(json|js|cjs|mjs|ts|yml|yaml)$/i;

/** A change that removes content: a delete, or a rename away from the old path. */
function removesPath(change: WorktreeChange): boolean {
  return change.status === "delete";
}

export function detectGateTampering(changes: readonly WorktreeChange[]): GateTamperingReport {
  const deletedTests: string[] = [];
  const ciConfigChanges: string[] = [];

  for (const change of changes) {
    // A deleted test file is a red flag (a passing run that removed its own tests).
    if (removesPath(change) && TEST_FILE.test(change.relPath)) {
      deletedTests.push(change.relPath);
    }
    // The old path of a renamed-away test also counts as a removal.
    if (change.status === "rename" && change.renamedFrom && TEST_FILE.test(change.renamedFrom)) {
      deletedTests.push(change.renamedFrom);
    }
    // Any change to CI workflows or gate config is surfaced for review.
    if (CI_CONFIG.test(change.relPath)) {
      ciConfigChanges.push(change.relPath);
    }
    // The root package.json carries the gate scripts (build/test/lint/typecheck…).
    if (change.relPath === "package.json") {
      ciConfigChanges.push(change.relPath);
    }
  }

  return {
    deletedTests,
    ciConfigChanges,
    tampered: deletedTests.length > 0 || ciConfigChanges.length > 0
  };
}
