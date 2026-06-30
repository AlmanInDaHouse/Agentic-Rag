/**
 * A10-W.1 — evidence-gate semantics for `verified_real_environment` /
 * `requiresRealEnvironment` (mandate §19).
 *
 * The final gate must distinguish three bars for a mandatory capability:
 *  - real provider  → only `verified_real_provider`;
 *  - real environment (and not real provider) → only `verified_real_environment`
 *    (or the stronger `verified_real_provider`); a CI fixture is NOT enough;
 *  - neither → any of the SATISFYING_NON_REAL_STATUSES.
 *
 * This is the no-false-green guarantee for native-Windows OS behavior: a Windows
 * path/worktree/Job-Object capability cannot be closed by a Linux CI fixture.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityEvidenceEntrySchema,
  capabilityEvidenceRegistrySchema,
  evaluateFinalReleaseReadiness,
  SATISFYING_REAL_ENVIRONMENT_STATUSES,
  type CapabilityEvidenceEntry,
  type CapabilityEvidenceRegistry,
  type EvidenceStatus
} from "@triforge/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function cap(
  capability: string,
  over: Partial<Omit<CapabilityEvidenceEntry, "capability">> = {}
): CapabilityEvidenceEntry {
  return capabilityEvidenceEntrySchema.parse({
    capability,
    status: "unknown",
    mandatoryForFinal: true,
    requiresRealProvider: false,
    provider: "",
    providerVersion: "",
    environment: "windows-native",
    evidence: [],
    verifiedAt: "",
    risks: [],
    notes: "",
    ...over
  });
}

function reg(caps: CapabilityEvidenceEntry[]): CapabilityEvidenceRegistry {
  return capabilityEvidenceRegistrySchema.parse({
    schemaVersion: "1.1.0",
    milestone: "unit",
    generatedNote: "unit",
    capabilities: caps
  });
}

describe("A10-W evidence gate — verified_real_environment / requiresRealEnvironment", () => {
  it("a requiresRealEnvironment cap is NOT satisfied by a CI fixture", () => {
    const r = evaluateFinalReleaseReadiness(
      reg([cap("windows_x", { requiresRealEnvironment: true, status: "verified_fixture" })])
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.join("\n")).toContain("windows_x");
    expect(r.reasons.join("\n")).toContain("requires verified_real_environment");
  });

  it("a requiresRealEnvironment cap IS satisfied by verified_real_environment", () => {
    const r = evaluateFinalReleaseReadiness(
      reg([cap("windows_x", { requiresRealEnvironment: true, status: "verified_real_environment" })])
    );
    expect(r.ready).toBe(true);
  });

  it("verified_real_provider also satisfies a requiresRealEnvironment cap (stronger evidence)", () => {
    const r = evaluateFinalReleaseReadiness(
      reg([cap("windows_x", { requiresRealEnvironment: true, status: "verified_real_provider" })])
    );
    expect(r.ready).toBe(true);
  });

  it("a requiresRealProvider cap is NOT satisfied by verified_real_environment", () => {
    const r = evaluateFinalReleaseReadiness(
      reg([cap("codex_x", { requiresRealProvider: true, status: "verified_real_environment" })])
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.join("\n")).toContain("requires verified_real_provider");
  });

  it("requiresRealProvider dominates requiresRealEnvironment", () => {
    const envOnly = evaluateFinalReleaseReadiness(
      reg([
        cap("both_flags", {
          requiresRealProvider: true,
          requiresRealEnvironment: true,
          status: "verified_real_environment"
        })
      ])
    );
    expect(envOnly.ready).toBe(false);

    const realProvider = evaluateFinalReleaseReadiness(
      reg([
        cap("both_flags", {
          requiresRealProvider: true,
          requiresRealEnvironment: true,
          status: "verified_real_provider"
        })
      ])
    );
    expect(realProvider.ready).toBe(true);
  });

  it("a plain non-real cap is satisfied by verified_real_environment (and by fixtures)", () => {
    expect(SATISFYING_REAL_ENVIRONMENT_STATUSES).toContain("verified_real_environment" as EvidenceStatus);
    const r = evaluateFinalReleaseReadiness(reg([cap("plain", { status: "verified_real_environment" })]));
    expect(r.ready).toBe(true);
  });

  it("backward compatibility: an entry omitting requiresRealEnvironment defaults to false", () => {
    const parsed = capabilityEvidenceEntrySchema.parse({
      capability: "legacy",
      status: "verified_fixture",
      mandatoryForFinal: true,
      requiresRealProvider: false,
      provider: "",
      providerVersion: "",
      environment: "ci",
      evidence: [],
      verifiedAt: "",
      risks: [],
      notes: ""
    });
    expect(parsed.requiresRealEnvironment).toBe(false);
    expect(evaluateFinalReleaseReadiness(reg([parsed])).ready).toBe(true);
  });

  it("the real registry closes windows_native_substrate at verified_real_environment (A10-W.1 deliverable)", () => {
    const registry = capabilityEvidenceRegistrySchema.parse(
      JSON.parse(readFileSync(path.join(repoRoot, "docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json"), "utf8"))
    );
    const substrate = registry.capabilities.find((c) => c.capability === "windows_native_substrate");
    expect(substrate, "windows_native_substrate must exist").toBeTruthy();
    expect(substrate?.requiresRealEnvironment).toBe(true);
    expect(substrate?.status).toBe("verified_real_environment");
  });

  it("the real registry keeps the final gate honestly NOT ready (Windows work pending), backed by a real-host gap", () => {
    const registry = capabilityEvidenceRegistrySchema.parse(
      JSON.parse(readFileSync(path.join(repoRoot, "docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json"), "utf8"))
    );
    const r = evaluateFinalReleaseReadiness(registry);
    expect(r.ready).toBe(false);
    // No silent pass: a real-provider OR a real-environment verification gap.
    const realProviderBlocked = registry.capabilities.filter(
      (c) => c.mandatoryForFinal && c.requiresRealProvider && c.status !== "verified_real_provider"
    );
    const realEnvBlocked = registry.capabilities.filter(
      (c) =>
        c.mandatoryForFinal &&
        !c.requiresRealProvider &&
        c.requiresRealEnvironment &&
        !(SATISFYING_REAL_ENVIRONMENT_STATUSES as readonly string[]).includes(c.status)
    );
    expect(realProviderBlocked.length + realEnvBlocked.length).toBeGreaterThan(0);
  });
});
