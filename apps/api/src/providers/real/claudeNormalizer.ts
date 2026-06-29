/**
 * Claude Code output normalizer (A3).
 *
 * Maps the RAW `claude -p --output-format stream-json --verbose` output stream
 * onto normalized A1 provider-event intents. This is the ONLY Claude-specific
 * normalizer code; everything provider-agnostic lives in normalizerCore.ts.
 *
 * Assumed line format (REQUIRES_VERIFICATION against installed claude 2.1.195 —
 * OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20): stdout carries one JSON object per
 * line; stderr carries logs (retained as evidence, not mapped). Recognized
 * stdout `type`s:
 *
 *   system { subtype:init }              -> session init, ignored (core emits run.started)
 *   assistant { message.content[] }      -> text -> agent.message; tool_use -> tool.started
 *   user { message.content[] }           -> tool_result -> tool.completed
 *   result { subtype, is_error, usage,   -> usage.updated (+ quota.updated on limit)
 *            total_cost_usd, result }       then completion or a terminal error
 *
 * Any other `type` is reported as an unknown kind (a warning, never a crash) and
 * malformed JSON as a parse error — never fabricated, never thrown.
 */

import type { ProviderError } from "@triforge/shared";
import type { ProcessOutputLine } from "./processRunner.js";
import type { MappedLine, NormalizedEvent, ProviderLineMapper } from "./normalizerCore.js";

function tryParseJson(line: string): { ok: boolean; value?: unknown } {
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Map a Claude `result.subtype` (when is_error) to the A1 error taxonomy. */
function mapClaudeErrorSubtype(subtype: string | undefined): ProviderError["code"] {
  switch (subtype) {
    case "error_rate_limit":
    case "rate_limit":
      return "rate_limited";
    case "error_usage_limit":
    case "quota_exceeded":
      return "quota_exhausted";
    case "error_auth":
    case "authentication_required":
      return "authentication_required";
    case "error_max_turns":
    case "error_during_execution":
      return "process_crashed";
    default:
      return "unknown";
  }
}

function mapAssistant(message: Record<string, unknown>): MappedLine {
  const content = asArray(message.content);
  const events: NormalizedEvent[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (block === null) {
      continue;
    }
    const blockType = str(block.type);
    if (blockType === "text") {
      events.push({
        type: "agent.message",
        payload: { role: "assistant", text: str(block.text) ?? "" }
      });
    } else if (blockType === "tool_use") {
      const toolCallId = str(block.id) ?? "claude-tool";
      const toolName = str(block.name) ?? "tool";
      const input = asRecord(block.input) ?? {};
      events.push({
        type: "tool.started",
        payload: { toolCallId, toolName, arguments: input }
      });
    }
  }
  return { events };
}

function mapUser(message: Record<string, unknown>): MappedLine {
  const content = asArray(message.content);
  const events: NormalizedEvent[] = [];
  for (const raw of content) {
    const block = asRecord(raw);
    if (block === null || str(block.type) !== "tool_result") {
      continue;
    }
    const toolCallId = str(block.tool_use_id) ?? "claude-tool";
    const isError = block.is_error === true;
    events.push({
      type: "tool.completed",
      payload: {
        toolCallId,
        // The stream-json tool_result does not echo the tool name; correlation by
        // tool_use_id is a future enhancement (REQUIRES_VERIFICATION).
        toolName: "tool",
        status: isError ? "failed" : "succeeded",
        summary: null
      }
    });
  }
  return { events };
}

function mapResult(record: Record<string, unknown>): MappedLine {
  const events: NormalizedEvent[] = [];
  const usage = asRecord(record.usage);
  if (usage !== null) {
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
    const cacheReadTokens =
      typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined;
    const cost = typeof record.total_cost_usd === "number" ? record.total_cost_usd : undefined;
    const turns = typeof record.num_turns === "number" ? record.num_turns : undefined;
    events.push({
      type: "usage.updated",
      payload: {
        usage: {
          provider: "claude",
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
          ...(turns !== undefined ? { turns } : {}),
          ...(cost !== undefined ? { estimatedCostUsd: cost } : {}),
          source: "provider_event",
          isBillingAuthoritative: false
        }
      }
    });
  }

  const subtype = str(record.subtype);
  const isError = record.is_error === true || (subtype !== undefined && subtype !== "success");
  if (isError) {
    const code = mapClaudeErrorSubtype(subtype);
    if (code === "rate_limited" || code === "quota_exhausted") {
      events.push({
        type: "quota.updated",
        payload: {
          quota: {
            provider: "claude",
            status: code === "quota_exhausted" ? "exhausted" : "rate_limited",
            window: "unknown",
            source: "provider_event",
            isBillingAuthoritative: false
          }
        }
      });
    }
    return {
      events,
      terminalError: { code, message: sanitizeMessage(str(record.result), "Claude reported an error.") }
    };
  }

  return { events, completed: { summary: str(record.result) ?? null } };
}

/** The Claude line mapper. Pure; never throws. */
export const claudeLineMapper: ProviderLineMapper = {
  provider: "claude",
  mapLine(line: ProcessOutputLine): MappedLine {
    if (line.stream === "stderr") {
      return {};
    }
    const trimmed = line.line.trim();
    if (trimmed.length === 0) {
      return {};
    }
    const parsed = tryParseJson(trimmed);
    if (!parsed.ok) {
      return { parseError: "Malformed Claude stream-json line (not valid JSON)." };
    }
    const record = asRecord(parsed.value);
    if (record === null) {
      return { parseError: "Malformed Claude stream-json line (not a JSON object)." };
    }

    const type = str(record.type);
    switch (type) {
      case "system":
        return {};
      case "assistant": {
        const message = asRecord(record.message);
        return message === null ? { unknownKind: "assistant:no-message" } : mapAssistant(message);
      }
      case "user": {
        const message = asRecord(record.message);
        return message === null ? {} : mapUser(message);
      }
      case "result":
        return mapResult(record);
      default:
        return { unknownKind: type ?? "missing-type" };
    }
  }
};

function sanitizeMessage(message: string | undefined, fallback: string): string {
  if (message === undefined || message.trim().length === 0) {
    return fallback;
  }
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}
