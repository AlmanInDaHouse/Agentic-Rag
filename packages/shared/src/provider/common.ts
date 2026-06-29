import { z } from "zod";

/**
 * Provider contract surface version (A1).
 *
 * Compatibility policy (see docs/specs/PROVIDER_CONTRACTS_SPEC.md):
 * - additive, backward-compatible changes bump the MINOR/PATCH segment;
 * - any breaking change bumps the MAJOR segment and invalidates prior
 *   capability snapshots that were verified against an older contract.
 *
 * These contracts are provider-agnostic. The provider knowledge they carry is
 * vocabulary only: the `ProviderIdSchema` enum and the provider-named
 * quota-flavor tokens in `QuotaExhaustionFlavorSchema` inherited from
 * QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md (sanctioned vocabulary, not logic).
 * There is no Codex/Claude-specific behavior or per-provider branching here.
 */
export const PROVIDER_CONTRACT_SCHEMA_VERSION = "1.0.0";

/**
 * The provider identifier. Together with the inherited quota-flavor tokens in
 * `QuotaExhaustionFlavorSchema`, this is the contracts' only provider-named
 * vocabulary; no per-provider logic branches on it.
 */
export const ProviderIdSchema = z.enum(["codex", "claude"]);

/** Adapter availability (reachability/installation), distinct from quota status. */
export const AvailabilityStatusSchema = z.enum(["available", "unavailable", "unknown"]);

/** Authentication state, distinct from quota status (quota spec). */
export const AuthenticationStateSchema = z.enum([
  "authenticated",
  "required",
  "expired",
  "unknown"
]);

// --- Quota / usage primitives (aligned with
// docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md). Shared by the event
// payloads (usage.updated / quota.updated) and the adapter result, so they live
// in this leaf module to keep events.ts and adapter.ts free of a circular import.

export const QuotaStatusSchema = z.enum([
  "available",
  "warning",
  "rate_limited",
  "exhausted",
  "unknown"
]);

export const QuotaWindowSchema = z.enum([
  "five_hour",
  "seven_day",
  "model_specific",
  "credits",
  "unknown"
]);

export const QuotaExhaustionFlavorSchema = z.enum([
  "claude_five_hour",
  "claude_seven_day",
  "claude_model_specific",
  "codex_five_hour",
  "codex_weekly",
  "credits",
  "unknown"
]);

export const UsageSourceSchema = z.enum([
  "provider_event",
  "cli_status",
  "local_estimate",
  "unknown"
]);

export const QuotaSourceSchema = z.enum([
  "provider_event",
  "cli_status",
  "adapter_inference",
  "unknown"
]);

export const ReasoningIntensitySchema = z.enum(["light", "medium", "heavy", "unknown"]);

/**
 * Client-side usage estimate. Never authoritative billing
 * (`isBillingAuthoritative` is fixed to `false`, ADR 0027). Optional numeric
 * fields stay absent rather than being back-filled with invented values.
 */
export const ProviderUsageSchema = z
  .object({
    provider: ProviderIdSchema,
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheCreationTokens: z.number().int().nonnegative().optional(),
    turns: z.number().int().nonnegative().optional(),
    invocations: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    reasoningIntensity: ReasoningIntensitySchema.optional(),
    source: UsageSourceSchema,
    isBillingAuthoritative: z.literal(false).default(false)
  })
  .strict();

/**
 * Normalized quota signal. Never fabricates a remaining percentage: when a
 * signal cannot be verified against the installed CLI version, the adapter
 * reports `status: "unknown"` / `window: "unknown"`.
 */
export const ProviderQuotaSchema = z
  .object({
    provider: ProviderIdSchema,
    status: QuotaStatusSchema,
    window: QuotaWindowSchema,
    // canonical 0–1 ratio of budget consumed when known; adapters normalize provider percentages to this range
    utilization: z.number().min(0).max(1).optional(),
    resetsAt: z.string().datetime().optional(),
    exhaustionFlavor: QuotaExhaustionFlavorSchema.optional(),
    rawProviderType: z.string().optional(),
    source: QuotaSourceSchema,
    isBillingAuthoritative: z.literal(false).default(false)
  })
  .strict();

/**
 * Error taxonomy. Shared by the `run.failed` event payload and the adapter
 * `ProviderError`/`ProviderResult` so both speak one normalized vocabulary.
 */
export const ProviderErrorCodeSchema = z.enum([
  "provider_unavailable",
  "authentication_required",
  "authentication_expired",
  "timeout",
  "cancelled",
  "quota_exhausted",
  "rate_limited",
  "malformed_event",
  "duplicate_event",
  "sequence_gap",
  "process_crashed",
  "output_limit_exceeded",
  "unknown"
]);

export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;
export type AuthenticationState = z.infer<typeof AuthenticationStateSchema>;
export type QuotaStatus = z.infer<typeof QuotaStatusSchema>;
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;
export type QuotaExhaustionFlavor = z.infer<typeof QuotaExhaustionFlavorSchema>;
export type UsageSource = z.infer<typeof UsageSourceSchema>;
export type QuotaSource = z.infer<typeof QuotaSourceSchema>;
export type ReasoningIntensity = z.infer<typeof ReasoningIntensitySchema>;
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;
export type ProviderQuota = z.infer<typeof ProviderQuotaSchema>;
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;
