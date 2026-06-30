/**
 * Release gate (A9.9 RC index → A10.11 evidence-based).
 *
 * Two tiers (ADR 0054):
 *  - RC gate (here): the A1–A9 roadmap Definition of Done is declared MET and every
 *    DoD claim is backed by an artifact that exists; PLUS the machine-readable
 *    capability evidence registry is well-formed and the release notes' operational
 *    status claim MATCHES the registry's computed readiness (no false final claim).
 *  - Final-operational gate: `finalReleaseGate.test.ts`.
 *
 * This stays green by HONESTY: today the notes say "release candidate / final
 * operational PENDING", which matches the registry (real-provider capabilities
 * blocked_external). It would fail only if a dishonest "final operational MET" claim
 * were introduced while the registry still shows real-provider not verified.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityEvidenceRegistrySchema,
  evaluateFinalReleaseReadiness
} from "@triforge/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const exists = (rel: string): boolean => existsSync(path.join(repoRoot, rel));
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

const FINAL_MET_CLAIM = /TriForge 1\.0 operational Definition of Done: MET/i;
const FINAL_PENDING_MARKER = /Final operational Definition of Done \(A10\): PENDING/i;
const RC_DOD_MARKER = /A1[–-]A9 roadmap Definition of Done: MET/i;

describe("release gate — RC DoD declared + evidence-backed", () => {
  it("the release notes declare the A1–A9 roadmap DoD met (release candidate)", () => {
    expect(exists("docs/RELEASE_NOTES_1.0.md")).toBe(true);
    const notes = read("docs/RELEASE_NOTES_1.0.md");
    expect(notes).toMatch(RC_DOD_MARKER);
  });

  it("every milestone's primary evidence artifact exists (A1–A9)", () => {
    const EVIDENCE = [
      "docs/specs/PROVIDER_CONTRACTS_SPEC.md", // A1
      "docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md", // A2
      "docs/specs/REAL_PROVIDER_ADAPTERS_SPEC.md", // A3
      "docs/specs/COLLABORATION_RUNTIME_SPEC.md", // A4
      "docs/specs/WRITABLE_EXECUTION_SPEC.md", // A5
      "apps/api/src/test/writableRun.e2e.test.ts", // A5 E2E
      "docs/specs/ROUTING_LEARNING_SPEC.md", // A6
      "docs/specs/COMPETITIVE_MODE_SPEC.md", // A7
      "apps/api/src/test/competitiveRun.e2e.test.ts", // A7 E2E
      "docs/specs/PRODUCT_INTERFACE_SPEC.md", // A8
      "docs/specs/HARDENING_SPEC.md", // A9
      "docs/specs/REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md" // A10
    ];
    for (const e of EVIDENCE) {
      expect(exists(e), e).toBe(true);
    }
  });

  it("every A9 hardening acceptance suite is present (the release-gate test surface)", () => {
    const SUITES = [
      "apps/api/src/test/chaos.failureSurface.test.ts", // A9.1
      "apps/api/src/test/security.acceptance.test.ts", // A9.2
      "apps/api/src/test/versionDrift.test.ts", // A9.3
      "apps/api/src/test/recovery.restart.test.ts", // A9.4
      "apps/api/src/test/runReconstruction.test.ts", // A9.5
      "apps/api/src/test/packaging.test.ts", // A9.6
      "apps/api/src/test/docsCompleteness.test.ts", // A9.7
      "apps/api/src/test/rc.acceptance.test.ts" // A9.8
    ];
    for (const s of SUITES) {
      expect(exists(s), s).toBe(true);
    }
  });

  it("the capability evidence registry exists and validates against the schema (A10)", () => {
    expect(exists("docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json")).toBe(true);
    const raw = JSON.parse(read("docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json"));
    const parsed = capabilityEvidenceRegistrySchema.safeParse(raw);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("the release notes' operational-status claim matches the registry readiness (no false final claim)", () => {
    const registry = capabilityEvidenceRegistrySchema.parse(
      JSON.parse(read("docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json"))
    );
    const readiness = evaluateFinalReleaseReadiness(registry);
    const notes = read("docs/RELEASE_NOTES_1.0.md");

    if (readiness.ready) {
      // Only when the registry actually supports it may the notes claim final MET.
      expect(notes).toMatch(FINAL_MET_CLAIM);
    } else {
      // Honest RC state: must declare PENDING and must NOT claim final operational MET.
      expect(notes).toMatch(FINAL_PENDING_MARKER);
      expect(notes).not.toMatch(FINAL_MET_CLAIM);
    }
  });
});
