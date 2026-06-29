/**
 * A9.9 Release gate → TriForge 1.0 Definition of Done (mandate §11/§12).
 *
 * Asserts the DoD declaration is present and that each DoD claim is backed by an artifact
 * that actually exists in the repo (a test suite, spec or ADR) — so the release notes are
 * evidence-backed, not a narrative. The authoritative full-gate green is the CI `Validate`
 * job on this PR.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const exists = (rel: string): boolean => existsSync(path.join(repoRoot, rel));

describe("A9.9 release gate — the DoD declaration is present and evidence-backed", () => {
  it("the release notes / DoD declaration exists and declares the DoD met", () => {
    expect(exists("docs/RELEASE_NOTES_1.0.md")).toBe(true);
    const notes = readFileSync(path.join(repoRoot, "docs/RELEASE_NOTES_1.0.md"), "utf8");
    expect(notes).toMatch(/Definition of Done: MET/i);
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
      "docs/specs/HARDENING_SPEC.md" // A9
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
});
