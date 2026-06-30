/**
 * A10-W.2 — Windows path security policy, REAL-host verification (NTFS).
 *
 * Runs ONLY on win32. Creates a real temp worktree, real files, and a real
 * directory junction (`mklink /J`, no admin needed) that escapes the worktree, then
 * drives WindowsExecutionPlatform.validateContainedPath end-to-end. This is the
 * evidence behind `windows_path_policy = verified_real_environment`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WindowsExecutionPlatform } from "../platform/index.js";

const RUN = process.platform === "win32";

describe.runIf(RUN)("A10-W.2 windows path policy — real NTFS host", () => {
  const platform = new WindowsExecutionPlatform();
  let base = "";
  let worktree = "";
  let outside = "";
  let junctionMade = false;

  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "tf-w2-"));
    worktree = path.join(base, "worktree");
    outside = path.join(base, "outside");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(path.join(worktree, "src"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(worktree, "src", "app.ts"), "export const x = 1;\n");
    writeFileSync(path.join(outside, "secret.txt"), "top secret\n");
    // Directory junction inside the worktree that escapes to `outside` (no admin).
    try {
      execFileSync("cmd", ["/c", "mklink", "/J", path.join(worktree, "escape"), outside], { stdio: "ignore" });
      junctionMade = true;
    } catch {
      junctionMade = false;
    }
  });

  afterAll(() => {
    try {
      // Remove the junction link first (rmdir removes the link, not the target).
      execFileSync("cmd", ["/c", "rmdir", path.join(worktree, "escape")], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const check = (target: string) => platform.validateContainedPath({ target, containmentRoot: worktree });

  it("allows a real contained file and returns the canonical path", async () => {
    const r = await check("src/app.ts");
    expect(r.allowed).toBe(true);
    expect(r.canonical?.absolute.toLowerCase()).toContain("worktree\\src\\app.ts");
    expect(r.canonical?.exists).toBe(true);
  });

  it("allows a not-yet-existing child under the worktree", async () => {
    const r = await check("src/new-file.ts");
    expect(r.allowed).toBe(true);
    expect(r.canonical?.exists).toBe(false);
  });

  it("allows a contained file addressed with a different case (NTFS case-insensitive)", async () => {
    const r = await check("SRC/APP.TS");
    expect(r.allowed).toBe(true);
  });

  it("denies a real junction that escapes the worktree", async () => {
    if (!junctionMade) return; // mklink unavailable — nothing to assert
    const r = await check("escape/secret.txt");
    expect(r.allowed).toBe(false);
    expect(["escapes_containment", "different_volume", "denied_reparse_point"]).toContain(r.denyReason);
  });

  it("denies a nonexistent child below the hostile junction", async () => {
    if (!junctionMade) return;
    const r = await check("escape/brand-new.txt");
    expect(r.allowed).toBe(false);
  });

  it("denies a `..` traversal escape", async () => {
    const r = await check("..\\outside\\secret.txt");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("escapes_containment");
  });

  it("denies an absolute path to the sibling `outside` directory", async () => {
    const r = await check(path.join(outside, "secret.txt"));
    expect(r.allowed).toBe(false);
  });

  it.each(["notes.txt:hidden", "CON", "NUL", "AUX", "PRN", "COM1", "LPT1"])(
    "denies the Windows hazard %s",
    async (target) => {
      const r = await check(target);
      expect(r.allowed).toBe(false);
    }
  );

  it.each(["file.", "file "])("denies trailing dot/space %s", async (target) => {
    const r = await check(target);
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("trailing_dot_or_space");
  });

  it("denies a UNC namespace", async () => {
    const r = await check("\\\\server\\share\\x");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("dangerous_namespace");
  });

  it("denies a .git segment", async () => {
    const r = await check(".git/config");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("blocked_git");
  });
});
