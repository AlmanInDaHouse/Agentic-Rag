/**
 * A10.11 — Final-operational release gate (evidence-based, mandate §15).
 *
 * The final 1.0 may be declared operational ONLY when every mandatory capability is
 * satisfied at the required evidence level — and for writable real-provider
 * capabilities that means exactly `verified_real_provider`. This suite asserts the
 * GATE LOGIC and the v1.0.0 claim policy. It is green in both states:
 *  - today (real-provider blocked → not ready → the notes must not claim final MET);
 *  - after the owner authenticates the providers and the registry flips to ready.
 *
 * It is NOT a false-green: if the registry shows a mandatory real-provider capability
 * unverified, readiness MUST be false and that capability MUST appear in the reasons.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityEvidenceRegistrySchema,
  evaluateFinalReleaseReadiness,
  SATISFYING_REAL_ENVIRONMENT_STATUSES,
  type CapabilityEvidenceRegistry
} from "@triforge/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");
const loadRegistry = (): CapabilityEvidenceRegistry =>
  capabilityEvidenceRegistrySchema.parse(
    JSON.parse(read("docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json"))
  );

const FINAL_MET_CLAIM = /TriForge 1\.0 operational Definition of Done: MET/i;

describe("A10.11 final-operational release gate", () => {
  it("the registry validates and readiness is internally consistent (ready iff no reasons)", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    expect(r.ready).toBe(r.reasons.length === 0);
    expect(r.satisfied).toBeLessThanOrEqual(r.evaluated);
  });

  it("any unverified mandatory real-provider capability forces not-ready and is named in the reasons", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    const unverifiedReal = registry.capabilities.filter(
      (c) =>
        c.mandatoryForFinal &&
        c.requiresRealProvider &&
        c.status !== "verified_real_provider"
    );
    if (unverifiedReal.length > 0) {
      expect(r.ready).toBe(false);
      const reasonText = r.reasons.join("\n");
      for (const c of unverifiedReal) {
        expect(reasonText, `${c.capability} must block the final gate`).toContain(c.capability);
      }
    }
  });

  it("a mandatory non-real capability with no executable evidence also blocks", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    const weak = registry.capabilities.filter(
      (c) =>
        c.mandatoryForFinal &&
        !c.requiresRealProvider &&
        ["implemented", "blocked", "blocked_external", "unknown"].includes(c.status)
    );
    if (weak.length > 0) {
      expect(r.ready).toBe(false);
    }
  });

  it("the v1.0.0 final-operational claim is gated on real-provider verification", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    const notes = read("docs/RELEASE_NOTES_1.0.md");
    const claimsFinalMet = FINAL_MET_CLAIM.test(notes);
    // The notes may declare the FINAL operational DoD met ONLY when the gate is ready.
    if (claimsFinalMet) {
      expect(r.ready, `final-operational claim present but gate not ready: ${r.reasons.join("; ")}`).toBe(true);
    }
  });

  it("records a real-provider- or real-environment-bound reason when not ready (no silent pass)", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    if (!r.ready) {
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
      // No silent pass: not-ready must be backed by a real-host verification gap —
      // a real provider run OR real-environment OS behavior (A10-W).
      expect(
        realProviderBlocked.length + realEnvBlocked.length,
        "final gate not-ready must be backed by a real-provider or real-environment reason"
      ).toBeGreaterThan(0);
    }
  });
});
