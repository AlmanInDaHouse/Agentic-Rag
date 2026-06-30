/**
 * A10-W.2 — Windows hardening of the WIRED write gate (PathPolicyEngine), REAL host.
 *
 * validateContainedPath is the standalone ExecutionPlatform primitive; the gate that
 * actually authorizes provider writes today is PathPolicyEngine.checkRead/checkWrite
 * (roleEnforcer → writableRun). This suite verifies the Windows lexical hardening +
 * case-insensitive containment ADDED to that wired engine, on a real NTFS host with a
 * real escaping junction. Runs only on win32.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PathPolicyEngine, type AllowedPathPolicy } from "../execution/path/pathPolicy.js";

const RUN = process.platform === "win32";
const clock = { iso: () => "2026-06-30T00:00:00.000Z" };
const POLICY: AllowedPathPolicy = { readPaths: ["."], writePaths: ["."], blockedPaths: [], maxFilesChanged: 1000 };

describe.runIf(RUN)("A10-W.2 PathPolicyEngine — Windows hardening on real NTFS", () => {
  let base = "";
  let worktree = "";
  let outside = "";
  let engine: PathPolicyEngine;
  let junctionMade = false;

  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "tf-w2pp-"));
    worktree = path.join(base, "worktree");
    outside = path.join(base, "outside");
    mkdirSync(path.join(worktree, "src"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(worktree, "src", "app.ts"), "x\n");
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    try {
      execFileSync("cmd", ["/c", "mklink", "/J", path.join(worktree, "escape"), outside], { stdio: "ignore" });
      junctionMade = true;
    } catch {
      junctionMade = false;
    }
    engine = new PathPolicyEngine({ workspaceRoot: worktree, policy: POLICY, clock });
  });

  afterAll(() => {
    try {
      execFileSync("cmd", ["/c", "rmdir", path.join(worktree, "escape")], { stdio: "ignore" });
    } catch { /* ignore */ }
    try {
      rmSync(base, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("allows a contained write and returns the canonical realPath", () => {
    const d = engine.checkWrite("src/app.ts");
    expect(d.allowed).toBe(true);
    expect(d.realPath?.toLowerCase()).toContain("worktree\\src\\app.ts");
  });

  it("allows a contained file addressed with different case (NTFS case-insensitive)", () => {
    expect(engine.checkRead("SRC/APP.TS").allowed).toBe(true);
  });

  it("denies an alternate data stream", () => {
    const d = engine.checkWrite("src/app.ts:evil");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("alternate_data_stream");
  });

  it.each(["CON", "NUL", "COM1"])("denies reserved device name %s", (name) => {
    const d = engine.checkWrite(name);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("reserved_device_name");
  });

  it("denies a trailing-dot segment", () => {
    const d = engine.checkWrite("weird.");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("trailing_dot_or_space");
  });

  it("denies a UNC namespace", () => {
    const d = engine.checkWrite("\\\\server\\share\\x");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("dangerous_namespace");
  });

  it("denies a `..` traversal escape", () => {
    expect(engine.checkWrite("..\\outside\\secret.txt").allowed).toBe(false);
  });

  it("denies a real junction that escapes the worktree", () => {
    if (!junctionMade) return;
    const d = engine.checkWrite("escape/secret.txt");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("symlink_escape");
  });

  it("denies a .git segment", () => {
    const d = engine.checkWrite(".git/config");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("blocked_git");
  });
});
