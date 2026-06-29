import { describe, expect, it } from "vitest";
import type { FindingSeverity, ReviewFinding, ReviewFindings } from "@triforge/shared";
import { ManualClock } from "../providers/clock.js";
import {
  RepairLoop,
  type GateOutcomeLite,
  type ImplementOutcome,
  type RepairSteps
} from "../execution/repair/index.js";

function finding(severity: FindingSeverity, category = "bug"): ReviewFinding {
  return {
    severity,
    category,
    file: "src/app.ts",
    line: 1,
    evidence: "e",
    impact: "i",
    requiredAction: "fix it",
    missingTest: null,
    confidence: 0.9
  };
}

function findings(sev: FindingSeverity[], category = "bug"): ReviewFindings {
  return { reviewer: "claude", summary: "review", findings: sev.map((s) => finding(s, category)) };
}

function gates(status: GateOutcomeLite["overallStatus"]): GateOutcomeLite {
  return { overallStatus: status };
}

function impl(diffHash: string, over: Partial<ImplementOutcome> = {}): ImplementOutcome {
  return { diffHash, filesChanged: ["src/app.ts"], commandCount: 1, outputBytes: 10, ...over };
}

function loop(steps: RepairSteps, limits: Partial<Parameters<typeof makeLimits>[0]> = {}, isCancelled?: () => boolean) {
  return new RepairLoop({ steps, limits: makeLimits(limits), clock: new ManualClock(), isCancelled });
}

function makeLimits(over: { maxRounds?: number; maxCommands?: number; noProgressLimit?: number } = {}) {
  return { maxRounds: over.maxRounds ?? 5, maxCommands: over.maxCommands, noProgressLimit: over.noProgressLimit };
}

describe("RepairLoop — terminal states", () => {
  it("ACCEPTED when gates pass with no blocking findings", async () => {
    const r = await loop({
      implement: async () => impl("d0"),
      runGates: async () => gates("passed"),
      review: async () => findings([])
    }).run();
    expect(r.state).toBe("accepted");
    expect(r.rounds).toBe(1);
  });

  it("ACCEPTED after a repair round once findings clear", async () => {
    let round = 0;
    const r = await loop({
      implement: async () => impl(`d${round}`),
      runGates: async () => gates("passed"),
      review: async () => {
        const f = round === 0 ? findings(["major"]) : findings([]);
        round += 1;
        return f;
      }
    }).run();
    expect(r.state).toBe("accepted");
    expect(r.rounds).toBe(2);
  });

  it("BLOCKED on a blocker finding", async () => {
    const r = await loop({
      implement: async () => impl("d0"),
      runGates: async () => gates("passed"),
      review: async () => findings(["blocker"])
    }).run();
    expect(r.state).toBe("blocked");
  });

  it("EXHAUSTED at the max repair rounds when gates keep failing (with progress)", async () => {
    let n = 0;
    const r = await loop(
      {
        implement: async () => impl(`d${n++}`), // distinct diff each round → no no-progress
        runGates: async () => gates("failed"),
        review: async () => findings(["major"], `cat${n}`)
      },
      { maxRounds: 3 }
    ).run();
    expect(r.state).toBe("exhausted");
    expect(r.rounds).toBe(3);
  });

  it("REJECTED on no progress (same diff + same findings recur)", async () => {
    const r = await loop(
      {
        implement: async () => impl("same"), // identical diff every round
        runGates: async () => gates("failed"),
        review: async () => findings(["major"]) // identical finding set
      },
      { maxRounds: 6, noProgressLimit: 2 }
    ).run();
    expect(r.state).toBe("rejected");
    expect(r.reason).toMatch(/no progress/);
  });

  it("CANCELLED when cancellation is requested", async () => {
    const r = await loop(
      {
        implement: async () => impl("d0"),
        runGates: async () => gates("passed"),
        review: async () => findings([])
      },
      {},
      () => true
    ).run();
    expect(r.state).toBe("cancelled");
  });

  it("FAILED when a step throws", async () => {
    const r = await loop({
      implement: async () => {
        throw new Error("provider crashed");
      },
      runGates: async () => gates("passed"),
      review: async () => findings([])
    }).run();
    expect(r.state).toBe("failed");
    expect(r.reason).toMatch(/provider crashed/);
  });

  it("EXHAUSTED when a resource limit (commands) is exceeded", async () => {
    let n = 0;
    const r = await loop(
      {
        implement: async () => impl(`d${n++}`, { commandCount: 2 }),
        runGates: async () => gates("failed"),
        review: async () => findings(["major"], `cat${n}`)
      },
      { maxRounds: 10, maxCommands: 3 }
    ).run();
    expect(r.state).toBe("exhausted");
    expect(r.reason).toMatch(/command limit/);
    expect(r.totals.commands).toBeGreaterThan(3);
  });
});
