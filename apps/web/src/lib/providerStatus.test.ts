import { describe, expect, it } from "vitest";
import { deriveProviderStatusView, type ProviderStatusSnapshot } from "./providerStatus.js";

function snap(over: Partial<ProviderStatusSnapshot> = {}): ProviderStatusSnapshot {
  return {
    provider: "codex",
    availability: "available",
    version: "0.142.4",
    auth: "authenticated",
    capabilities: ["read", "write_local"],
    quotaStatus: "available",
    quotaKnown: true,
    lastVerified: "2026-06-29T00:00:00.000Z",
    warnings: [],
    supportedVersion: true,
    ...over
  };
}

describe("deriveProviderStatusView — honest states, never invented", () => {
  it("maps a fully-known snapshot", () => {
    const v = deriveProviderStatusView(snap());
    expect(v.installed).toBe("installed");
    expect(v.version).toBe("0.142.4");
    expect(v.authLabel).toBe("authenticated");
    expect(v.capabilities).toEqual({ value: ["read", "write_local"], known: true });
    expect(v.quota).toBe("known");
    expect(v.versionSupport).toBe("supported");
  });

  it("reports UNKNOWN (never a fabricated default) for absent fields", () => {
    const v = deriveProviderStatusView(
      snap({
        availability: "unknown",
        version: null,
        auth: "unknown",
        capabilities: null,
        lastVerified: null,
        supportedVersion: null
      })
    );
    expect(v.installed).toBe("unknown");
    expect(v.version).toBe("unknown");
    expect(v.authLabel).toBe("unknown");
    expect(v.capabilities.known).toBe(false);
    expect(v.lastVerified).toBe("never verified");
    expect(v.versionSupport).toBe("unknown");
  });

  it("never presents an UNKNOWN-capacity quota as guaranteed availability", () => {
    // Status says available but capacity is not known → at most "estimated".
    expect(deriveProviderStatusView(snap({ quotaStatus: "available", quotaKnown: false })).quota).toBe("estimated");
    // No signal at all → "unknown".
    expect(deriveProviderStatusView(snap({ quotaStatus: "unknown", quotaKnown: false })).quota).toBe("unknown");
  });

  it("maps availability / auth / quota / version-support labels", () => {
    expect(deriveProviderStatusView(snap({ availability: "unavailable" })).installed).toBe("not installed");
    expect(deriveProviderStatusView(snap({ auth: "expired" })).authLabel).toBe("auth expired");
    expect(deriveProviderStatusView(snap({ quotaStatus: "rate_limited" })).quotaLabel).toBe("rate limited");
    expect(deriveProviderStatusView(snap({ supportedVersion: false })).versionSupport).toBe("unsupported");
  });

  it("sanitizes warnings and version (no control/ANSI leaks into the UI)", () => {
    const v = deriveProviderStatusView(snap({ version: "1.0\x1b[31m", warnings: ["wa\x00rn"] }));
    expect(v.version).toBe("1.0");
    expect(v.warnings).toEqual(["warn"]);
  });
});
