/**
 * Writable-execution runtime — Worktree Manager (A5.1).
 *
 * Public surface for the isolated-worktree lifecycle used by the writable MVP.
 */
export {
  WorktreeManager,
  WorktreeError,
  WORKTREE_METADATA_VERSION,
  defaultStateRoot,
  type WorktreeMetadata,
  type WorktreeStatus,
  type WorktreeErrorCode,
  type WorktreeAuditEntry,
  type CreateWorktreeRequest,
  type WorktreeHandle,
  type WorktreeManagerOptions
} from "./worktreeManager.js";

export {
  NodeGitRunner,
  FakeGitRunner,
  type GitRunner,
  type GitResult,
  type GitRunOptions,
  type FakeGitReply,
  type FakeGitHandler
} from "./gitRunner.js";
