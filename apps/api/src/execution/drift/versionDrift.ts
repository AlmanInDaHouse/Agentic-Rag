/**
 * A9.3 Version & capability drift handling (mandate §11 A9.3).
 *
 * The runtime must treat an UNKNOWN / UNSUPPORTED provider CLI version and an UNSUPPORTED
 * capability HONESTLY — never silently trusting a drifted version or assuming a capability
 * the version-bound snapshot does not grant, and never inferring a WRITABLE capability
 * from a read-only snapshot. Pure + deterministic.
 */

export type VersionSupport = "supported" | "unsupported" | "unknown";

/** Parse a leading `major.minor.patch` from a version string (extra suffix ignored). */
export function parseSemver(version: string | null): [number, number, number] | null {
  if (!version) {
    return null;
  }
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: [number, number, number], b: [number, number, number]): -1 | 0 | 1 {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Classify an installed version against the supported floor. An absent/unparseable
 * version is `unknown` (NOT silently trusted); a version below the floor is `unsupported`.
 */
export function checkVersionSupport(installed: string | null, minimumSupported: string): VersionSupport {
  const got = parseSemver(installed);
  const floor = parseSemver(minimumSupported);
  if (got === null || floor === null) {
    return "unknown";
  }
  return compareSemver(got, floor) < 0 ? "unsupported" : "supported";
}

export type CapabilityGrant = "granted" | "refused" | "unknown";

export interface CapabilitySnapshotView {
  /** The version-bound capability list, or null when never snapshotted. */
  capabilities: string[] | null;
  /** Whether the snapshot was taken from a writable-verified provider. */
  writable: boolean;
}

/** Capabilities that imply writing to the repository (never inferred from a read-only snapshot). */
const WRITABLE_CAPABILITIES: ReadonlySet<string> = new Set(["write_local", "write", "commit", "apply_patch"]);

/**
 * Decide whether a requested capability is granted by the snapshot. No snapshot →
 * `unknown`; a capability not in the snapshot → `refused` (never assumed); a writable
 * capability requested against a read-only snapshot → `refused`.
 */
export function checkCapability(requested: string, snapshot: CapabilitySnapshotView): CapabilityGrant {
  if (snapshot.capabilities === null) {
    return "unknown";
  }
  if (WRITABLE_CAPABILITIES.has(requested) && !snapshot.writable) {
    return "refused";
  }
  return snapshot.capabilities.includes(requested) ? "granted" : "refused";
}
