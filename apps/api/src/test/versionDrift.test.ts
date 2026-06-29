/**
 * A9.3 Version & capability drift handling (mandate §11 A9.3).
 */

import { describe, expect, it } from "vitest";
import {
  checkCapability,
  checkVersionSupport,
  compareSemver,
  parseSemver
} from "../execution/drift/versionDrift.js";

describe("version drift — unknown/unsupported handled honestly", () => {
  it("parses and compares semver", () => {
    expect(parseSemver("0.101.0")).toEqual([0, 101, 0]);
    expect(parseSemver("v1.2.3-beta")).toEqual([1, 2, 3]);
    expect(parseSemver("garbage")).toBeNull();
    expect(parseSemver(null)).toBeNull();
    expect(compareSemver([0, 101, 0], [0, 100, 0])).toBe(1);
    expect(compareSemver([1, 0, 0], [1, 0, 0])).toBe(0);
  });

  it("flags a version below the supported floor as UNSUPPORTED", () => {
    expect(checkVersionSupport("0.99.0", "0.100.0")).toBe("unsupported");
  });

  it("treats an absent / unparseable version as UNKNOWN (never silently trusted)", () => {
    expect(checkVersionSupport(null, "0.100.0")).toBe("unknown");
    expect(checkVersionSupport("dev-build", "0.100.0")).toBe("unknown");
  });

  it("treats a version at or above the floor as SUPPORTED", () => {
    expect(checkVersionSupport("0.101.0", "0.100.0")).toBe("supported");
    expect(checkVersionSupport("0.100.0", "0.100.0")).toBe("supported");
  });
});

describe("capability drift — never assumed, never inferred from a read-only snapshot", () => {
  it("returns UNKNOWN when there is no capability snapshot", () => {
    expect(checkCapability("read", { capabilities: null, writable: false })).toBe("unknown");
  });

  it("GRANTS a capability present in the snapshot", () => {
    expect(checkCapability("read", { capabilities: ["read", "plan"], writable: false })).toBe("granted");
  });

  it("REFUSES a capability not in the snapshot (never assumed)", () => {
    expect(checkCapability("network", { capabilities: ["read"], writable: false })).toBe("refused");
  });

  it("REFUSES a writable capability against a read-only snapshot (never inferred)", () => {
    expect(checkCapability("write_local", { capabilities: ["read", "write_local"], writable: false })).toBe("refused");
    // Only a writable-verified snapshot grants it.
    expect(checkCapability("write_local", { capabilities: ["read", "write_local"], writable: true })).toBe("granted");
  });
});
