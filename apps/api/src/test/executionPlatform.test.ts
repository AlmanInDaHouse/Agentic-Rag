/**
 * A10-W.1 — ExecutionPlatform boundary unit tests.
 *
 * Verifies the parts A10-W.1 implements (platform identity, workspace-path
 * normalization, filesystem-entry inspection) and that the deferred methods throw
 * the typed, PR-naming error rather than silently no-op. Host-aware so it passes on
 * both the Windows dev host and the Linux CI.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlatformMethodNotImplementedError } from "@triforge/shared";
import {
  detectExecutionPlatform,
  PosixExecutionPlatform,
  WindowsExecutionPlatform
} from "../platform/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("detectExecutionPlatform", () => {
  it("selects Windows on win32 and Posix otherwise", () => {
    expect(detectExecutionPlatform("win32").platformId).toBe("windows");
    expect(detectExecutionPlatform("linux").platformId).toBe("posix");
    expect(detectExecutionPlatform("darwin").platformId).toBe("posix");
  });

  it("the concrete classes report their platform id", () => {
    expect(new WindowsExecutionPlatform().platformId).toBe("windows");
    expect(new PosixExecutionPlatform().platformId).toBe("posix");
  });
});

describe("normalizeWorkspacePath (host platform)", () => {
  const platform = detectExecutionPlatform();

  it("resolves an existing directory to a canonical, existing path with a volume id", async () => {
    const c = await platform.normalizeWorkspacePath(repoRoot);
    expect(c.exists).toBe(true);
    expect(path.isAbsolute(c.absolute)).toBe(true);
    expect(c.volumeId.length).toBeGreaterThan(0);
  });

  it("resolves a not-yet-existing child to exists:false, keeping the tail segment", async () => {
    const child = path.join(repoRoot, "no", "such", "tf-child-xyz");
    const c = await platform.normalizeWorkspacePath(child);
    expect(c.exists).toBe(false);
    expect(c.absolute.replace(/\\/g, "/")).toContain("tf-child-xyz");
    expect(c.volumeId.length).toBeGreaterThan(0);
  });

  it.runIf(process.platform === "win32")(
    "reports exists:false for an absent volume root (dirname-fixpoint, not an empty-tail false-positive)",
    async () => {
      const { existsSync } = await import("node:fs");
      const unmounted = ["Z", "Y", "X", "W", "V"].find((d) => !existsSync(`${d}:\\`));
      if (!unmounted) return; // all mounted on this host — nothing to assert
      const c = await platform.normalizeWorkspacePath(`${unmounted}:\\`);
      expect(c.exists).toBe(false);
    }
  );
});

describe("inspectFilesystemEntry (host platform)", () => {
  const platform = detectExecutionPlatform();

  it("reports an existing directory that is not a reparse point", async () => {
    const e = await platform.inspectFilesystemEntry(repoRoot);
    expect(e.exists).toBe(true);
    expect(e.isDirectory).toBe(true);
    expect(e.isFile).toBe(false);
    expect(e.isReparsePoint).toBe(false);
  });

  it("reports a nonexistent path as not existing", async () => {
    const e = await platform.inspectFilesystemEntry(path.join(repoRoot, "definitely-not-here-tf"));
    expect(e.exists).toBe(false);
    expect(e.isDirectory).toBe(false);
  });
});

describe("validateContainedPath is implemented (A10-W.2)", () => {
  const platform = new WindowsExecutionPlatform();

  it("resolves a PathValidationResult instead of rejecting (no longer a deferred stub)", async () => {
    const r = await platform.validateContainedPath({ target: "x", containmentRoot: repoRoot });
    expect(typeof r.allowed).toBe("boolean");
    expect(r).toHaveProperty("denyReason");
    expect(r).toHaveProperty("canonical");
  });
});

describe("deferred methods reject with the typed, PR-naming error (phased rollout)", () => {
  const platform = new WindowsExecutionPlatform();

  it("createManagedProcess and terminateProcessTree → A10-W.4", async () => {
    await expect(platform.createManagedProcess({ executable: "node", args: [], cwd: repoRoot, env: {} }))
      .rejects.toBeInstanceOf(PlatformMethodNotImplementedError);
    await expect(platform.terminateProcessTree("1", "cancelled"))
      .rejects.toBeInstanceOf(PlatformMethodNotImplementedError);
  });

  it("createRestrictedEnvironment → A10-W.5", async () => {
    await platform.createRestrictedEnvironment({ allowNames: [] }).catch((err: PlatformMethodNotImplementedError) => {
      expect(err.plannedPr).toContain("A10-W.5");
    });
    await expect(platform.createRestrictedEnvironment({ allowNames: [] }))
      .rejects.toBeInstanceOf(PlatformMethodNotImplementedError);
  });
});
