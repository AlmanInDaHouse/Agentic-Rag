/**
 * A10-W.6 — deterministic provider-launcher resolution (CI-safe, injected deps).
 *
 * Proves the safe resolution discipline (ADR 0056) WITHOUT a real codex/claude
 * install: the PATH probe and existence check are injected, and win32 semantics are
 * exercised on any CI host. The key guarantee: never resolve to a `.cmd`/`.ps1`
 * shim (the `.cmd` argument-injection class with a free-text objective; the `.ps1`
 * swallows piped stdout).
 */

import { describe, expect, it } from "vitest";
import { resolveProviderLauncher } from "../providers/real/windowsLauncher.js";

const NPM_BIN = "C:\\Users\\u\\AppData\\Roaming\\npm";

describe("resolveProviderLauncher (A10-W.6)", () => {
  it("win32 codex → node <codex.js> when the package entry exists", () => {
    const r = resolveProviderLauncher("codex", {
      platform: "win32",
      which: () => [`${NPM_BIN}\\codex`, `${NPM_BIN}\\codex.cmd`, `${NPM_BIN}\\codex.ps1`],
      exists: (p) => p.toLowerCase().endsWith("codex.js"),
      nodeExecPath: "C:\\Program Files\\nodejs\\node.exe"
    });
    expect(r.executable).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(r.prefixArgs).toHaveLength(1);
    expect(r.prefixArgs[0]).toContain("@openai\\codex");
    expect(r.prefixArgs[0].endsWith("codex.js")).toBe(true);
  });

  it("win32 claude → claude.exe directly when the package entry exists", () => {
    const r = resolveProviderLauncher("claude", {
      platform: "win32",
      which: () => [`${NPM_BIN}\\claude`, `${NPM_BIN}\\claude.cmd`],
      exists: (p) => p.toLowerCase().endsWith("claude.exe")
    });
    expect(r.prefixArgs).toEqual([]);
    expect(r.executable).toContain("@anthropic-ai\\claude-code");
    expect(r.executable.endsWith("claude.exe")).toBe(true);
  });

  it("win32 prefers a real .exe already on PATH (spawned directly)", () => {
    const r = resolveProviderLauncher("codex", {
      platform: "win32",
      which: () => ["C:\\tools\\codex.exe"],
      exists: () => false
    });
    expect(r).toEqual({ executable: "C:\\tools\\codex.exe", prefixArgs: [] });
  });

  it("win32 NEVER resolves to a .cmd/.ps1 shim — falls back to the bare name (spawn fails cleanly)", () => {
    const r = resolveProviderLauncher("codex", {
      platform: "win32",
      which: () => [`${NPM_BIN}\\codex.cmd`, `${NPM_BIN}\\codex.ps1`],
      exists: () => false // package entry not found
    });
    expect(r).toEqual({ executable: "codex", prefixArgs: [] });
    expect(r.executable).not.toMatch(/\.(cmd|ps1|bat)$/i);
  });

  it("win32 with nothing on PATH → bare name (honest spawn_error, no shim)", () => {
    const r = resolveProviderLauncher("claude", {
      platform: "win32",
      which: () => [],
      exists: () => false
    });
    expect(r).toEqual({ executable: "claude", prefixArgs: [] });
  });

  it("non-win32 → the bare name (POSIX spawns directly, no .cmd hazard)", () => {
    expect(resolveProviderLauncher("codex", { platform: "linux" })).toEqual({
      executable: "codex",
      prefixArgs: []
    });
    expect(resolveProviderLauncher("claude", { platform: "darwin" })).toEqual({
      executable: "claude",
      prefixArgs: []
    });
  });
});
