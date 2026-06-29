import { describe, expect, it } from "vitest";
import type { AuthenticationState, ProviderId } from "@triforge/shared";
import { QuotaManager } from "../providers/quota/index.js";
import { profileTask, routeQuotaAware, QUOTA_AWARE_ROUTER_VERSION } from "../orchestration/index.js";

const PROVIDERS: readonly [ProviderId, ProviderId] = ["codex", "claude"];

function profile(objective = "implement a feature") {
  return profileTask({
    objective,
    scope: [],
    nonGoals: [],
    invariants: [],
    acceptanceCriteria: [],
    failureModes: [],
    relationToPriorDecisions: []
  });
}

function authAll(state: AuthenticationState): Record<ProviderId, AuthenticationState> {
  return { codex: state, claude: state };
}

function quotaWithBudgets(): QuotaManager {
  const m = new QuotaManager();
  m.configureBudget({ provider: "codex", capacity: 100, unit: "codex_invocations" });
  m.configureBudget({ provider: "claude", capacity: 100, unit: "claude_invocations" });
  return m;
}

describe("routeQuotaAware — capability + quota + auth + risk", () => {
  it("ROUTES when both providers are authenticated with budget", () => {
    const p = profile();
    const r = routeQuotaAware({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      quota: quotaWithBudgets(),
      authState: authAll("authenticated")
    });
    expect(r.status).toBe("routed");
    expect(PROVIDERS).toContain(r.routing.assignedOwner);
    expect(r.routing.humanApprovalRequired).toBe(false);
    expect(r.routerVersion).toBe(QUOTA_AWARE_ROUTER_VERSION);
  });

  it("AUTH-GATES an unauthenticated provider and routes to the authenticated one", () => {
    const p = profile();
    const r = routeQuotaAware({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      quota: quotaWithBudgets(),
      authState: { codex: "authenticated", claude: "required" }
    });
    expect(r.authGated).toEqual(["claude"]);
    expect(r.routing.assignedOwner).toBe("codex");
    expect(r.status).toBe("routed");
  });

  it("PAUSES (not hard-stop) when no provider is authenticated", () => {
    const p = profile();
    const r = routeQuotaAware({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      quota: quotaWithBudgets(),
      authState: authAll("expired")
    });
    expect(r.authGated.sort()).toEqual(["claude", "codex"]);
    expect(r.routing.humanApprovalRequired).toBe(true);
    expect(r.status).toBe("paused");
  });

  it("HARD-STOPS when all providers are quota-exhausted (no paid fallback)", () => {
    const m = quotaWithBudgets();
    m.hardStop("codex", "five-hour window exhausted");
    m.hardStop("claude", "weekly quota exhausted");
    const p = profile();
    const r = routeQuotaAware({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      quota: m,
      authState: authAll("authenticated")
    });
    expect(r.routing.humanApprovalRequired).toBe(true);
    expect(r.status).toBe("hard_stop");
    expect(r.rationale.some((x) => /no paid fallback/i.test(x))).toBe(true);
  });

  it("never presents an UNKNOWN-capacity quota as guaranteed availability", () => {
    const m = new QuotaManager();
    m.configureBudget({ provider: "codex", capacity: "unknown", unit: "codex_window" });
    m.configureBudget({ provider: "claude", capacity: "unknown", unit: "claude_window" });
    const p = profile();
    const r = routeQuotaAware({
      profile: p.profile,
      extended: p.extended,
      providers: PROVIDERS,
      quota: m,
      authState: authAll("authenticated")
    });
    // Unknown capacity → availability is mid (0.5), never a fabricated 1.0.
    expect(r.routing.quotaAvailabilityScore).toBeLessThanOrEqual(0.5);
  });
});
