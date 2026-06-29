import { z } from "zod";
import { ProviderIdSchema } from "./common.js";

/**
 * Capability snapshots (A1.3).
 *
 * A snapshot records what a provider CLI was observed to support, verified
 * against a specific `cliVersion` at `verifiedAt`. Every capability is a
 * tri-state (`yes` | `no` | `unknown`) because each is probe-based and may be
 * unverifiable; `unknown` is reported rather than fabricating a value (mandate
 * §4.5). A new `cliVersion` invalidates the prior snapshot — see
 * docs/specs/PROVIDER_CONTRACTS_SPEC.md.
 */
export const CapabilityStateSchema = z.enum(["yes", "no", "unknown"]);

export const CapabilitySnapshotSchema = z
  .object({
    provider: ProviderIdSchema,
    // null when the version could not be detected.
    cliVersion: z.string().nullable(),
    verifiedAt: z.string().datetime(),
    headlessSupport: CapabilityStateSchema,
    structuredOutput: CapabilityStateSchema,
    eventStream: CapabilityStateSchema,
    authProbe: CapabilityStateSchema,
    usageObservable: CapabilityStateSchema,
    quotaObservable: CapabilityStateSchema,
    readOnly: CapabilityStateSchema,
    write: CapabilityStateSchema,
    cancellation: CapabilityStateSchema,
    resume: CapabilityStateSchema,
    // Named capabilities observed but not (yet) modeled as a field above.
    unknownCapabilities: z.array(z.string()).default([])
  })
  .strict();

export type CapabilityState = z.infer<typeof CapabilityStateSchema>;
export type CapabilitySnapshot = z.infer<typeof CapabilitySnapshotSchema>;
