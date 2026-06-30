import { z } from "zod";

/**
 * A10 — Capability evidence model (mandate §4, §11, §15).
 *
 * A machine-readable registry of TriForge capabilities and the *kind* of evidence
 * that currently backs each one. The point is honesty under a release gate: a
 * mandatory writable capability that integrates the REAL Codex / Claude CLIs may
 * only be considered satisfied for the *final operational* 1.0 when its status is
 * `verified_real_provider` — never on the strength of a mock, a fixture, a unit
 * test, a bare "implemented" claim, a blocked item, or an unknown.
 *
 * The registry lives at `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` and is
 * validated against {@link capabilityEvidenceRegistrySchema}. The final-release
 * gate evaluates it via {@link evaluateFinalReleaseReadiness}.
 */

// 1.1.0 (A10-W): additive — new status `verified_real_environment` and the
// optional, defaulted `requiresRealEnvironment` flag. Backward compatible with
// pre-A10-W entries (the new field defaults to false).
export const CAPABILITY_EVIDENCE_SCHEMA_VERSION = "1.1.0";

/**
 * The evidence status ladder. Ordered loosely from weakest to strongest, plus the
 * honest negative/neutral terminals. `blocked_external` is A10's addition: the
 * capability is implementable but gated on a manual, owner-only external
 * prerequisite (e.g. authenticating a provider CLI) that the autonomous loop is
 * forbidden to perform.
 */
export const evidenceStatusSchema = z.enum([
  "implemented", // code exists; no executable evidence asserted
  "verified_unit", // a unit test exercises it
  "verified_mock", // verified against a deterministic mock provider
  "verified_fixture", // verified against a real-OS fixture (e.g. a throwaway git repo)
  "verified_real_environment", // verified on a REAL target host/OS (e.g. native Windows), provider-independent (A10-W §19)
  "verified_real_provider", // verified end-to-end against the REAL authenticated CLI
  "blocked", // cannot proceed (internal reason)
  "blocked_external", // cannot proceed without a manual, owner-only external action
  "unknown", // not yet observed; honestly unknown
  "not_applicable" // out of scope for this build
]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const capabilityEvidenceEntrySchema = z
  .object({
    /** Stable kebab/snake capability id, unique within the registry. */
    capability: z.string().min(1),
    status: evidenceStatusSchema,
    /** Whether this capability is mandatory for the FINAL operational 1.0 release. */
    mandatoryForFinal: z.boolean(),
    /**
     * Whether honest closure of this capability *requires* a real-provider
     * observation. When true, only `verified_real_provider` satisfies the gate.
     */
    requiresRealProvider: z.boolean(),
    /**
     * Whether honest closure *requires* verification on a REAL target host/OS
     * (A10-W §19) — e.g. native Windows path/worktree/Job-Object behavior that a
     * CI fixture cannot prove. When true (and `requiresRealProvider` is false),
     * only `verified_real_environment` (or the stronger `verified_real_provider`)
     * satisfies the gate. Optional + defaulted for backward compatibility with
     * pre-A10-W registry entries.
     */
    requiresRealEnvironment: z.boolean().optional().default(false),
    /** "codex" | "claude" | "both" | "" | "n/a" — informational. */
    provider: z.string(),
    /** Detected/observed provider version, or "" / "unknown". */
    providerVersion: z.string(),
    /** Environment the evidence was produced in (e.g. "wsl2-ubuntu", "windows-host", "ci"). */
    environment: z.string(),
    /** File paths, test ids, or artifact hashes that back the status. */
    evidence: z.array(z.string()),
    /** ISO-8601 timestamp of verification, or "" when not yet verified. */
    verifiedAt: z.string(),
    risks: z.array(z.string()),
    notes: z.string()
  })
  .strict();
export type CapabilityEvidenceEntry = z.infer<typeof capabilityEvidenceEntrySchema>;

export const capabilityEvidenceRegistrySchema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_EVIDENCE_SCHEMA_VERSION),
    milestone: z.string().min(1),
    /** A human note describing how/when the registry was produced. */
    generatedNote: z.string(),
    capabilities: z.array(capabilityEvidenceEntrySchema).min(1)
  })
  .strict()
  .superRefine((reg, ctx) => {
    const seen = new Set<string>();
    reg.capabilities.forEach((c, i) => {
      if (seen.has(c.capability)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", i, "capability"],
          message: `duplicate capability id: ${c.capability}`
        });
      }
      seen.add(c.capability);
    });
  });
export type CapabilityEvidenceRegistry = z.infer<typeof capabilityEvidenceRegistrySchema>;

/**
 * Documentation constant (not consumed by the gate, which uses the direct
 * equality `status === "verified_real_provider"`). The exact complement of
 * {`verified_real_provider`}: every status that does NOT satisfy a capability
 * requiring a real provider. Mirrors mandate §4 — `implemented`, `verified_mock`,
 * `verified_real_environment`, `blocked`, `not_applicable` (and friends) are never
 * sufficient for real-provider integration.
 */
export const NON_SATISFYING_REAL_STATUSES: readonly EvidenceStatus[] = [
  "implemented",
  "verified_unit",
  "verified_mock",
  "verified_fixture",
  "verified_real_environment",
  "blocked",
  "blocked_external",
  "unknown",
  "not_applicable"
];

/**
 * Statuses that satisfy a mandatory capability that does NOT require a real
 * provider (e.g. an in-process isolation boundary verified against OS fixtures).
 * `verified_real_environment` is included because real-host verification is at
 * least as strong as a fixture.
 */
export const SATISFYING_NON_REAL_STATUSES: readonly EvidenceStatus[] = [
  "verified_unit",
  "verified_mock",
  "verified_fixture",
  "verified_real_environment",
  "verified_real_provider",
  "not_applicable"
];

/**
 * Statuses that satisfy a mandatory capability that requires REAL-host
 * verification (A10-W §19) but not a real provider. A CI fixture is NOT enough;
 * the evidence must come from a real target host (or, a fortiori, a real-provider
 * run on that host). `not_applicable` also satisfies (explicitly out of scope per
 * an ADR), mirroring the non-real ladder.
 */
export const SATISFYING_REAL_ENVIRONMENT_STATUSES: readonly EvidenceStatus[] = [
  "verified_real_environment",
  "verified_real_provider",
  "not_applicable"
];

export interface FinalReleaseReadiness {
  /** True iff every mandatory capability is satisfied at the required evidence level. */
  ready: boolean;
  /** Blocking reasons; empty iff `ready`. */
  reasons: string[];
  /** Count of mandatory capabilities evaluated. */
  evaluated: number;
  /** Count of mandatory capabilities satisfied. */
  satisfied: number;
}

/**
 * Evaluate whether the registry supports a FINAL operational 1.0 release.
 *
 * A mandatory capability is satisfied when (strongest applicable rule wins):
 *  - it requires a real provider and its status is exactly `verified_real_provider`; or
 *  - it requires a real environment (and not a real provider) and its status is one of
 *    {@link SATISFYING_REAL_ENVIRONMENT_STATUSES}; or
 *  - otherwise its status is one of {@link SATISFYING_NON_REAL_STATUSES}.
 *
 * `requiresRealProvider` dominates `requiresRealEnvironment` (a real-provider run
 * on the target host is the strongest evidence and implies the environment).
 *
 * Non-mandatory capabilities never block. This function is pure and deterministic.
 */
export function evaluateFinalReleaseReadiness(
  registry: CapabilityEvidenceRegistry
): FinalReleaseReadiness {
  const reasons: string[] = [];
  let satisfied = 0;
  let evaluated = 0;

  for (const c of registry.capabilities) {
    if (!c.mandatoryForFinal) continue;
    evaluated += 1;

    let ok: boolean;
    let requirement: string;
    if (c.requiresRealProvider) {
      ok = c.status === "verified_real_provider";
      requirement = "requires verified_real_provider";
    } else if (c.requiresRealEnvironment) {
      ok = (SATISFYING_REAL_ENVIRONMENT_STATUSES as readonly EvidenceStatus[]).includes(c.status);
      requirement = "requires verified_real_environment";
    } else {
      ok = (SATISFYING_NON_REAL_STATUSES as readonly EvidenceStatus[]).includes(c.status);
      requirement = "no executable evidence";
    }

    if (ok) {
      satisfied += 1;
    } else {
      reasons.push(`${c.capability}: status="${c.status}" (${requirement})`);
    }
  }

  return { ready: reasons.length === 0, reasons, evaluated, satisfied };
}
