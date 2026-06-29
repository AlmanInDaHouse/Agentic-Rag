/**
 * A8 UI safe-rendering helpers (mandate §10 "A8 Security").
 *
 * React already escapes HTML in text children (so `{value}` cannot inject markup —
 * XSS protection is inherent as long as we never use `dangerouslySetInnerHTML`). What
 * React does NOT protect against, and these helpers do, is:
 *  - terminal escape / ANSI control sequences in captured provider output (which a
 *    terminal would interpret) — stripped;
 *  - other C0/C1 control characters (incl. NUL) — stripped;
 *  - hostile filenames (control chars, overlong) — made visibly safe;
 *  - accidental secret rendering — masked;
 *  - oversized text (diff/output truncation) — truncated with an explicit flag.
 *
 * Pure + deterministic.
 */

// ANSI CSI escape sequences (ESC `[` … final byte) and OSC sequences (ESC `]` …).
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// C0 controls except \t (\x09) and \n (\x0a), DEL (\x7f) and C1 controls (\x80-\x9f).
// Strips the ESC byte (\x1b) too, so any residual escape text is inert.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Remove ANSI escape sequences and other control characters (terminal-escape safe). */
export function stripControlAndAnsi(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL, "");
}

export interface Truncated {
  text: string;
  truncated: boolean;
}

/** Truncate to `max` characters, flagging when content was dropped. */
export function truncate(text: string, max: number): Truncated {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, max)}…`, truncated: true };
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /(?<=\b(?:api[_-]?key|apikey|token|secret|password|passwd|credential|pat)\b\s*[:=]\s*['"]?)[^\s'"]{6,}/gi
];

/** Mask secret-shaped substrings so they never render in the UI. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "«redacted»");
  }
  return out;
}

/**
 * Make any captured text safe to render: redact secrets, strip control/ANSI, then
 * truncate. Use for provider output, findings, diffs, commit messages, etc.
 */
export function safeText(text: string, max = 20_000): Truncated {
  return truncate(stripControlAndAnsi(redactSecrets(text)), max);
}

/**
 * Render a (possibly hostile) filename safely: strip control chars and cap the length.
 * A path with control characters or excessive length is shown visibly cleaned — never
 * passed through raw (which could spoof the UI or smuggle terminal escapes).
 */
export function safeFilename(name: string): string {
  const cleaned = stripControlAndAnsi(name);
  return cleaned.length > 1024 ? `${cleaned.slice(0, 1024)}…` : cleaned;
}
