import { z } from "zod";
import {
  AuthenticationStateSchema,
  ProviderIdSchema,
  ProviderQuotaSchema,
  ProviderUsageSchema,
  ProviderErrorCodeSchema
} from "./common.js";

/**
 * ProviderEvent (A1.2).
 *
 * A common envelope plus a discriminated union (discriminator `type`) of the 13
 * normalized provider events. Every event carries a `schemaVersion`, an
 * `executionId`, the `provider`, a monotonic `sequenceNumber`, an ISO `timestamp`,
 * an optional `rawEvidenceRef` (pointer to retained raw stdout/JSONL evidence),
 * and a typed `payload`. Payloads are deliberately minimal and provider-agnostic.
 *
 * Terminal semantics: exactly one terminal event (`run.failed` | `run.completed`)
 * ends a run. `TERMINAL_EVENT_TYPES` and `isTerminalEvent` express this; the
 * single-terminal invariant is enforced by the harness/normalizer in A2/A3.
 */

// Shared envelope fields. Spread into each event option below.
const eventBaseShape = {
  schemaVersion: z.string().min(1),
  executionId: z.string().min(1),
  provider: ProviderIdSchema,
  sequenceNumber: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  rawEvidenceRef: z.string().nullable().default(null)
};

/** The common envelope, without the discriminator/payload (for reference/use). */
export const ProviderEventBaseSchema = z.object(eventBaseShape).strict();

// --- Payloads (one per event type) ---------------------------------------

export const RunStartedPayloadSchema = z
  .object({ readOnly: z.boolean() })
  .strict();

export const AuthenticationUpdatedPayloadSchema = z
  .object({
    state: AuthenticationStateSchema,
    detail: z.string().nullable().default(null)
  })
  .strict();

export const AgentMessagePayloadSchema = z
  .object({
    role: z.enum(["assistant", "system", "user"]).default("assistant"),
    text: z.string()
  })
  .strict();

export const PlanStepSchema = z
  .object({
    title: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed"]).default("pending")
  })
  .strict();

export const PlanUpdatedPayloadSchema = z
  .object({ steps: z.array(PlanStepSchema).default([]) })
  .strict();

export const ToolStartedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    // sanitized arguments only — never secrets
    arguments: z.record(z.unknown()).default({})
  })
  .strict();

export const ToolCompletedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    status: z.enum(["succeeded", "failed"]),
    summary: z.string().nullable().default(null)
  })
  .strict();

export const FileChangedPayloadSchema = z
  .object({
    path: z.string().min(1),
    changeType: z.enum(["created", "modified", "deleted", "renamed"]),
    diffHash: z.string().nullable().default(null)
  })
  .strict();

export const UsageUpdatedPayloadSchema = z
  .object({ usage: ProviderUsageSchema })
  .strict();

export const QuotaUpdatedPayloadSchema = z
  .object({ quota: ProviderQuotaSchema })
  .strict();

export const ApprovalRequestedPayloadSchema = z
  .object({
    approvalId: z.string().min(1),
    actionType: z.string().min(1),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string().nullable().default(null)
  })
  .strict();

export const WarningRaisedPayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string()
  })
  .strict();

export const RunFailedPayloadSchema = z
  .object({
    errorCode: ProviderErrorCodeSchema,
    message: z.string(),
    partial: z.boolean().default(false)
  })
  .strict();

export const RunCompletedPayloadSchema = z
  .object({
    summary: z.string().nullable().default(null),
    filesChangedCount: z.number().int().nonnegative().default(0)
  })
  .strict();

// --- Events --------------------------------------------------------------

export const RunStartedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("run.started"), payload: RunStartedPayloadSchema })
  .strict();

export const AuthenticationUpdatedEventSchema = z
  .object({
    ...eventBaseShape,
    type: z.literal("authentication.updated"),
    payload: AuthenticationUpdatedPayloadSchema
  })
  .strict();

export const AgentMessageEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("agent.message"), payload: AgentMessagePayloadSchema })
  .strict();

export const PlanUpdatedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("plan.updated"), payload: PlanUpdatedPayloadSchema })
  .strict();

export const ToolStartedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("tool.started"), payload: ToolStartedPayloadSchema })
  .strict();

export const ToolCompletedEventSchema = z
  .object({
    ...eventBaseShape,
    type: z.literal("tool.completed"),
    payload: ToolCompletedPayloadSchema
  })
  .strict();

export const FileChangedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("file.changed"), payload: FileChangedPayloadSchema })
  .strict();

export const UsageUpdatedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("usage.updated"), payload: UsageUpdatedPayloadSchema })
  .strict();

export const QuotaUpdatedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("quota.updated"), payload: QuotaUpdatedPayloadSchema })
  .strict();

export const ApprovalRequestedEventSchema = z
  .object({
    ...eventBaseShape,
    type: z.literal("approval.requested"),
    payload: ApprovalRequestedPayloadSchema
  })
  .strict();

export const WarningRaisedEventSchema = z
  .object({
    ...eventBaseShape,
    type: z.literal("warning.raised"),
    payload: WarningRaisedPayloadSchema
  })
  .strict();

export const RunFailedEventSchema = z
  .object({ ...eventBaseShape, type: z.literal("run.failed"), payload: RunFailedPayloadSchema })
  .strict();

export const RunCompletedEventSchema = z
  .object({
    ...eventBaseShape,
    type: z.literal("run.completed"),
    payload: RunCompletedPayloadSchema
  })
  .strict();

/** Discriminated union of all 13 provider events. */
export const ProviderEventSchema = z.discriminatedUnion("type", [
  RunStartedEventSchema,
  AuthenticationUpdatedEventSchema,
  AgentMessageEventSchema,
  PlanUpdatedEventSchema,
  ToolStartedEventSchema,
  ToolCompletedEventSchema,
  FileChangedEventSchema,
  UsageUpdatedEventSchema,
  QuotaUpdatedEventSchema,
  ApprovalRequestedEventSchema,
  WarningRaisedEventSchema,
  RunFailedEventSchema,
  RunCompletedEventSchema
]);

/** All event type identifiers, in canonical order. */
export const PROVIDER_EVENT_TYPES = [
  "run.started",
  "authentication.updated",
  "agent.message",
  "plan.updated",
  "tool.started",
  "tool.completed",
  "file.changed",
  "usage.updated",
  "quota.updated",
  "approval.requested",
  "warning.raised",
  "run.failed",
  "run.completed"
] as const;

export const ProviderEventTypeSchema = z.enum(PROVIDER_EVENT_TYPES);

/** The terminal event types. Exactly one of these ends a run. */
export const TERMINAL_EVENT_TYPES = ["run.failed", "run.completed"] as const;

export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
export type ProviderEventType = z.infer<typeof ProviderEventTypeSchema>;
export type TerminalEventType = (typeof TERMINAL_EVENT_TYPES)[number];

/** True when the given event (or event type) is a terminal event. */
export function isTerminalEvent(input: ProviderEvent | ProviderEventType): boolean {
  const type = typeof input === "string" ? input : input.type;
  return (TERMINAL_EVENT_TYPES as readonly string[]).includes(type);
}
