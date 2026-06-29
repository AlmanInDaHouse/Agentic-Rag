import { describe, expect, it } from "vitest";
import { GovernanceDecisionSchema, type CapabilityBinding, type FindingsSummary, type TestSummary } from "@triforge/shared";
import {
  buildGovernanceDecision,
  decideVerdict,
  verifyDecisionBinding,
  GOVERNANCE_POLICY_VERSION,
  type GovernanceInputs
} from "../execution/governance/index.js";

const BINDING: CapabilityBinding = {
  threat: ["T-INT-04"],
  control: ["A5.5 ledger reconcile", "A5.6 real gates"],
  milestone: "A5.8",
  verification: ["governanceGate.test.ts"],
  recovery: "revert + ledger",
  residualRisk: "RR-4 no OS sandbox"
};

const NO_FINDINGS: FindingsSummary = { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 };
const TESTS: TestSummary = { passed: 10, failed: 0, skipped: 0, total: 10 };

function makeInputs(over: Partial<GovernanceInputs> = {}): GovernanceInputs {
  return {
    task: "add feature X",
    specHash: "spec-hash",
    acceptanceCriteria: ["does X"],
    contextHash: "ctx-hash",
    owner: "codex",
    reviewer: "claude",
    worktree: "/wt",
    branch: "triforge/run1/taskA",
    diffHash: "diff-1",
    ledgerHeadHash: "ledger-1",
    ledgerTampered: false,
    gateTampered: false,
    gatesPassed: true,
    gateTestedDiffHash: "diff-1",
    gateResultHash: "gate-1",
    findings: NO_FINDINGS,
    tests: TESTS,
    repairState: "accepted",
    repairRounds: 1,
    quota: null,
    unresolvedRisks: [],
    capabilityBinding: BINDING,
    ...over
  };
}

describe("decideVerdict — hard merge preconditions", () => {
  it("MERGE only when every precondition passes", () => {
    expect(decideVerdict(makeInputs()).verdict).toBe("merge");
  });

  it("BLOCK on an open blocker or critical finding", () => {
    expect(decideVerdict(makeInputs({ findings: { ...NO_FINDINGS, blocker: 1 } })).verdict).toBe("block");
    expect(decideVerdict(makeInputs({ findings: { ...NO_FINDINGS, critical: 1 } })).verdict).toBe("block");
  });

  it("BLOCK on a tampered ledger (does not reconcile with the worktree)", () => {
    expect(decideVerdict(makeInputs({ ledgerTampered: true })).verdict).toBe("block");
  });

  it("BLOCK on gate tampering (deleted tests / weakened CI)", () => {
    expect(decideVerdict(makeInputs({ gateTampered: true })).verdict).toBe("block");
  });

  it("BLOCK when gates did not pass", () => {
    expect(decideVerdict(makeInputs({ gatesPassed: false })).verdict).toBe("block");
  });

  it("BLOCK when gates were run against a different diff (stale gates)", () => {
    expect(decideVerdict(makeInputs({ gateTestedDiffHash: "diff-OTHER" })).verdict).toBe("block");
  });

  it("maps repair terminal states", () => {
    expect(decideVerdict(makeInputs({ repairState: "blocked" })).verdict).toBe("block");
    expect(decideVerdict(makeInputs({ repairState: "rejected" })).verdict).toBe("reject");
    expect(decideVerdict(makeInputs({ repairState: "exhausted" })).verdict).toBe("reject");
    expect(decideVerdict(makeInputs({ repairState: "cancelled" })).verdict).toBe("cancel");
    expect(decideVerdict(makeInputs({ repairState: "failed" })).verdict).toBe("block");
  });
});

describe("buildGovernanceDecision — A1 artifact + binding", () => {
  it("produces a schema-valid A1 GovernanceDecision with mergeDecision=merge", () => {
    const record = buildGovernanceDecision(makeInputs());
    expect(record.verdict).toBe("merge");
    expect(record.policyVersion).toBe(GOVERNANCE_POLICY_VERSION);
    expect(record.artifact.mergeDecision).toBe("merge");
    // The artifact validates against the shared A1 schema.
    expect(() => GovernanceDecisionSchema.parse(record.artifact)).not.toThrow();
    expect(record.binding).toMatchObject({ diffHash: "diff-1", ledgerHeadHash: "ledger-1", gateResultHash: "gate-1" });
  });

  it("downgrades the A1 mergeDecision to block on an integrity failure", () => {
    const record = buildGovernanceDecision(makeInputs({ ledgerTampered: true }));
    expect(record.verdict).toBe("block");
    expect(record.artifact.mergeDecision).toBe("block");
  });
});

describe("verifyDecisionBinding — replay / post-decision change protection", () => {
  it("accepts a decision whose binding matches the current state", () => {
    const record = buildGovernanceDecision(makeInputs());
    const check = verifyDecisionBinding(record, { diffHash: "diff-1", ledgerHeadHash: "ledger-1", gateResultHash: "gate-1" });
    expect(check.valid).toBe(true);
  });

  it("refuses a decision applied to a CHANGED diff (replay / post-decision modification)", () => {
    const record = buildGovernanceDecision(makeInputs());
    const check = verifyDecisionBinding(record, { diffHash: "diff-2", ledgerHeadHash: "ledger-1", gateResultHash: "gate-1" });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/diff changed/);
  });

  it("refuses when the ledger changed since the decision", () => {
    const record = buildGovernanceDecision(makeInputs());
    const check = verifyDecisionBinding(record, { diffHash: "diff-1", ledgerHeadHash: "ledger-2", gateResultHash: "gate-1" });
    expect(check.valid).toBe(false);
  });

  it("refuses when the gate result expired (changed) since the decision", () => {
    const record = buildGovernanceDecision(makeInputs());
    const check = verifyDecisionBinding(record, { diffHash: "diff-1", ledgerHeadHash: "ledger-1", gateResultHash: "gate-2" });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/expired gates/);
  });
});
