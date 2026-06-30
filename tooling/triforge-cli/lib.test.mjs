import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  resolveStateRoot, runtimeDir, pidsFilePath, logDir, buildServicesRecord, parseServicesRecord,
  readinessFrom, cleanPlan, isSafeArg, safeInvocation
} from "./lib.mjs";

describe("resolveStateRoot — deterministic, platform-aware", () => {
  it("uses %LOCALAPPDATA%\\TriForge on Windows", () => {
    const root = resolveStateRoot("win32", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "C:\\Users\\x");
    expect(root).toBe(path.join("C:\\Users\\x\\AppData\\Local", "TriForge"));
  });
  it("falls back to <home>\\AppData\\Local when LOCALAPPDATA is empty", () => {
    const root = resolveStateRoot("win32", { LOCALAPPDATA: "" }, "C:\\Users\\x");
    expect(root).toBe(path.join("C:\\Users\\x", "AppData", "Local", "TriForge"));
  });
  it("uses XDG_STATE_HOME/triforge on POSIX when set", () => {
    expect(resolveStateRoot("linux", { XDG_STATE_HOME: "/var/state" }, "/home/x")).toBe(path.join("/var/state", "triforge"));
  });
  it("falls back to ~/.triforge on POSIX", () => {
    expect(resolveStateRoot("linux", {}, "/home/x")).toBe(path.join("/home/x", ".triforge"));
  });
});

describe("state path derivations", () => {
  const root = "/state/root";
  it("derives runtime/log/pids paths under the state root", () => {
    expect(runtimeDir(root)).toBe(path.join(root, "runtime"));
    expect(logDir(root)).toBe(path.join(root, "logs"));
    expect(pidsFilePath(root)).toBe(path.join(root, "runtime", "services.json"));
  });
});

describe("services record (de)serialization — fail-safe", () => {
  it("round-trips a well-formed record", () => {
    const rec = buildServicesRecord({ api: { pid: 123, port: 3001, command: "node x" } }, "2026-06-30T00:00:00.000Z");
    const parsed = parseServicesRecord(JSON.stringify(rec));
    expect(parsed).not.toBeNull();
    expect(parsed.services.api.pid).toBe(123);
    expect(parsed.services.api.port).toBe(3001);
  });
  it("returns null on malformed JSON", () => {
    expect(parseServicesRecord("{not json")).toBeNull();
  });
  it("returns null when services is missing/not an object", () => {
    expect(parseServicesRecord(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
    expect(parseServicesRecord(JSON.stringify({ services: 5 }))).toBeNull();
  });
  it("returns null on a non-integer / non-positive pid (no accidental kills)", () => {
    expect(parseServicesRecord(JSON.stringify({ services: { api: { pid: "x" } } }))).toBeNull();
    expect(parseServicesRecord(JSON.stringify({ services: { api: { pid: -1 } } }))).toBeNull();
    expect(parseServicesRecord(JSON.stringify({ services: { api: { pid: 0 } } }))).toBeNull();
  });
  it("tolerates a missing port (null) but keeps the pid", () => {
    const parsed = parseServicesRecord(JSON.stringify({ services: { web: { pid: 9 } } }));
    expect(parsed.services.web.pid).toBe(9);
    expect(parsed.services.web.port).toBeNull();
  });
});

describe("readinessFrom", () => {
  it("is ready only when every required probe passes", () => {
    expect(readinessFrom({ api: true, web: true })).toEqual({ ready: true, missing: [] });
    expect(readinessFrom({ api: true, web: false })).toEqual({ ready: false, missing: ["web"] });
    expect(readinessFrom({ api: false, web: false })).toEqual({ ready: false, missing: ["api", "web"] });
  });
});

describe("cleanPlan — persistent data protected by default", () => {
  it("never touches persistent state without --all", () => {
    expect(cleanPlan().persistentState).toBe(false);
    expect(cleanPlan({ all: true }).persistentState).toBe(true);
  });
  it("always prunes stale worktrees and runtime state", () => {
    const plan = cleanPlan();
    expect(plan.staleWorktrees).toBe(true);
    expect(plan.runtimeState).toBe(true);
  });
});

describe("safe command discipline", () => {
  it("rejects control characters and newlines in args", () => {
    expect(isSafeArg("--port")).toBe(true);
    expect(isSafeArg("5173")).toBe(true);
    expect(isSafeArg("a\nb")).toBe(false);
    expect(isSafeArg("a\0b")).toBe(false);
  });
  it("preserves args through safeInvocation (shell:false everywhere)", () => {
    const { command, args } = safeInvocation("node", ["--version"]);
    expect(typeof command).toBe("string");
    expect(args).toContain("--version");
  });
});
