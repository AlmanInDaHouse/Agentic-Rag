/**
 * A10-W.2 — Windows path security policy (mandate §5).
 *
 * Deny-by-default containment for native Windows. The owner-facing
 * {@link PathPolicyEngine} (A5.2) already does lexical resolve + realpath
 * containment + `.git`/hardlink refusal; this module adds the Windows-specific
 * hardening that POSIX `realpath`/case-sensitive containment does NOT cover:
 *
 *   drive letters · case-insensitivity (NTFS) · `/` and `\` separators · `.`/`..`
 *   · UNC (`\\server\share`) · extended-length (`\\?\`) · device namespaces (`\\.\`)
 *   · alternate data streams (`name:stream`) · reserved device names (CON, NUL, …)
 *   · trailing dots/spaces (NTFS strips them) · symlinks / junctions / mount points /
 *   reparse points · hardlinks · nonexistent targets via nearest-existing-ancestor
 *   canonicalization · prefix confusion · volume changes · `.git` · the state root,
 *   user profile, AppData, ProgramData, Windows dir and credential directories.
 *
 * NEVER authorize with a raw textual `startsWith`. Containment is volume identity +
 * canonical (realpath) resolution + a case-folded, segment-boundary relative check.
 *
 * The lexical layer uses `path.win32` explicitly so it is correct (and unit-testable)
 * on ANY host (Linux CI included). The filesystem layer (nearest-existing-ancestor +
 * reparse walk + realpath) is injected via {@link WindowsPathCanonicalizer}; the real
 * binding (`makeNodeWindowsCanonicalizer`) is only meaningful on a real Windows host,
 * where the negative matrix is verified (`verified_real_environment`).
 */

import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { CanonicalPath, PathValidationRequest, PathValidationResult } from "@triforge/shared";

const w = path.win32;
const MAX_INPUT_LENGTH = 4096;

/** Reserved DOS device names (case-insensitive; also when carrying an extension). */
const RESERVED_DEVICE_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
  "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

export type WindowsPathDenyReason =
  | "invalid_input"
  | "dangerous_namespace"
  | "alternate_data_stream"
  | "reserved_device_name"
  | "trailing_dot_or_space"
  | "different_volume"
  | "escapes_containment"
  | "denied_reparse_point"
  | "nonexistent_leaf"
  | "blocked_git"
  | "blocked_sensitive_location";

/** Result of canonicalizing an absolute path against the real filesystem. */
export interface CanonicalizeResult {
  /** realpath'd nearest existing ancestor + the validated not-yet-existing tail. */
  readonly canonicalAbsolute: string;
  /** True if the leaf itself exists on disk. */
  readonly leafExists: boolean;
  /** True if any existing segment in the chain is a symlink/junction/mount point. */
  readonly reparseInChain: boolean;
  /**
   * False if an EXISTING segment could not be canonicalized (dangling reparse /
   * permission error) — a fail-safe signal to deny rather than trust the lexical path.
   */
  readonly resolvable: boolean;
}

export type WindowsPathCanonicalizer = (absPath: string) => Promise<CanonicalizeResult>;

/** Dependencies for the Windows containment evaluation. */
export interface WindowsContainmentDeps {
  canonicalize: WindowsPathCanonicalizer;
  /**
   * Absolute, forbidden roots (user profile, AppData, ProgramData, Windows dir,
   * credential dirs, the TriForge state root, sibling worktrees) — a canonical target
   * landing inside ANY of them is denied (defense in depth on top of containment).
   * The active containment root is excluded by the caller.
   */
  forbiddenRoots?: readonly string[];
}

// ----------------------------- lexical primitives -----------------------------

/**
 * Lowercase + backslash-normalized form for NTFS case-insensitive comparison.
 * NOTE: `toLowerCase` is locale-independent (Turkish-I safe) and ASCII-correct, but
 * it is an APPROXIMATION of the NTFS `$UpCase` table and diverges for a few exotic
 * codepoints (e.g. U+212A KELVIN SIGN → "k", U+0130 expands). The containment
 * guarantee assumes a system-controlled (ASCII) worktree root — an attacker cannot
 * arrange the colliding root segment needed to exploit a fold collision.
 */
export function toComparable(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

/** Volume identity (drive root, uppercased) for an absolute win32 path. */
export function win32VolumeId(absPath: string): string {
  const root = w.parse(absPath).root;
  return (root || absPath).toUpperCase();
}

/** Validate the raw input string (empty / oversized / NUL). */
export function validateRawInput(target: string): WindowsPathDenyReason | null {
  if (typeof target !== "string" || target.length === 0 || target.length > MAX_INPUT_LENGTH) {
    return "invalid_input";
  }
  if (target.includes("\0")) return "invalid_input";
  return null;
}

/**
 * Reject UNC, extended-length and device namespaces. A worktree is always a local
 * drive path, so any input that (after separator normalization) starts with two
 * slashes — `\\server\share` (UNC), `\\?\…` (extended), `\\.\…` (device) — is
 * out of bounds by construction.
 */
export function rejectDangerousNamespace(target: string): WindowsPathDenyReason | null {
  const norm = target.replace(/\//g, "\\");
  if (/^\\\\/.test(norm)) return "dangerous_namespace";
  return null;
}

/** Segments of an absolute win32 path BELOW the drive/volume root. */
export function segmentsBelowRoot(absPath: string): string[] {
  const parsed = w.parse(absPath);
  const rest = absPath.slice(parsed.root.length);
  return rest.split(/[\\/]/).filter((s) => s.length > 0);
}

/** An alternate-data-stream marker (`:`) in any non-root segment. */
export function findAlternateDataStream(segments: readonly string[]): string | null {
  for (const seg of segments) {
    if (seg.includes(":")) return seg;
  }
  return null;
}

/** A reserved DOS device name in any segment (base name before the first dot). */
export function findReservedDeviceName(segments: readonly string[]): string | null {
  for (const seg of segments) {
    // NTFS strips trailing dots/spaces before resolving the device name.
    const stripped = seg.replace(/[. ]+$/, "");
    const base = stripped.split(".")[0]?.toUpperCase() ?? "";
    if (RESERVED_DEVICE_NAMES.has(base)) return seg;
  }
  return null;
}

/** A trailing dot or space on any segment (NTFS silently strips → aliasing/escape). */
export function findTrailingDotOrSpace(segments: readonly string[]): string | null {
  for (const seg of segments) {
    if (/[. ]$/.test(seg)) return seg;
  }
  return null;
}

/**
 * Case-insensitive, segment-boundary containment of `targetAbs` within `rootAbs`
 * using `path.win32.relative` on case-folded paths — NOT a raw `startsWith`.
 * Returns true when target IS the root or strictly inside it.
 */
export function lexicalContains(rootAbs: string, targetAbs: string): boolean {
  const rel = w.relative(toComparable(rootAbs), toComparable(targetAbs));
  if (rel === "") return true; // the root itself
  return !rel.startsWith("..") && !w.isAbsolute(rel);
}

/** A `.git` segment (case-insensitive) anywhere below the root. */
export function hasGitSegment(rootAbs: string, targetAbs: string): boolean {
  const rel = w.relative(toComparable(rootAbs), toComparable(targetAbs));
  return rel.split(/[\\/]/).some((s) => s === ".git");
}

/** The forbidden root (if any) that contains `targetAbs` (case-insensitive). */
export function matchForbiddenRoot(
  targetAbs: string,
  forbiddenRoots: readonly string[]
): string | null {
  for (const root of forbiddenRoots) {
    if (lexicalContains(root, targetAbs)) return root;
  }
  return null;
}

// ----------------------------- the evaluation -----------------------------

function deny(reason: WindowsPathDenyReason, detail: string): PathValidationResult {
  return { allowed: false, canonical: null, denyReason: reason, detail };
}

/**
 * Deny-by-default Windows containment. Pipeline (mandate §5 steps 1–13):
 *  validate input → reject dangerous namespaces → resolve absolute → reject
 *  ADS / reserved names / trailing dot-space → verify volume → lexical containment
 *  → canonicalize (nearest-existing-ancestor + reparse walk + realpath) → re-verify
 *  volume + containment on the canonical path → block `.git` + sensitive locations →
 *  return ONLY the canonical authorized path.
 */
export async function validateWindowsContainedPath(
  request: PathValidationRequest,
  deps: WindowsContainmentDeps
): Promise<PathValidationResult> {
  const { target, containmentRoot } = request;

  // 1. raw input
  const rawReason = validateRawInput(target);
  if (rawReason) return deny(rawReason, "empty, oversized, or NUL-bearing path");

  // 2. dangerous namespaces (UNC / \\?\ / \\.\)
  const nsReason = rejectDangerousNamespace(target);
  if (nsReason) return deny(nsReason, "UNC / extended-length / device namespace is out of bounds");

  // 3. resolve absolute (collapses ./.., an absolute or different-drive target keeps its own root)
  const rootAbs = w.resolve(containmentRoot);
  const targetAbs = w.resolve(containmentRoot, target);

  // 4. lexical segment hazards (ADS / reserved names / trailing dot-space)
  const segments = segmentsBelowRoot(targetAbs);
  const ads = findAlternateDataStream(segments);
  if (ads) return deny("alternate_data_stream", `alternate data stream in segment "${ads}"`);
  const reserved = findReservedDeviceName(segments);
  if (reserved) return deny("reserved_device_name", `reserved device name "${reserved}"`);
  const trailing = findTrailingDotOrSpace(segments);
  if (trailing) return deny("trailing_dot_or_space", `trailing dot/space in segment "${trailing}"`);

  // 5. volume identity (different drive / changed volume)
  if (win32VolumeId(targetAbs) !== win32VolumeId(rootAbs)) {
    return deny("different_volume", `target volume ${win32VolumeId(targetAbs)} != root ${win32VolumeId(rootAbs)}`);
  }

  // 6. cheap lexical containment (rejects ../ escapes and same-drive absolute escapes)
  if (!lexicalContains(rootAbs, targetAbs)) {
    return deny("escapes_containment", `lexically escapes the workspace: ${targetAbs}`);
  }

  // 7. canonicalize against the real filesystem (nearest ancestor + reparse + realpath)
  const canonTarget = await deps.canonicalize(targetAbs);
  if (!canonTarget.resolvable) {
    return deny("denied_reparse_point", "an existing segment could not be canonicalized (dangling reparse / denied)");
  }
  const canonRoot = await deps.canonicalize(rootAbs);
  if (!canonRoot.resolvable) {
    return deny("denied_reparse_point", "the containment root could not be canonicalized");
  }

  // 8. re-verify volume + containment on the CANONICAL paths (catches symlink/junction escape)
  if (win32VolumeId(canonTarget.canonicalAbsolute) !== win32VolumeId(canonRoot.canonicalAbsolute)) {
    return deny("different_volume", "canonical target crosses a volume boundary (reparse escape)");
  }
  if (!lexicalContains(canonRoot.canonicalAbsolute, canonTarget.canonicalAbsolute)) {
    return deny("escapes_containment", `canonical path resolves outside the workspace (reparse/symlink escape): ${canonTarget.canonicalAbsolute}`);
  }

  // 9. block `.git` (the gitdir link + the shared object store)
  if (hasGitSegment(canonRoot.canonicalAbsolute, canonTarget.canonicalAbsolute)) {
    return deny("blocked_git", "the worktree .git is not accessible");
  }

  // 10. block sensitive system / credential / state locations (defense in depth)
  if (deps.forbiddenRoots && deps.forbiddenRoots.length > 0) {
    const hit = matchForbiddenRoot(canonTarget.canonicalAbsolute, deps.forbiddenRoots);
    if (hit) return deny("blocked_sensitive_location", `canonical path is within a forbidden location: ${hit}`);
  }

  // 10.5 honor allowNonexistentLeaf: a caller may require the target to already exist.
  if (request.allowNonexistentLeaf === false && !canonTarget.leafExists) {
    return deny("nonexistent_leaf", "target does not exist and allowNonexistentLeaf is false");
  }

  // 11. authorized — return ONLY the canonical path
  const canonical: CanonicalPath = {
    absolute: canonTarget.canonicalAbsolute,
    volumeId: win32VolumeId(canonTarget.canonicalAbsolute),
    exists: canonTarget.leafExists,
    hasReparsePointInChain: canonTarget.reparseInChain
  };
  return {
    allowed: true,
    canonical,
    denyReason: null,
    detail: canonTarget.reparseInChain
      ? "contained (a contained reparse point is present in the chain)"
      : "contained"
  };
}

// ----------------------------- real fs canonicalizer -----------------------------

/**
 * Real-filesystem canonicalizer for native Windows (uses `path.win32` + `node:fs`).
 * Walks to the nearest existing ancestor, detects reparse points via
 * `lstat`/`isSymbolicLink` segment-by-segment, and realpaths the existing base.
 * Only meaningful on a real Windows host (the negative matrix runs there).
 */
export function makeNodeWindowsCanonicalizer(): WindowsPathCanonicalizer {
  const errnoOf = (err: unknown): string | undefined =>
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined;

  return async (absPath: string): Promise<CanonicalizeResult> => {
    const lexical = w.normalize(absPath);

    let existing = lexical;
    const tail: string[] = [];
    let found = false;
    let resolvable = true;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await lstat(existing);
        found = true;
        break;
      } catch (err) {
        const code = errnoOf(err);
        // Only ENOENT/ENOTDIR mean "this segment is genuinely absent" → keep
        // walking up. Any OTHER error (EACCES/EPERM/EBUSY…) is an EXISTING but
        // inaccessible segment that must FAIL SAFE — never reinterpret it as an
        // absent tail component (which would skip the reparse walk and could
        // rebuild a contained-looking canonical path for an escaping junction).
        if (code !== "ENOENT" && code !== "ENOTDIR") {
          resolvable = false;
          break;
        }
        const parent = w.dirname(existing);
        if (parent === existing) break; // volume root, still absent
        tail.unshift(w.basename(existing));
        existing = parent;
      }
    }

    // An inaccessible existing segment denies by default (caller maps to denied_reparse_point).
    if (!resolvable) {
      return { canonicalAbsolute: lexical, leafExists: false, reparseInChain: true, resolvable: false };
    }

    // reparse walk over the existing chain
    let reparseInChain = false;
    if (found) {
      let cursor = existing;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const link = await lstat(cursor);
          if (link.isSymbolicLink()) {
            reparseInChain = true;
            break;
          }
        } catch {
          /* inaccessible — leave as not-detected */
        }
        const parent = w.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }

    // canonicalize the existing base; an EXISTING path that fails realpath is a
    // fail-safe signal (dangling reparse / permission) → resolvable=false.
    let realBase = existing;
    if (found) {
      try {
        realBase = await realpath(existing);
      } catch {
        resolvable = false;
      }
    }

    const canonicalAbsolute = tail.length > 0 ? w.join(realBase, ...tail) : realBase;
    return {
      canonicalAbsolute,
      leafExists: found && tail.length === 0,
      reparseInChain,
      resolvable
    };
  };
}

/**
 * Build the default set of forbidden roots from the environment (user profile,
 * AppData, LocalAppData, ProgramData, Windows dir, `.ssh`), EXCLUDING any root that
 * is an ancestor of (or equal to) the active containment root — so a worktree that
 * legitimately lives under `%LOCALAPPDATA%\TriForge` is not self-blocked.
 */
export function defaultForbiddenRoots(
  containmentRoot: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const candidates = [
    env.USERPROFILE,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.ProgramData,
    env.WINDIR,
    env.SystemRoot,
    env.USERPROFILE ? w.join(env.USERPROFILE, ".ssh") : undefined,
    env.USERPROFILE ? w.join(env.USERPROFILE, ".aws") : undefined
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  const rootAbs = w.resolve(containmentRoot);
  // Exclude any forbidden root that contains the worktree (else we'd block the
  // worktree itself). The narrower TriForge state root stays allowed via this rule.
  return candidates
    .map((p) => w.resolve(p))
    .filter((p) => !lexicalContains(p, rootAbs));
}
