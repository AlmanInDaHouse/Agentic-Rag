/**
 * A8.7 Budget & Quota view-model (mandate §10 A8.7).
 *
 * Shows the budget/quota state with each signal SEPARATE and HONEST: configured,
 * reserved, consumed, the provider-reported signal, estimated, unknown, rate-limited and
 * exhausted — and a reset time ONLY when reliable (never fabricated). An unknown-capacity
 * quota is NEVER presented as guaranteed availability. Pure + deterministic.
 */

export interface QuotaSnapshotInput {
  provider: string;
  /** Configured capacity, or null when unknown. */
  configured: number | null;
  reserved: number;
  consumed: number;
  /** available | warning | rate_limited | exhausted | unknown. */
  status: string;
  capacityKnown: boolean;
  /** A raw provider-reported quota signal, when any (never authoritative billing). */
  providerReportedSignal: string | null;
  /** Reset timestamp, only meaningful when `resetReliable`. */
  resetsAt: string | null;
  resetReliable: boolean;
}

export type QuotaConfidence = "known" | "estimated" | "unknown";

export interface QuotaView {
  provider: string;
  configured: number | "unknown";
  reserved: number;
  consumed: number;
  remaining: number | "unknown";
  statusLabel: string;
  confidence: QuotaConfidence;
  providerReported: string;
  reset: string;
}

function statusLabelOf(status: string): string {
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

function confidenceOf(capacityKnown: boolean, status: string): QuotaConfidence {
  if (capacityKnown) {
    return "known";
  }
  return status === "unknown" ? "unknown" : "estimated";
}

export function buildBudgetQuotaView(snap: QuotaSnapshotInput): QuotaView {
  const remaining: number | "unknown" =
    snap.capacityKnown && snap.configured !== null
      ? Math.max(0, snap.configured - snap.reserved - snap.consumed)
      : "unknown";

  return {
    provider: snap.provider,
    configured: snap.configured ?? "unknown",
    reserved: snap.reserved,
    consumed: snap.consumed,
    remaining,
    statusLabel: statusLabelOf(snap.status),
    confidence: confidenceOf(snap.capacityKnown, snap.status),
    providerReported: snap.providerReportedSignal ?? "none",
    // Reset time shown ONLY when reliable AND present — never fabricated.
    reset: snap.resetReliable && snap.resetsAt ? snap.resetsAt : "unknown"
  };
}
