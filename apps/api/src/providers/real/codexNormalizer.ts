/**
 * Codex CLI output normalizer (A3).
 *
 * Maps the RAW `codex exec --json` output stream onto normalized A1 provider-event
 * intents. This is the ONLY Codex-specific normalizer code; the shared envelope,
 * ordering, terminal synthesis, parse-error/unknown-kind handling and usage/quota
 * plumbing live in normalizerCore.ts.
 *
 * Line format VERIFIED against installed codex 0.142.4 (A10-W.6 real-host probe,
 * 2026-06-30; OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20): stdout carries one JSON
 * object per line (JSONL); stderr carries human diagnostic logs (retained as
 * evidence, not mapped to events). Recognized stdout `type`s:
 *
 *   thread.started | turn.started |
 *     item.started | item.updated        -> lifecycle, ignored (core emits run.started)
 *   item.completed { item.type:
 *       agent_message }                  -> agent.message
 *       command_execution }              -> tool.started + tool.completed
 *       file_change | patch }            -> file.changed per item.changes[] (writable only)
 *   turn.completed { usage }             -> usage.updated (isBillingAuthoritative:false)
 *   token_count { usage }                -> usage.updated
 *   error { subtype, message }           -> terminal error (mapped to A1 taxonomy)
 *   thread.completed | task_complete     -> completion marker
 *
 * Any other `type` is reported as an unknown kind (a warning, never a crash) and
 * malformed JSON is reported as a parse error — never fabricated, never thrown.
 */

import type { ProviderError } from "@triforge/shared";
import type { ProcessOutputLine } from "./processRunner.js";
import type { MappedLine, NormalizedEvent, ProviderLineMapper } from "./normalizerCore.js";

interface JsonParse {
  ok: boolean;
  value?: unknown;
}

function tryParseJson(line: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Map a codex `error.subtype` to the A1 error taxonomy. Unrecognized → "unknown". */
function mapCodexErrorSubtype(subtype: string | undefined): ProviderError["code"] {
  switch (subtype) {
    case "usage_limit_reached":
    case "quota_exceeded":
      return "quota_exhausted";
    case "rate_limited":
    case "rate_limit":
      return "rate_limited";
    case "unauthorized":
    case "auth_required":
      return "authentication_required";
    case "auth_expired":
      return "authentication_expired";
    default:
      return "unknown";
  }
}

function mapUsage(usage: Record<string, unknown>): NormalizedEvent {
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  return {
    type: "usage.updated",
    payload: {
      usage: {
        provider: "codex",
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        source: "provider_event",
        isBillingAuthoritative: false
      }
    }
  };
}

/** Map a codex file-change kind/change_type onto the A1 `file.changed` changeType. */
function mapChangeKind(kind: string | undefined): "created" | "modified" | "deleted" | "renamed" {
  switch (kind) {
    case "add":
    case "added":
    case "created":
      return "created";
    case "delete":
    case "deleted":
    case "removed":
      return "deleted";
    case "rename":
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}

function mapItem(item: Record<string, unknown>): MappedLine {
  const itemType = str(item.type);
  const id = str(item.id) ?? "codex-item";
  switch (itemType) {
    case "agent_message": {
      const text = str(item.text) ?? "";
      return { events: [{ type: "agent.message", payload: { role: "assistant", text } }] };
    }
    case "command_execution": {
      const command = str(item.command) ?? "";
      const exitCode = typeof item.exit_code === "number" ? item.exit_code : 0;
      const events: NormalizedEvent[] = [
        {
          type: "tool.started",
          payload: { toolCallId: id, toolName: "command_execution", arguments: { command } }
        },
        {
          type: "tool.completed",
          payload: {
            toolCallId: id,
            toolName: "command_execution",
            status: exitCode === 0 ? "succeeded" : "failed",
            summary: command
          }
        }
      ];
      return { events };
    }
    case "file_change":
    case "patch": {
      // codex 0.142.4 emits `item.changes: [{ path, kind }]` (one item, many files);
      // older shapes carried a single `item.path` + `item.change_type`. Support both,
      // emitting one file.changed per change.
      const changes = Array.isArray(item.changes) ? item.changes : null;
      if (changes !== null) {
        const events: NormalizedEvent[] = [];
        for (const raw of changes) {
          const change = asRecord(raw);
          if (change === null) {
            continue;
          }
          const changedPath = str(change.path) ?? str(change.file) ?? "unknown";
          events.push({
            type: "file.changed",
            payload: { path: changedPath, changeType: mapChangeKind(str(change.kind)), diffHash: null }
          });
        }
        return events.length > 0 ? { events } : { unknownKind: "item.completed:file_change:no-changes" };
      }
      const path = str(item.path) ?? str(item.file) ?? "unknown";
      return {
        events: [
          { type: "file.changed", payload: { path, changeType: mapChangeKind(str(item.change_type)), diffHash: null } }
        ]
      };
    }
    default:
      return { unknownKind: `item.completed:${itemType ?? "missing"}` };
  }
}

/** The Codex line mapper. Pure; never throws. */
export const codexLineMapper: ProviderLineMapper = {
  provider: "codex",
  mapLine(line: ProcessOutputLine): MappedLine {
    // stderr is diagnostic logging only; retained as raw evidence, not an event.
    if (line.stream === "stderr") {
      return {};
    }
    const trimmed = line.line.trim();
    if (trimmed.length === 0) {
      return {};
    }
    const parsed = tryParseJson(trimmed);
    if (!parsed.ok) {
      return { parseError: "Malformed Codex JSONL line (not valid JSON)." };
    }
    const record = asRecord(parsed.value);
    if (record === null) {
      return { parseError: "Malformed Codex JSONL line (not a JSON object)." };
    }

    const type = str(record.type);
    switch (type) {
      case "thread.started":
      case "session.created":
      case "turn.started":
      case "item.started":
      case "item.updated":
        // Lifecycle / streaming-progress only; the matching item.completed carries the
        // authoritative final state (core emits run.started).
        return {};
      case "item.completed": {
        const item = asRecord(record.item);
        return item === null ? { unknownKind: "item.completed:no-item" } : mapItem(item);
      }
      case "turn.completed": {
        const usage = asRecord(record.usage);
        return usage === null ? {} : { events: [mapUsage(usage)] };
      }
      case "token_count": {
        const usage = asRecord(record.usage) ?? record;
        return { events: [mapUsage(usage)] };
      }
      case "error": {
        const code = mapCodexErrorSubtype(str(record.subtype));
        const message = sanitizeMessage(str(record.message), "Codex reported an error.");
        const events: NormalizedEvent[] = [];
        if (code === "quota_exhausted" || code === "rate_limited") {
          events.push({
            type: "quota.updated",
            payload: {
              quota: {
                provider: "codex",
                status: code === "quota_exhausted" ? "exhausted" : "rate_limited",
                window: "unknown",
                source: "provider_event",
                isBillingAuthoritative: false
              }
            }
          });
        }
        return { events, terminalError: { code, message } };
      }
      case "thread.completed":
      case "task_complete":
        return { completed: { summary: str(record.summary) ?? null } };
      default:
        return { unknownKind: type ?? "missing-type" };
    }
  }
};

/** Keep terminal/warning messages free of provider-supplied secret-like content. */
function sanitizeMessage(message: string | undefined, fallback: string): string {
  if (message === undefined || message.trim().length === 0) {
    return fallback;
  }
  // Conservative: cap length so an error message cannot smuggle a large secret blob.
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
