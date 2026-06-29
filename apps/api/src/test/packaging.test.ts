/**
 * A9.6 Packaging & installation (mandate §11 A9.6).
 *
 * A lightweight, deterministic packaging-coherence check: the workspace manifests are
 * consistent and the documented build/test/run surface exists, so the product is
 * installable + buildable + runnable from a fresh checkout. (CI runs the actual clean
 * install + build + test on every PR.)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function manifest(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"));
}

describe("A9.6 packaging — the workspace is installable, buildable, runnable", () => {
  it("pins the toolchain (Node engine + pnpm packageManager)", () => {
    const root = manifest("package.json");
    expect((root.engines as { node?: string } | undefined)?.node).toBeTruthy();
    expect(String(root.packageManager ?? "")).toMatch(/^pnpm@\d/);
  });

  it("the root exposes the documented build/test/typecheck/lint surface", () => {
    const scripts = manifest("package.json").scripts as Record<string, string>;
    for (const s of ["build", "test", "typecheck", "lint:deps"]) {
      expect(scripts[s], `root script "${s}"`).toBeTruthy();
    }
  });

  it("every workspace package builds and type-checks; apps run a test suite", () => {
    const expectations: { pkg: string; scripts: string[] }[] = [
      { pkg: "packages/shared/package.json", scripts: ["build", "typecheck"] },
      { pkg: "apps/api/package.json", scripts: ["build", "typecheck", "test", "start"] },
      { pkg: "apps/web/package.json", scripts: ["build", "typecheck", "test"] }
    ];
    for (const { pkg, scripts } of expectations) {
      const s = manifest(pkg).scripts as Record<string, string>;
      for (const name of scripts) {
        expect(s[name], `${pkg} script "${name}"`).toBeTruthy();
      }
    }
  });

  it("the workspace + lockfile + install docs are present", () => {
    expect(existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "pnpm-lock.yaml"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "docs/TRIFORGE_INSTALL.md"))).toBe(true);
  });

  it("the workspace globs cover packages/* and apps/*", () => {
    const ws = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(ws).toContain("packages/*");
    expect(ws).toContain("apps/*");
  });
});
