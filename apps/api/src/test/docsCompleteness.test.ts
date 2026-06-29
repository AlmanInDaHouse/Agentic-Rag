/**
 * A9.7 Documentation completeness (mandate §11 A9.7).
 *
 * A deterministic check that the operator-facing documentation is present, covers the run
 * lifecycle (create / observe / audit / cancel / recover) and cross-references the
 * install, security, recovery and canonical-state docs.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");

const KEY_DOCS = [
  "docs/TRIFORGE_OPERATOR_GUIDE.md",
  "docs/TRIFORGE_INSTALL.md",
  "docs/specs/HARDENING_SPEC.md",
  "docs/specs/PRODUCT_INTERFACE_SPEC.md",
  "docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md",
  "docs/context/TRIFORGE_EXECUTION_STATE.md"
];

describe("A9.7 documentation completeness", () => {
  it("every key doc exists", () => {
    for (const doc of KEY_DOCS) {
      expect(existsSync(path.join(repoRoot, doc)), doc).toBe(true);
    }
  });

  it("the operator guide covers the full run lifecycle (create/observe/audit/cancel/recover)", () => {
    const guide = read("docs/TRIFORGE_OPERATOR_GUIDE.md").toLowerCase();
    for (const verb of ["create", "observe", "audit", "cancel", "recover"]) {
      expect(guide, `lifecycle: ${verb}`).toContain(verb);
    }
  });

  it("the operator guide cross-references the install, threat-model and recovery docs", () => {
    const guide = read("docs/TRIFORGE_OPERATOR_GUIDE.md");
    expect(guide).toContain("TRIFORGE_INSTALL.md");
    expect(guide).toContain("PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md");
    expect(guide).toContain("HARDENING_SPEC.md");
    expect(guide).toContain("TRIFORGE_EXECUTION_STATE.md");
  });

  it("the operator guide states the core safety guarantees", () => {
    const guide = read("docs/TRIFORGE_OPERATOR_GUIDE.md").toLowerCase();
    expect(guide).toContain("isolated git worktree");
    expect(guide).toMatch(/never .*(api keys|force-push|main)/);
  });
});
