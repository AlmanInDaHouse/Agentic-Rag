import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveGitExecutable } from "../execution/worktree/gitRunner.js";

/**
 * A10-W.9 — executable-shadowing fix. Managed git runs with cwd=<worktree> (attacker-
 * controlled); on Windows the bare-name process search hits cwd before PATH, so git must
 * be pinned to an absolute path. POSIX execvp never searches cwd, so the bare name is safe.
 */
describe("resolveGitExecutable — shadow-proof git resolution", () => {
  it("honors an already-absolute git path unchanged (cross-platform)", () => {
    const abs = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
    expect(resolveGitExecutable(abs)).toBe(abs);
  });

  it("leaves a bare name untouched on POSIX (execvp does not search cwd)", () => {
    expect(resolveGitExecutable("git", "linux")).toBe("git");
    expect(resolveGitExecutable("git", "darwin")).toBe("git");
  });

  it("on the real Windows host, resolves a bare git to an absolute executable path", () => {
    if (process.platform !== "win32") {
      return; // win32-only behavior
    }
    const resolved = resolveGitExecutable("git", "win32");
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(/\.(exe|cmd|bat)$/i.test(resolved)).toBe(true);
  });
});
