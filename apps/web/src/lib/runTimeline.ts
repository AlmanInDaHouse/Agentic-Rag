/**
 * A8.3 Run Timeline view-model (mandate §10 A8.3).
 *
 * Renders run events ORDERED BY SEQUENCE NUMBER — not by timestamp — because the A1
 * `ProviderEvent` carries a monotonic `sequenceNumber` and timestamps can tie or skew.
 * It DEDUPES a repeated sequence number (keeping the first), FLAGS a sequence GAP, and
 * sanitizes the event type + detail (captured content) so terminal escapes / control
 * chars / secrets never render. Pure + deterministic.
 *
 * Input is a minimal `RunEvent` (the caller maps an A1 `ProviderEvent` to it, extracting
 * a human `detail` from the typed payload), so this view-model is decoupled from the
 * payload union.
 */

import { safeText } from "./sanitize.js";

export interface RunEvent {
  sequenceNumber: number;
  type: string;
  timestamp: string;
  provider: string;
  /** A human summary extracted from the event payload (sanitized here). */
  detail?: string;
}

export interface TimelineEntry {
  sequenceNumber: number;
  type: string;
  timestamp: string;
  provider: string;
  detail: string;
}

export interface TimelineView {
  entries: TimelineEntry[];
  /** Missing sequence numbers between the first and last (a gap → possible dropped event). */
  gaps: number[];
  /** Sequence numbers that appeared more than once (deduped). */
  duplicateSequences: number[];
}

export function buildTimeline(events: readonly RunEvent[]): TimelineView {
  // Order by sequence number (stable for equal numbers).
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const seen = new Set<number>();
  const duplicateSequences: number[] = [];
  const entries: TimelineEntry[] = [];
  for (const e of sorted) {
    if (seen.has(e.sequenceNumber)) {
      duplicateSequences.push(e.sequenceNumber);
      continue;
    }
    seen.add(e.sequenceNumber);
    entries.push({
      sequenceNumber: e.sequenceNumber,
      type: safeText(e.type, 64).text,
      timestamp: e.timestamp,
      provider: e.provider,
      detail: e.detail ? safeText(e.detail, 2000).text : ""
    });
  }

  const gaps: number[] = [];
  if (entries.length > 0) {
    const min = entries[0].sequenceNumber;
    const max = entries[entries.length - 1].sequenceNumber;
    for (let s = min; s <= max; s += 1) {
      if (!seen.has(s)) {
        gaps.push(s);
      }
    }
  }

  return { entries, gaps, duplicateSequences };
}
