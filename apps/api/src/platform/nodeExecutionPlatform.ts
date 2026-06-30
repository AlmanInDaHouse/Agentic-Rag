/**
 * A10-W.1 — Node-backed {@link ExecutionPlatform} implementations.
 *
 * `BaseExecutionPlatform` implements the methods A10-W.1 can honestly back on a
 * real host today (platform identity, lexical+on-disk workspace-path
 * normalization, filesystem-entry inspection). The OS-specific heavyweight
 * behavior (deny-by-default containment, Job-Object process supervision,
 * restricted environments) is declared by the interface and throws
 * {@link PlatformMethodNotImplementedError} naming the PR that fills it in, so the
 * phased rollout is explicit. Nothing in the runtime calls those methods yet.
 *
 * NOTE: the reparse-point / junction / ADS / reserved-name analysis here is the
 * MINIMAL honest version (symlink detection + realpath divergence). The full
 * Windows path-security policy is A10-W.2; this file is deliberately conservative
 * and never claims containment.
 */

import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  type CanonicalPath,
  type ExecutionPlatform,
  type FilesystemEntryEvidence,
  type ManagedProcess,
  type ManagedProcessRequest,
  type PathValidationRequest,
  type PathValidationResult,
  type PlatformId,
  PlatformMethodNotImplementedError,
  type RestrictedEnvironment,
  type RestrictedEnvironmentRequest,
  type TerminationReason,
  type TerminationResult
} from "@triforge/shared";
import {
  defaultForbiddenRoots,
  makeNodeWindowsCanonicalizer,
  validateWindowsContainedPath,
  type WindowsPathCanonicalizer
} from "./windowsPathPolicy.js";

abstract class BaseExecutionPlatform implements ExecutionPlatform {
  abstract readonly platformId: PlatformId;

  /** Derive the stable volume/drive/device id for an absolute path. */
  protected abstract deriveVolumeId(absolutePath: string): string;

  async normalizeWorkspacePath(input: string): Promise<CanonicalPath> {
    const lexical = path.normalize(path.resolve(input));

    // Walk up to the nearest ancestor that exists on disk, accumulating the
    // not-yet-existing tail segments (a file about to be written, etc.). `found`
    // records whether the leaf itself existed — do NOT infer existence from an
    // empty tail, because the loop also exits with an empty tail when the input
    // IS an absent volume/UNC root (the dirname fixpoint).
    let existing = lexical;
    const tail: string[] = [];
    let found = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await lstat(existing);
        found = true;
        break;
      } catch (err) {
        // Only ENOENT/ENOTDIR mean "genuinely absent" → keep walking up. An
        // inaccessible existing segment (EACCES/EPERM…) stops the walk rather than
        // being misread as an absent tail component.
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined;
        if (code !== "ENOENT" && code !== "ENOTDIR") break;
        const parent = path.dirname(existing);
        if (parent === existing) break; // reached the volume root, still absent
        tail.unshift(path.basename(existing));
        existing = parent;
      }
    }

    // Reparse-point detection mirrors inspectFilesystemEntry (lstat + isSymbolicLink,
    // which on Windows covers symlinks/junctions/mount points). Walk the EXISTING
    // chain segment-by-segment — never inferred from realpath divergence, which
    // also fires on 8.3 short names / case canonicalization (false positive) and
    // silently misses a dangling reparse leaf whose realpath throws (false
    // negative / fail-open).
    let hasReparsePointInChain = false;
    if (found) {
      let cursor = existing;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const link = await lstat(cursor);
          if (link.isSymbolicLink()) {
            hasReparsePointInChain = true;
            break;
          }
        } catch {
          // missing/inaccessible segment — leave as not-detected
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }

    // Canonicalize the existing base for the absolute path (best effort; a
    // dangling reparse leaf makes realpath throw — keep the lexical base then).
    let realBase = existing;
    try {
      realBase = await realpath(existing);
    } catch {
      // keep the lexical ancestor
    }

    const absolute = tail.length > 0 ? path.join(realBase, ...tail) : realBase;
    const exists = found && tail.length === 0;

    return {
      absolute,
      volumeId: this.deriveVolumeId(absolute),
      exists,
      hasReparsePointInChain
    };
  }

  async inspectFilesystemEntry(p: string): Promise<FilesystemEntryEvidence> {
    const abs = path.resolve(p);
    try {
      const link = await lstat(abs);
      const isReparsePoint = link.isSymbolicLink();
      let isDirectory = link.isDirectory();
      let isFile = link.isFile();
      if (isReparsePoint) {
        try {
          const target = await stat(abs);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          // dangling reparse point; leave the lstat-derived flags
        }
      }
      return {
        path: abs,
        exists: true,
        isDirectory,
        isFile,
        isReparsePoint,
        volumeId: this.deriveVolumeId(abs)
      };
    } catch {
      return {
        path: abs,
        exists: false,
        isDirectory: false,
        isFile: false,
        isReparsePoint: false,
        volumeId: this.deriveVolumeId(abs)
      };
    }
  }

  // ---- Deferred to later A10-W PRs (declared by the contract, not yet wired) ----
  // These are `async` so the typed Promise contract is honored as a REJECTION
  // (not a synchronous throw), so a future `.catch()` / fire-and-forget caller
  // cannot leak an uncaught exception.

  async validateContainedPath(_request: PathValidationRequest): Promise<PathValidationResult> {
    throw new PlatformMethodNotImplementedError("validateContainedPath", "A10-W.2 (Windows path security policy)");
  }

  async createManagedProcess(_request: ManagedProcessRequest): Promise<ManagedProcess> {
    throw new PlatformMethodNotImplementedError("createManagedProcess", "A10-W.4 (Job Object process supervisor)");
  }

  async terminateProcessTree(_processId: string, _reason: TerminationReason): Promise<TerminationResult> {
    throw new PlatformMethodNotImplementedError("terminateProcessTree", "A10-W.4 (Job Object process supervisor)");
  }

  async createRestrictedEnvironment(_request: RestrictedEnvironmentRequest): Promise<RestrictedEnvironment> {
    throw new PlatformMethodNotImplementedError("createRestrictedEnvironment", "A10-W.5 (Windows isolation boundary)");
  }
}

/** Native Windows substrate (ADR 0056) — the initial supported platform. */
export class WindowsExecutionPlatform extends BaseExecutionPlatform {
  readonly platformId = "windows" as const;

  private readonly canonicalizer: WindowsPathCanonicalizer = makeNodeWindowsCanonicalizer();

  protected deriveVolumeId(absolutePath: string): string {
    // Drive letter ("C:\") or UNC root ("\\server\share\"); uppercased for
    // NTFS case-insensitive comparison. Empty root falls back to the input.
    const root = path.parse(absolutePath).root;
    return (root || absolutePath).toUpperCase();
  }

  /**
   * A10-W.2 — deny-by-default Windows containment (volume identity + canonical
   * resolution + case-folded segment-boundary containment; never a raw startsWith).
   * Blocks UNC/extended/device namespaces, ADS, reserved device names, trailing
   * dot/space, reparse/junction escapes, `.git`, and system/credential/state roots.
   */
  override validateContainedPath(request: PathValidationRequest): Promise<PathValidationResult> {
    return validateWindowsContainedPath(request, {
      canonicalize: this.canonicalizer,
      forbiddenRoots: defaultForbiddenRoots(request.containmentRoot)
    });
  }
}

/** POSIX substrate (ADR 0030 legacy) — future / optional. */
export class PosixExecutionPlatform extends BaseExecutionPlatform {
  readonly platformId = "posix" as const;

  protected deriveVolumeId(_absolutePath: string): string {
    // A10-W.1 uses the filesystem root as the volume id. Per-device (st_dev)
    // identity is a future refinement and is not required on the Windows target.
    return "/";
  }
}
