/**
 * A10-W — Execution platform boundary (mandate §3).
 *
 * The product target moved from a mandatory WSL2 substrate (ADR 0030) to **native
 * Windows 11** (ADR 0056). Rather than scatter `process.platform === "win32"`
 * checks across routing, provider events, quota, collaboration, governance, ledger
 * and quality gates — all of which stay OS-independent — every OS-specific
 * behavior is funnelled through ONE explicit boundary:
 *
 * ```text
 * ExecutionPlatform
 * ├── WindowsExecutionPlatform   (initial supported substrate, ADR 0056)
 * └── PosixExecutionPlatform     (future / optional, ADR 0030 legacy)
 * ```
 *
 * This module declares the *contract only*. The heavyweight implementations land
 * in their dedicated PRs and are intentionally NOT part of A10-W.1:
 *  - `validateContainedPath`      → A10-W.2 (Windows path security policy)
 *  - worktree placement / state root → A10-W.3 (Windows Worktree Manager)
 *  - `createManagedProcess` / `terminateProcessTree` → A10-W.4 (Job Object supervisor)
 *  - `createRestrictedEnvironment` → A10-W.5 (Windows isolation boundary)
 *
 * Nothing in the runtime calls the deferred methods yet; the concrete classes
 * throw {@link PlatformMethodNotImplementedError} (naming the planned PR) until the
 * owning PR fills them in. The methods that A10-W.1 *can* implement honestly on a
 * real host — platform identity, lexical workspace-path normalization, and
 * filesystem-entry inspection — are implemented now and unit-tested.
 *
 * Design rules:
 *  - no shell by default; processes take an executable + an explicit argv array;
 *  - paths are validated against a canonical identity (volume + realpath), never a
 *    naive string `startsWith`;
 *  - environments are allowlisted; credential-shaped names are dropped;
 *  - every managed process emits exactly one terminal signal.
 */

/** The two substrate families TriForge can target. */
export type PlatformId = "windows" | "posix";

/**
 * A canonicalized path plus the identity needed to reason about containment
 * across volumes/drives and reparse points. `volumeId` distinguishes drives on
 * Windows (e.g. a volume GUID or drive letter) and devices on POSIX, so that a
 * symlink/junction that resolves to another volume can be rejected even when its
 * textual prefix looks contained.
 */
export interface CanonicalPath {
  /** The fully-resolved, normalized absolute path (separators normalized per OS). */
  readonly absolute: string;
  /** Stable identifier of the volume/drive/device the path resides on. */
  readonly volumeId: string;
  /** True if the leaf currently exists on disk; false if it is a not-yet-created child. */
  readonly exists: boolean;
  /**
   * True if any segment of the existing path chain is a symlink/junction/
   * mount-point reparse point (detected via `lstat`/`isSymbolicLink`). NOTE: other
   * reparse tags (AppExecLink, cloud placeholders, dedup) are NOT detected until
   * A10-W.2 — a containment policy must treat `false` as "not yet proven safe",
   * not "definitely not a redirect".
   */
  readonly hasReparsePointInChain: boolean;
}

/** A request to validate that a (possibly not-yet-existing) target is contained. */
export interface PathValidationRequest {
  /** The path to validate (absolute or relative; mixed separators tolerated). */
  readonly target: string;
  /** The authorized containment root (e.g. the active worktree). */
  readonly containmentRoot: string;
  /** Whether the target is allowed not to exist yet (e.g. a file about to be written). */
  readonly allowNonexistentLeaf?: boolean;
}

/** The outcome of a containment validation. Deny-by-default: `allowed=false` unless proven. */
export interface PathValidationResult {
  readonly allowed: boolean;
  /** The canonical identity of the target when it could be resolved. */
  readonly canonical: CanonicalPath | null;
  /** Stable machine-readable reason on denial (e.g. "escapes_containment", "denied_reparse_point", "reserved_name"). */
  readonly denyReason: string | null;
  /** Human-readable detail for audit logs (never contains secrets). */
  readonly detail: string;
}

/** A request to spawn a supervised child process under platform-native control. */
export interface ManagedProcessRequest {
  /** Absolute path (or resolvable command) of the executable. No shell interpolation. */
  readonly executable: string;
  /** Complete argv. Each element is passed verbatim; never concatenated into a shell string. */
  readonly args: readonly string[];
  /** Explicit working directory; must exist and be validated as contained. */
  readonly cwd: string;
  /** Allowlisted environment. Credential-shaped names are dropped by the platform. */
  readonly env: Readonly<Record<string, string>>;
  /** Hard wall-clock timeout in milliseconds; 0/undefined means platform default. */
  readonly timeoutMs?: number;
  /** Max bytes captured per stream before the run is terminated as `output_limit`. */
  readonly maxOutputBytes?: number;
}

/** Why a managed process terminated. Exactly one is reported per run. */
export type TerminationReason =
  | "exited"
  | "timeout"
  | "cancelled"
  | "output_limit"
  | "spawn_error";

/** The single terminal record for a managed process. */
export interface TerminationResult {
  readonly reason: TerminationReason;
  /** Process exit code when `reason === "exited"`, else null. */
  readonly exitCode: number | null;
  /** True if the platform confirmed the whole process tree was reaped. */
  readonly treeReaped: boolean;
  /** Audit detail (no secrets). */
  readonly detail: string;
}

/** A handle to a running supervised process. */
export interface ManagedProcess {
  /** Opaque platform process/job id (string for portability). */
  readonly processId: string;
  /** Async iterable of `{ stream, line }` output records (stdout/stderr), CRLF-stripped. */
  readonly output: AsyncIterable<{ stream: "stdout" | "stderr"; line: string }>;
  /** Resolves once, after output drains, with the single terminal result. */
  readonly terminal: Promise<TerminationResult>;
  /** Idempotent cancellation of the entire process tree. */
  cancel(reason: TerminationReason): Promise<void>;
}

/** A request to build a restricted, allowlisted environment for a child process. */
export interface RestrictedEnvironmentRequest {
  /** Names allowed to pass through from the parent environment. */
  readonly allowNames: readonly string[];
  /** Explicit key/value additions (validated; credential-shaped names rejected). */
  readonly set?: Readonly<Record<string, string>>;
}

/** The result of building a restricted environment. */
export interface RestrictedEnvironment {
  readonly env: Readonly<Record<string, string>>;
  /** Names that were dropped because they matched a credential pattern. */
  readonly droppedCredentialNames: readonly string[];
}

/** Non-secret evidence about a filesystem entry, used by the path policy and doctor. */
export interface FilesystemEntryEvidence {
  readonly path: string;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  /**
   * True for symlink-, junction- and mount-point-tagged reparse points (via
   * `lstat`/`isSymbolicLink`). Other reparse tags (AppExecLink, cloud
   * placeholders, dedup) are NOT detected until A10-W.2 adds full reparse-tag
   * inspection; callers must treat `false` as "unknown — scrutinize", not "safe".
   */
  readonly isReparsePoint: boolean;
  /** Volume/drive/device identifier the entry resides on. */
  readonly volumeId: string;
}

/**
 * The OS-portability boundary. Implementations encapsulate ALL platform-specific
 * behavior; the rest of TriForge depends only on this interface.
 */
export interface ExecutionPlatform {
  readonly platformId: PlatformId;

  /** Normalize a workspace path to a canonical identity (lexical + on-disk where possible). */
  normalizeWorkspacePath(input: string): Promise<CanonicalPath>;

  /** Deny-by-default containment validation (A10-W.2 / A10-W.5). */
  validateContainedPath(request: PathValidationRequest): Promise<PathValidationResult>;

  /** Spawn a supervised process under native process-tree control (A10-W.4). */
  createManagedProcess(request: ManagedProcessRequest): Promise<ManagedProcess>;

  /** Terminate a process tree by id with a bounded grace period (A10-W.4). */
  terminateProcessTree(processId: string, reason: TerminationReason): Promise<TerminationResult>;

  /** Build a restricted, credential-stripped environment (A10-W.5). */
  createRestrictedEnvironment(
    request: RestrictedEnvironmentRequest
  ): Promise<RestrictedEnvironment>;

  /** Inspect a filesystem entry for reparse points / volume identity (A10-W.2). */
  inspectFilesystemEntry(path: string): Promise<FilesystemEntryEvidence>;
}

/**
 * Thrown by a concrete platform when a method's real implementation is scheduled
 * for a later A10-W PR. The error names the method and the planned PR so callers
 * and reviewers see the phased rollout explicitly rather than a silent stub.
 */
export class PlatformMethodNotImplementedError extends Error {
  constructor(
    public readonly method: keyof ExecutionPlatform,
    public readonly plannedPr: string
  ) {
    super(
      `ExecutionPlatform.${String(method)} is not implemented yet; ` +
        `scheduled for ${plannedPr}. No runtime path should call it before then.`
    );
    this.name = "PlatformMethodNotImplementedError";
  }
}
