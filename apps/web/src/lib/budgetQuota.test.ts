import { describe, expect, it } from "vitest";
import { buildBudgetQuotaView, type QuotaSnapshotInput } from "./budgetQuota.js";

function snap(over: Partial<QuotaSnapshotInput> = {}): QuotaSnapshotInput {
  return {
    provider: "codex",
    configured: 100,
    reserved: 10,
    consumed: 20,
    status: "available",
    capacityKnown: true,
    providerReportedSignal: null,
    resetsAt: null,
    resetReliable: false,
    ...over
  };
}

describe("buildBudgetQuotaView — separate, honest signals", () => {
  it("shows configured / reserved / consumed separately and computes remaining when known", () => {
    const v = buildBudgetQuotaView(snap());
    expect(v.configured).toBe(100);
    expect(v.reserved).toBe(10);
    expect(v.consumed).toBe(20);
    expect(v.remaining).toBe(70);
    expect(v.confidence).toBe("known");
  });

  it("never presents an UNKNOWN-capacity quota as available; remaining is unknown", () => {
    const v = buildBudgetQuotaView(snap({ configured: null, capacityKnown: false, status: "available" }));
    expect(v.configured).toBe("unknown");
    expect(v.remaining).toBe("unknown");
    expect(v.confidence).toBe("estimated"); // status-known but capacity-unknown → estimated, not "known"
    const u = buildBudgetQuotaView(snap({ configured: null, capacityKnown: false, status: "unknown" }));
    expect(u.confidence).toBe("unknown");
  });

  it("surfaces rate-limited and exhausted states", () => {
    expect(buildBudgetQuotaView(snap({ status: "rate_limited" })).statusLabel).toBe("rate limited");
    expect(buildBudgetQuotaView(snap({ status: "exhausted" })).statusLabel).toBe("exhausted");
  });

  it("shows a reset time ONLY when reliable (never fabricated)", () => {
    expect(buildBudgetQuotaView(snap({ resetsAt: "2026-06-30T05:00:00.000Z", resetReliable: false })).reset).toBe("unknown");
    expect(buildBudgetQuotaView(snap({ resetsAt: "2026-06-30T05:00:00.000Z", resetReliable: true })).reset).toBe(
      "2026-06-30T05:00:00.000Z"
    );
    expect(buildBudgetQuotaView(snap({ resetsAt: null, resetReliable: true })).reset).toBe("unknown");
  });

  it("surfaces a provider-reported signal or 'none'", () => {
    expect(buildBudgetQuotaView(snap({ providerReportedSignal: "5h-window 60%" })).providerReported).toBe("5h-window 60%");
    expect(buildBudgetQuotaView(snap()).providerReported).toBe("none");
  });
});
