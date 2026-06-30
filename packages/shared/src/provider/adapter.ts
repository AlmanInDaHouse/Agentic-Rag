import { z } from "zod";
import {
  AuthenticationStateSchema,
  AvailabilityStatusSchema,
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  ProviderErrorCodeSchema,
  ProviderIdSchema,
  ProviderQuotaSchema,
  ProviderUsageSchema
} from "./common.js";
import { CapabilitySnapshotSchema } from "./capability.js";
import { TERMINAL_EVENT_TYPES } from "./events.js";
import type { ProviderId } from "./common.js";
import type { CapabilitySnapshot } from "./capability.js";
import type { ProviderEvent } from "./events.js";

/**
 * ProviderAdapter data contracts (A1.1).
 *
 * Provider-agnostic data shapes for the adapter boundary plus the TypeScript
 * `ProviderAdapter` interface. No Codex/Claude-specific logic — adapters
 * (A2 mocks, A3 real) implement this interface; the contracts only describe the
 * shapes that cross the boundary. Arguments are pre-sanitized and carry no
 * secrets; raw provider evidence is referenced, never inlined with credentials.
 */

/** Result of `checkAvailability`: reachability/installation, not quota. */
export const AvailabilityResultSchema = z
  .object({
    provider: ProviderIdSchema,
    status: AvailabilityStatusSchema,
    cliVersion: z.string().nullable().default(null),
    detail: z.string().nullable().default(null),
    checkedAt: z.string().datetime()
  })
  .strict();

/** Result of `checkAuthentication`: local session state, not quota. */
export const AuthenticationResultSchema = z
  .object({
    provider: ProviderIdSchema,
    state: AuthenticationStateSchema,
    detail: z.string().nullable().default(null),
    checkedAt: z.string().datetime()
  })
  .strict();

/** `getCapabilities` returns a capability snapshot (A1.3). */
export const ProviderCapabilitiesSchema = CapabilitySnapshotSchema;

/**
 * Input to `execute`. Sanitized: `sanitizedArguments` carries no secrets,
 * `environmentAllowlist` names which env vars may pass to the child process.
 */
export const AgentExecutionRequestSchema = z
  .object({
    schemaVersion: z.string().min(1).default(PROVIDER_CONTRACT_SCHEMA_VERSION),
    executionId: z.string().min(1),
    provider: ProviderIdSchema,
    objective: z.string().min(1),
    sanitizedArguments: z.array(z.string()).default([]),
    cwd: z.string().nullable().default(null),
    timeoutMs: z.number().int().positive(),
    readOnly: z.boolean().default(true),
    environmentAllowlist: z.array(z.string()).default([]),
    maxOutputBytes: z.number().int().positive().nullable().default(null),
    // Optional orchestrator-selected model (e.g. an economical model for fixtures, or
    // a model the installed CLI/account supports). Passed as a separated argv value
    // by the adapter; a value that is not a safe model token is ignored. Never agent
    // free-text. Default null = the CLI's configured default model.
    model: z.string().nullable().default(null)
  })
  .strict();

/** Normalized adapter error (taxonomy in common.ts). */
export const ProviderErrorSchema = z
  .object({
    code: ProviderErrorCodeSchema,
    message: z.string(),
    provider: ProviderIdSchema,
    executionId: z.string().min(1),
    retriable: z.boolean().default(false),
    rawEvidenceRef: z.string().nullable().default(null)
  })
  .strict();

export const ProviderResultStatusSchema = z.enum(["completed", "failed", "cancelled"]);

/**
 * Terminal structured result of an execution. References the terminal event
 * that produced it (`terminalEventType` + `terminalSequenceNumber`) so the
 * result can be reconciled against the event stream and raw evidence.
 */
export const ProviderResultSchema = z
  .object({
    schemaVersion: z.string().min(1),
    provider: ProviderIdSchema,
    executionId: z.string().min(1),
    status: ProviderResultStatusSchema,
    terminalEventType: z.enum(TERMINAL_EVENT_TYPES),
    terminalSequenceNumber: z.number().int().nonnegative(),
    error: ProviderErrorSchema.nullable().default(null),
    usage: ProviderUsageSchema.nullable().default(null),
    quota: ProviderQuotaSchema.nullable().default(null),
    filesChanged: z.array(z.string()).default([]),
    rawEvidenceRef: z.string().nullable().default(null)
  })
  .strict();

export type AvailabilityResult = z.infer<typeof AvailabilityResultSchema>;
export type AuthenticationResult = z.infer<typeof AuthenticationResultSchema>;
export type ProviderCapabilities = CapabilitySnapshot;
export type AgentExecutionRequest = z.infer<typeof AgentExecutionRequestSchema>;
export type ProviderError = z.infer<typeof ProviderErrorSchema>;
export type ProviderResultStatus = z.infer<typeof ProviderResultStatusSchema>;
export type ProviderResult = z.infer<typeof ProviderResultSchema>;

/**
 * The adapter interface every provider integration implements (A1.1).
 *
 * `execute` yields a normalized `ProviderEvent` stream terminated by exactly one
 * terminal event; `cancel` requests cooperative cancellation of a running
 * execution. The interface is provider-agnostic and is not implemented in A1 —
 * mock adapters arrive in A2, real read-only adapters in A3.
 */
export interface ProviderAdapter {
  readonly provider: ProviderId;
  checkAvailability(): Promise<AvailabilityResult>;
  checkAuthentication(): Promise<AuthenticationResult>;
  getCapabilities(): Promise<ProviderCapabilities>;
  execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent>;
  cancel(executionId: string): Promise<void>;
}
