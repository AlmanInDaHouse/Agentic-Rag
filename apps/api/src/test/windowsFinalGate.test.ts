import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityEvidenceRegistrySchema,
  evaluateFinalReleaseReadiness,
  type CapabilityEvidenceRegistry
} from "@triforge/shared";

/**
 * A10-W.9 — final evidence-gate hardening (mandate §16).
 *
 * The gate already evaluates STRUCTURED evidence (never a doc string): a mandatory
 * capability requiring a real provider is satisfied only by `verified_real_provider`,
 * and one requiring a real environment only by `verified_real_environment` (or stronger).
 * This suite pins two additional no-false-green guarantees:
 *  1. the exact set of native-Windows real capabilities is PRESENT and mandatory — so a
 *     cap cannot be silently demoted (`mandatoryForFinal:false`) or deleted to fake green;
 *  2. downgrading any such cap's status (or its required evidence level) keeps the gate red.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs", "evidence", "TRIFORGE_CAPABILITY_EVIDENCE.json");

function loadRegistry(): CapabilityEvidenceRegistry {
  return capabilityEvidenceRegistrySchema.parse(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")));
}

// The native-Windows-final real capabilities (mandate §19 table + the substrate-agnostic
// real-provider caps re-homed to windows-native). Each MUST be mandatory and verified at
// its real level before v1.0.0.
const MANDATORY_REAL_PROVIDER = [
  "codex_windows_readonly",
  "codex_windows_writable",
  "claude_windows_readonly",
  "claude_windows_writable",
  "codex_owner_claude_reviewer_e2e",
  "claude_owner_codex_reviewer_e2e",
  "windows_integrated_product_e2e",
  "specialist_mode_real",
  "pair_mode_real",
  "full_debate_mode_real",
  "cancellation_real",
  "real_quota_usage_signals"
];
const MANDATORY_REAL_ENVIRONMENT = [
  "windows_native_substrate",
  "windows_path_policy",
  "windows_worktree_manager",
  "windows_job_object_supervision",
  "windows_isolation_boundary",
  "windows_restart_recovery",
  "windows_clean_install"
];

describe("A10-W.9 final evidence gate — the mandatory real cap set is pinned", () => {
  const registry = loadRegistry();
  const byId = new Map(registry.capabilities.map((c) => [c.capability, c]));

  it.each(MANDATORY_REAL_PROVIDER)("'%s' is present, mandatory, and requires a real provider", (id) => {
    const cap = byId.get(id);
    expect(cap, `${id} missing from the registry`).toBeDefined();
    expect(cap!.mandatoryForFinal).toBe(true);
    expect(cap!.requiresRealProvider).toBe(true);
  });

  it.each(MANDATORY_REAL_ENVIRONMENT)("'%s' is present, mandatory, and requires a real environment", (id) => {
    const cap = byId.get(id);
    expect(cap, `${id} missing from the registry`).toBeDefined();
    expect(cap!.mandatoryForFinal).toBe(true);
    expect(cap!.requiresRealEnvironment).toBe(true);
  });
});

describe("A10-W.9 final evidence gate — no false green", () => {
  it("a real-provider cap is NOT satisfied by verified_real_environment (must be the real CLI)", () => {
    const registry = loadRegistry();
    const tampered: CapabilityEvidenceRegistry = {
      ...registry,
      capabilities: registry.capabilities.map((c) =>
        c.capability === "codex_windows_writable" ? { ...c, status: "verified_real_environment" } : c
      )
    };
    const r = evaluateFinalReleaseReadiness(tampered);
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("codex_windows_writable:"))).toBe(true);
  });

  it("a weak status on any mandatory cap keeps the gate red", () => {
    const registry = loadRegistry();
    for (const weak of ["unknown", "implemented", "verified_unit", "verified_mock", "verified_fixture", "blocked"] as const) {
      const tampered: CapabilityEvidenceRegistry = {
        ...registry,
        capabilities: registry.capabilities.map((c) =>
          c.capability === "windows_path_policy" ? { ...c, status: weak } : c
        )
      };
      expect(evaluateFinalReleaseReadiness(tampered).ready, `weak status ${weak} should fail the gate`).toBe(false);
    }
  });

  it("reflects the real registry honestly: ready iff there are no blocking reasons", () => {
    const registry = loadRegistry();
    const r = evaluateFinalReleaseReadiness(registry);
    expect(r.ready).toBe(r.reasons.length === 0);
    // Every reason names a real mandatory capability that is not yet at its required level.
    const ids = new Set(registry.capabilities.filter((c) => c.mandatoryForFinal).map((c) => c.capability));
    for (const reason of r.reasons) {
      const id = reason.split(":")[0];
      expect(ids.has(id), `${id} in reasons should be a known mandatory cap`).toBe(true);
    }
  });
});
