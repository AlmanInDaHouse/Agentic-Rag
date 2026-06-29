/**
 * A8.1 Provider status view-model (mandate §10 A8.1).
 *
 * Derives the DISPLAY state of a provider from a backend snapshot WITHOUT inventing
 * anything the backend does not know: an absent field becomes an explicit "unknown" /
 * "never verified", never a fabricated default, and an unknown quota is NEVER presented
 * as guaranteed availability. Pure + deterministic.
 */

import type { AuthenticationState, AvailabilityStatus, ProviderId, QuotaStatus } from "@triforge/shared";
import { stripControlAndAnsi } from "./sanitize.js";

export interface ProviderStatusSnapshot {
  provider: ProviderId;
  availability: AvailabilityStatus;
  /** Installed CLI version, or null when not detected (→ unknown). */
  version: string | null;
  auth: AuthenticationState;
  /** Capabilities from a version-bound snapshot, or null when never snapshotted. */
  capabilities: string[] | null;
  quotaStatus: QuotaStatus;
  /** Whether the quota CAPACITY is actually known (vs estimated/unknown). */
  quotaKnown: boolean;
  /** ISO timestamp of the last verification, or null (→ never verified). */
  lastVerified: string | null;
  warnings: string[];
  /** Whether the installed version is supported, or null when unknown. */
  supportedVersion: boolean | null;
}

export type Installed = "installed" | "not installed" | "unknown";
export type QuotaConfidence = "known" | "estimated" | "unknown";
export type VersionSupport = "supported" | "unsupported" | "unknown";

export interface ProviderStatusView {
  provider: ProviderId;
  installed: Installed;
  version: string;
  authLabel: string;
  capabilities: { value: string[]; known: boolean };
  quota: QuotaConfidence;
  quotaLabel: string;
  lastVerified: string;
  warnings: string[];
  versionSupport: VersionSupport;
}

function installedOf(a: AvailabilityStatus): Installed {
  if (a === "available") return "installed";
  if (a === "unavailable") return "not installed";
  return "unknown";
}

function authLabelOf(auth: AuthenticationState): string {
  switch (auth) {
    case "authenticated":
      return "authenticated";
    case "required":
      return "login required";
    case "expired":
      return "auth expired";
    default:
      return "unknown";
  }
}

/**
 * Quota confidence — an UNKNOWN-capacity quota is never reported as guaranteed
 * availability (it is at best "estimated", at worst "unknown").
 */
function quotaConfidenceOf(status: QuotaStatus, known: boolean): QuotaConfidence {
  if (known) return "known";
  return status === "unknown" ? "unknown" : "estimated";
}

function quotaLabelOf(status: QuotaStatus): string {
  switch (status) {
    case "available":
      return "available";
    case "warning":
      return "warning";
    case "rate_limited":
      return "rate limited";
    case "exhausted":
      return "exhausted";
    default:
      return "unknown";
  }
}

function versionSupportOf(supported: boolean | null): VersionSupport {
  if (supported === null) return "unknown";
  return supported ? "supported" : "unsupported";
}

/** Map a backend snapshot to an honest display view-model. */
export function deriveProviderStatusView(snapshot: ProviderStatusSnapshot): ProviderStatusView {
  return {
    provider: snapshot.provider,
    installed: installedOf(snapshot.availability),
    version: snapshot.version ? stripControlAndAnsi(snapshot.version) : "unknown",
    authLabel: authLabelOf(snapshot.auth),
    capabilities: {
      value: (snapshot.capabilities ?? []).map(stripControlAndAnsi),
      known: snapshot.capabilities !== null
    },
    quota: quotaConfidenceOf(snapshot.quotaStatus, snapshot.quotaKnown),
    quotaLabel: quotaLabelOf(snapshot.quotaStatus),
    lastVerified: snapshot.lastVerified ?? "never verified",
    warnings: snapshot.warnings.map(stripControlAndAnsi),
    versionSupport: versionSupportOf(snapshot.supportedVersion)
  };
}
