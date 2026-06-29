import { describe, expect, it } from "vitest";
import { availableRecoveryActions, type WorktreeState } from "./recovery.js";

const CLEAN: WorktreeState = { stale: false, hasRollback: false, hasArtifacts: false };

describe("availableRecoveryActions — derived from state; never an invalid action", () => {
  it("a PAUSED run offers resume + cancel", () => {
    const a = availableRecoveryActions("paused", CLEAN);
    expect(a).toContain("resume");
    expect(a).toContain("cancel");
  });

  it("a RUNNING run offers cancel but NOT resume", () => {
    const a = availableRecoveryActions("running", CLEAN);
    expect(a).toContain("cancel");
    expect(a).not.toContain("resume");
  });

  it("a quota-exhausted run offers retry-after-quota; auth-expired offers retry-auth", () => {
    expect(availableRecoveryActions("exhausted_quota", CLEAN)).toContain("retry_after_quota");
    expect(availableRecoveryActions("auth_expired", CLEAN)).toContain("retry_auth");
  });

  it("a blocked run offers inspect-blocked; repair-exhausted offers abandon-repair", () => {
    expect(availableRecoveryActions("blocked", CLEAN)).toContain("inspect_blocked");
    expect(availableRecoveryActions("repair_exhausted", CLEAN)).toContain("abandon_repair");
  });

  it("a completed/cancelled run is not cancellable", () => {
    expect(availableRecoveryActions("completed", CLEAN)).not.toContain("cancel");
    expect(availableRecoveryActions("cancelled", CLEAN)).not.toContain("resume");
  });

  it("derives worktree-condition actions independently of state", () => {
    const a = availableRecoveryActions("completed", { stale: true, hasRollback: true, hasArtifacts: true });
    expect(a).toContain("clean_stale_worktree");
    expect(a).toContain("recover_artifacts");
    expect(a).toContain("inspect_rollback");
    // A clean worktree on a completed run offers none of those.
    expect(availableRecoveryActions("completed", CLEAN)).toEqual([]);
  });
});
