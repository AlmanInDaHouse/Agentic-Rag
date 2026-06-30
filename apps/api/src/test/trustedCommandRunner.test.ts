/**
 * A10-W.7 — trusted gate-command resolution (CI-safe, injected `which`).
 *
 * A quality-gate command is trusted config (GateSpec), already policy-allowed. On
 * Windows an allowed runner (npm/pnpm/vitest/tsc) is usually a `.cmd` shim, not a
 * directly-spawnable `.exe`. This resolves a real `.exe` directly, or a `.cmd`/`.bat`
 * via `cmd.exe /d /s /c <shim>` (safe because the argv is TRUSTED, never the free-text
 * provider objective).
 */

import { describe, expect, it } from "vitest";
import { resolveTrustedCommand } from "../execution/command/trustedCommandRunner.js";

describe("resolveTrustedCommand (A10-W.7)", () => {
  it("win32 .cmd shim → cmd.exe /d /s /c <shim>", () => {
    const r = resolveTrustedCommand("npm", {
      platform: "win32",
      which: () => ["C:\\Program Files\\nodejs\\npm", "C:\\Program Files\\nodejs\\npm.cmd"]
    });
    expect(r.bin.toLowerCase()).toContain("cmd");
    expect(r.prefixArgs.slice(0, 2)).toEqual(["/d", "/c"]);
    expect(r.prefixArgs[2]).toBe("C:\\Program Files\\nodejs\\npm.cmd");
  });

  it("win32 prefers a real .exe (spawned directly, no shell)", () => {
    const r = resolveTrustedCommand("git", {
      platform: "win32",
      which: () => ["C:\\Program Files\\Git\\cmd\\git.exe"]
    });
    expect(r).toEqual({ bin: "C:\\Program Files\\Git\\cmd\\git.exe", prefixArgs: [] });
  });

  it("non-win32 passes the bare name through (POSIX spawns directly)", () => {
    expect(resolveTrustedCommand("npm", { platform: "linux", which: () => [] })).toEqual({
      bin: "npm",
      prefixArgs: []
    });
  });

  it("unresolved on win32 → bare name (spawn fails cleanly, never a guessed shim)", () => {
    expect(resolveTrustedCommand("definitely-not-installed", { platform: "win32", which: () => [] })).toEqual({
      bin: "definitely-not-installed",
      prefixArgs: []
    });
  });
});
