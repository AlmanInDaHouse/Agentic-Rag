import { describe, expect, it } from "vitest";
import { buildGovernanceDashboard, type GovernanceObservation } from "./governanceDashboard.js";

function obs(over: Partial<GovernanceObservation> = {}): GovernanceObservation {
  return {
    mergeVerdict: "merge",
    mergeRationale: "gates passed, ledger reconciled",
    policyDecisions: [
      { kind: "command", outcome: "denied", detail: "rm is destructive" },
      { kind: "path", outcome: "allowed", detail: "src/a.ts" }
    ],
    riskState: "medium",
    quotaState: "available",
    rollback: false,
    cancelled: false,
    ...over
  };
}

describe("buildGovernanceDashboard — observe, never invent; human override audited", () => {
  it("renders the merge verdict + rationale and the policy decisions", () => {
    const v = buildGovernanceDashboard(obs());
    expect(v.merge).toEqual({ verdict: "merge", rationale: "gates passed, ledger reconciled" });
    expect(v.decisions).toHaveLength(2);
    expect(v.decisions[0]).toMatchObject({ kind: "command", outcome: "denied" });
    expect(v.riskState).toBe("medium");
    expect(v.quotaState).toBe("available");
  });

  it("does not invent absent fields", () => {
    const v = buildGovernanceDashboard({});
    expect(v.merge).toBeNull();
    expect(v.decisions).toEqual([]);
    expect(v.riskState).toBe("unknown");
    expect(v.quotaState).toBe("unknown");
    expect(v.humanOverride).toBeNull();
  });

  it("shows a human override as AUDITED (actor + reason + timestamp)", () => {
    const v = buildGovernanceDashboard(
      obs({ humanOverride: { actor: "owner", reason: "accept residual risk", at: "2026-06-29T01:00:00.000Z" } })
    );
    expect(v.humanOverride).toEqual({ actor: "owner", reason: "accept residual risk", at: "2026-06-29T01:00:00.000Z" });
  });

  it("sanitizes decision + rationale + override text", () => {
    const v = buildGovernanceDashboard(
      obs({
        mergeRationale: "\x1b[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU\x1b[0m",
        humanOverride: { actor: "owner\x00", reason: "ok", at: "t" }
      })
    );
    expect(v.merge?.rationale).not.toContain("\x1b");
    expect(v.merge?.rationale).toContain("«redacted»");
    expect(v.humanOverride?.actor).toBe("owner");
  });
});
