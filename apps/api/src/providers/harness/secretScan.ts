/**
 * Secret-leakage scanner for the adapter harness (A2.2).
 *
 * A black-box, allocation-light scan of serialized event payloads and evidence
 * refs for obvious credential shapes. It is intentionally conservative: it must
 * FLAG the `secretLikePayload` scenario (a clearly-FAKE AWS example key) and must
 * NOT raise false positives on benign-but-large output such as the
 * `oversizedOutput` scenario (~70 KB of a single repeated character — zero
 * entropy). This is a detection aid, not a redaction control (redaction lands in
 * A4/A5); the harness only proves a leaking adapter is caught.
 *
 * Severity split (so the harness is a correct A3 gate, not just a mock gate):
 *  - `"high"`   — a specific, high-signal credential SHAPE (AWS key id, PEM block,
 *                 JWT, prefixed provider key, Slack token). These are HARD
 *                 failures of NO_SECRET_LEAKAGE.
 *  - `"entropy"`— the generic long high-entropy token heuristic. A real read-only
 *                 reviewer legitimately cites base64 blobs, content hashes and
 *                 random-looking ids, so an entropy hit must NOT hard-fail
 *                 conformance; it surfaces as a non-failing WARNING the operator
 *                 can triage. (Known limitation: hex-encoded secrets fall below
 *                 the alnum-run threshold and are not flagged — REQUIRES_VERIFICATION.)
 *
 * Pure and deterministic: no I/O, no network, no randomness.
 */

import type { ProviderEvent } from "@triforge/shared";

/** Severity of a finding: a specific credential shape vs the generic entropy heuristic. */
export type SecretSeverity = "high" | "entropy";

/** A single secret-shape match found in a serialized payload / evidence ref. */
export interface SecretFinding {
  /** Index of the event in the collected stream. */
  eventIndex: number;
  /** The event's sequenceNumber, or null when absent/non-numeric. */
  sequenceNumber: number | null;
  /** Name of the detector that matched. */
  detector: string;
  /**
   * `"high"` for a specific credential shape (hard-fails NO_SECRET_LEAKAGE);
   * `"entropy"` for the generic high-entropy heuristic (non-failing warning).
   */
  severity: SecretSeverity;
  /** A truncated, redacted sample of the match (never the full secret). */
  sample: string;
}

interface PatternDetector {
  name: string;
  regex: RegExp;
}

/**
 * Fixed-shape credential detectors. Each uses a sticky-free global regex so we
 * can enumerate every match. These cover the obvious high-signal shapes; the
 * generic high-entropy pass below catches long random tokens that have no fixed
 * prefix.
 */
const PATTERN_DETECTORS: PatternDetector[] = [
  // AWS access key id (AKIA… and the other documented prefixes).
  {
    name: "aws_access_key_id",
    regex: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g
  },
  // PEM private key header.
  { name: "private_key_block", regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  // JSON Web Token (three base64url segments).
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g
  },
  // Prefixed provider API keys (sk-…, pk-…, rk-…).
  { name: "api_key_prefixed", regex: /\b[sprk]k-[A-Za-z0-9]{16,}\b/g },
  // Slack tokens (xoxb-…, xoxp-…, …).
  { name: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g }
];

/** Generic high-entropy token shape (long alnum/base64-ish run). */
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/=_-]{32,}/g;
/** Shannon-entropy threshold (bits/char) above which a long token looks random. */
const HIGH_ENTROPY_BITS = 4.2;

/** Shannon entropy (bits per character) of a string. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Truncated, redacted sample so findings never echo a full secret. */
function redactSample(match: string): string {
  const head = match.slice(0, 6);
  return match.length > 6 ? `${head}…(${match.length} chars)` : `${head}…`;
}

/** The serialized text scanned per event: its payload plus its evidence ref. */
function scanTextForEvent(event: ProviderEvent): string {
  const payload = (event as { payload?: unknown }).payload;
  const evidenceRef = (event as { rawEvidenceRef?: unknown }).rawEvidenceRef;
  const ref = typeof evidenceRef === "string" ? evidenceRef : "";
  let payloadText: string;
  try {
    payloadText = JSON.stringify(payload ?? null);
  } catch {
    // Defensive: a payload with a circular structure (never in mocks) still scans.
    payloadText = String(payload);
  }
  return `${payloadText}\n${ref}`;
}

/** Scan one serialized string for every detector, returning de-duplicated hits. */
function scanString(text: string): { detector: string; severity: SecretSeverity; sample: string }[] {
  const hits: { detector: string; severity: SecretSeverity; sample: string }[] = [];
  const seen = new Set<string>();

  for (const detector of PATTERN_DETECTORS) {
    detector.regex.lastIndex = 0;
    for (const match of text.matchAll(detector.regex)) {
      const key = `${detector.name}:${match[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ detector: detector.name, severity: "high", sample: redactSample(match[0]) });
      }
    }
  }

  HIGH_ENTROPY_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(HIGH_ENTROPY_TOKEN)) {
    const token = match[0];
    if (shannonEntropy(token) >= HIGH_ENTROPY_BITS) {
      const key = `high_entropy_token:${token}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Downgraded to a non-failing WARNING: a real reviewer legitimately cites
        // base64/hashes, so an entropy hit must not hard-fail NO_SECRET_LEAKAGE.
        hits.push({ detector: "high_entropy_token", severity: "entropy", sample: redactSample(token) });
      }
    }
  }

  return hits;
}

/**
 * Scan a collected event stream for obvious secret shapes. Returns EVERY finding
 * (both `"high"` specific shapes and `"entropy"` warnings); an empty array means
 * the stream looks clean to this scanner. Callers split by `severity`: only
 * `"high"` findings hard-fail NO_SECRET_LEAKAGE (see the harness).
 */
export function scanEventsForSecrets(events: ProviderEvent[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  events.forEach((event, eventIndex) => {
    const seqRaw = (event as { sequenceNumber?: unknown }).sequenceNumber;
    const sequenceNumber = typeof seqRaw === "number" ? seqRaw : null;
    for (const hit of scanString(scanTextForEvent(event))) {
      findings.push({
        eventIndex,
        sequenceNumber,
        detector: hit.detector,
        severity: hit.severity,
        sample: hit.sample
      });
    }
  });
  return findings;
}
