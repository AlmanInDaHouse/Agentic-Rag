import { describe, expect, it } from "vitest";
import {
  PROVIDER_CONTRACT_SCHEMA_VERSION,
  ProviderIdSchema,
  ProviderUsageSchema,
  ProviderQuotaSchema,
  ProviderErrorCodeSchema,
  // events
  ProviderEventSchema,
  ProviderEventBaseSchema,
  PROVIDER_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
  isTerminalEvent,
  type ProviderEvent,
  type ProviderEventType,
  // capability
  CapabilitySnapshotSchema,
  // adapter
  AvailabilityResultSchema,
  AuthenticationResultSchema,
  ProviderCapabilitiesSchema,
  AgentExecutionRequestSchema,
  ProviderErrorSchema,
  ProviderResultSchema,
  // artifacts
  TaskSpecificationSchema,
  ContextManifestSchema,
  AgentPlanSchema,
  CrossReviewSchema,
  StrategyDecisionSchema,
  TaskProfileSchema,
  RoutingDecisionSchema,
  ImplementationResultSchema,
  ReviewFindingsSchema,
  QualityGateResultSchema,
  GovernanceDecisionSchema,
  RunFinalReportSchema
} from "@triforge/shared";

const ISO = "2026-06-29T00:00:00.000Z";

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PROVIDER_CONTRACT_SCHEMA_VERSION,
    executionId: "exec-1",
    provider: "codex" as const,
    sequenceNumber: 0,
    timestamp: ISO,
    rawEvidenceRef: null,
    ...overrides
  };
}

/** One valid payload per event type, keyed by discriminator. */
const validPayloads: Record<ProviderEventType, unknown> = {
  "run.started": { readOnly: true },
  "authentication.updated": { state: "authenticated", detail: null },
  "agent.message": { role: "assistant", text: "working" },
  "plan.updated": { steps: [{ title: "step one", status: "pending" }] },
  "tool.started": { toolCallId: "t1", toolName: "read_file", arguments: { path: "a.ts" } },
  "tool.completed": { toolCallId: "t1", toolName: "read_file", status: "succeeded", summary: null },
  "file.changed": { path: "src/a.ts", changeType: "modified", diffHash: "abc" },
  "usage.updated": { usage: { provider: "codex", source: "provider_event" } },
  "quota.updated": {
    quota: { provider: "codex", status: "available", window: "five_hour", source: "cli_status" }
  },
  "approval.requested": {
    approvalId: "ap1",
    actionType: "modify_code",
    riskLevel: "high",
    reason: null
  },
  "warning.raised": { code: "W1", message: "heads up" },
  "run.failed": { errorCode: "timeout", message: "timed out", partial: true },
  "run.completed": { summary: "done", filesChangedCount: 2 }
};

describe("provider contract — primitives", () => {
  it("exposes a frozen schema version", () => {
    expect(PROVIDER_CONTRACT_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("ProviderId accepts codex/claude only", () => {
    expect(ProviderIdSchema.parse("codex")).toBe("codex");
    expect(ProviderIdSchema.parse("claude")).toBe("claude");
    expect(ProviderIdSchema.safeParse("gemini").success).toBe(false);
  });

  it("usage is never billing-authoritative and rejects true", () => {
    const usage = ProviderUsageSchema.parse({ provider: "claude", source: "local_estimate" });
    expect(usage.isBillingAuthoritative).toBe(false);
    expect(
      ProviderUsageSchema.safeParse({
        provider: "claude",
        source: "local_estimate",
        isBillingAuthoritative: true
      }).success
    ).toBe(false);
  });

  it("quota never fabricates: unknown status/window parse", () => {
    const quota = ProviderQuotaSchema.parse({
      provider: "claude",
      status: "unknown",
      window: "unknown",
      source: "unknown"
    });
    expect(quota.isBillingAuthoritative).toBe(false);
    expect(quota.utilization).toBeUndefined();
  });

  it("error taxonomy enumerates the expected codes", () => {
    expect(ProviderErrorCodeSchema.safeParse("sequence_gap").success).toBe(true);
    expect(ProviderErrorCodeSchema.safeParse("not_a_code").success).toBe(false);
  });

  it("quota accepts an inherited exhaustionFlavor and rejects an unknown one", () => {
    expect(
      ProviderQuotaSchema.safeParse({
        provider: "codex",
        status: "exhausted",
        window: "seven_day",
        source: "cli_status",
        exhaustionFlavor: "codex_weekly"
      }).success
    ).toBe(true);
    expect(
      ProviderQuotaSchema.safeParse({
        provider: "codex",
        status: "exhausted",
        window: "seven_day",
        source: "cli_status",
        exhaustionFlavor: "codex_monthly"
      }).success
    ).toBe(false);
  });

  it("quota utilization is a bounded 0–1 ratio", () => {
    expect(
      ProviderQuotaSchema.parse({
        provider: "claude",
        status: "warning",
        window: "five_hour",
        source: "cli_status",
        utilization: 0.75
      }).utilization
    ).toBe(0.75);
    expect(
      ProviderQuotaSchema.safeParse({
        provider: "claude",
        status: "warning",
        window: "five_hour",
        source: "cli_status",
        utilization: 1.5
      }).success
    ).toBe(false);
  });

  it("usage carries a reasoningIntensity from the enum", () => {
    const usage = ProviderUsageSchema.parse({
      provider: "claude",
      source: "local_estimate",
      reasoningIntensity: "heavy"
    });
    expect(usage.reasoningIntensity).toBe("heavy");
    expect(
      ProviderUsageSchema.safeParse({
        provider: "claude",
        source: "local_estimate",
        reasoningIntensity: "extreme"
      }).success
    ).toBe(false);
  });
});

describe("provider event — envelope + discriminated union", () => {
  it("enumerates exactly the 13 event types", () => {
    expect(PROVIDER_EVENT_TYPES).toHaveLength(13);
    expect(new Set(PROVIDER_EVENT_TYPES).size).toBe(13);
  });

  it("routes each of the 13 event types through the discriminated union", () => {
    for (const type of PROVIDER_EVENT_TYPES) {
      const event = baseEvent({ type, payload: validPayloads[type] });
      const parsed = ProviderEventSchema.parse(event) as ProviderEvent;
      expect(parsed.type).toBe(type);
    }
  });

  it("rejects an unknown discriminator", () => {
    expect(
      ProviderEventSchema.safeParse(baseEvent({ type: "bogus.event", payload: {} })).success
    ).toBe(false);
  });

  it("rejects a payload that does not match its event type", () => {
    // run.started expects { readOnly: boolean }
    expect(
      ProviderEventSchema.safeParse(baseEvent({ type: "run.started", payload: { readOnly: "yes" } }))
        .success
    ).toBe(false);
  });

  it(".strict() rejects unknown top-level keys", () => {
    expect(
      ProviderEventSchema.safeParse(
        baseEvent({ type: "run.started", payload: { readOnly: true }, extra: 1 })
      ).success
    ).toBe(false);
  });

  it("requires the envelope fields", () => {
    const { executionId, ...withoutExec } = baseEvent({
      type: "run.started",
      payload: { readOnly: true }
    });
    void executionId;
    expect(ProviderEventSchema.safeParse(withoutExec).success).toBe(false);
  });

  it("rejects a negative sequence number", () => {
    expect(
      ProviderEventSchema.safeParse(
        baseEvent({ type: "run.started", payload: { readOnly: true }, sequenceNumber: -1 })
      ).success
    ).toBe(false);
  });

  it("base envelope schema validates the common fields", () => {
    expect(ProviderEventBaseSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it("defaults rawEvidenceRef to null", () => {
    const event = {
      schemaVersion: "1.0.0",
      executionId: "e",
      provider: "claude" as const,
      sequenceNumber: 1,
      timestamp: ISO,
      type: "agent.message" as const,
      payload: { text: "hi" }
    };
    const parsed = ProviderEventSchema.parse(event) as ProviderEvent;
    expect(parsed.rawEvidenceRef).toBeNull();
  });
});

describe("provider event — terminal semantics", () => {
  it("marks run.failed and run.completed as terminal", () => {
    expect([...TERMINAL_EVENT_TYPES].sort()).toEqual(["run.completed", "run.failed"]);
    expect(isTerminalEvent("run.failed")).toBe(true);
    expect(isTerminalEvent("run.completed")).toBe(true);
  });

  it("marks every non-terminal type as non-terminal", () => {
    for (const type of PROVIDER_EVENT_TYPES) {
      const terminal = type === "run.failed" || type === "run.completed";
      expect(isTerminalEvent(type)).toBe(terminal);
    }
  });

  it("accepts a full event object", () => {
    const completed = ProviderEventSchema.parse(
      baseEvent({ type: "run.completed", payload: validPayloads["run.completed"] })
    ) as ProviderEvent;
    expect(isTerminalEvent(completed)).toBe(true);
  });
});

describe("capability snapshot", () => {
  const valid = {
    provider: "codex" as const,
    cliVersion: "0.1.0",
    verifiedAt: ISO,
    headlessSupport: "yes",
    structuredOutput: "yes",
    eventStream: "unknown",
    authProbe: "yes",
    usageObservable: "unknown",
    quotaObservable: "unknown",
    readOnly: "yes",
    write: "no",
    cancellation: "unknown",
    resume: "unknown",
    unknownCapabilities: ["sandbox"]
  };

  it("parses a valid tri-state snapshot", () => {
    expect(CapabilitySnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it("allows a null cliVersion (undetectable)", () => {
    expect(CapabilitySnapshotSchema.safeParse({ ...valid, cliVersion: null }).success).toBe(true);
  });

  it("rejects a non tri-state capability value", () => {
    expect(CapabilitySnapshotSchema.safeParse({ ...valid, write: "maybe" }).success).toBe(false);
  });

  it(".strict() rejects unknown keys", () => {
    expect(CapabilitySnapshotSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it("ProviderCapabilities aliases the capability snapshot", () => {
    expect(ProviderCapabilitiesSchema.safeParse(valid).success).toBe(true);
  });
});

describe("adapter data contracts", () => {
  it("parses availability and authentication results", () => {
    expect(
      AvailabilityResultSchema.safeParse({
        provider: "codex",
        status: "available",
        checkedAt: ISO
      }).success
    ).toBe(true);
    expect(
      AuthenticationResultSchema.safeParse({
        provider: "claude",
        state: "expired",
        checkedAt: ISO
      }).success
    ).toBe(true);
  });

  it("parses an execution request with defaults", () => {
    const req = AgentExecutionRequestSchema.parse({
      executionId: "exec-9",
      provider: "claude",
      objective: "summarize the module",
      timeoutMs: 60000
    });
    expect(req.readOnly).toBe(true);
    expect(req.sanitizedArguments).toEqual([]);
    expect(req.schemaVersion).toBe(PROVIDER_CONTRACT_SCHEMA_VERSION);
  });

  it("rejects a non-positive timeout", () => {
    expect(
      AgentExecutionRequestSchema.safeParse({
        executionId: "x",
        provider: "codex",
        objective: "o",
        timeoutMs: 0
      }).success
    ).toBe(false);
  });

  it("parses a provider error and a terminal result", () => {
    expect(
      ProviderErrorSchema.safeParse({
        code: "process_crashed",
        message: "boom",
        provider: "codex",
        executionId: "exec-1"
      }).success
    ).toBe(true);

    const result = ProviderResultSchema.parse({
      schemaVersion: "1.0.0",
      provider: "codex",
      executionId: "exec-1",
      status: "completed",
      terminalEventType: "run.completed",
      terminalSequenceNumber: 12
    });
    expect(result.terminalEventType).toBe("run.completed");
    expect(result.filesChanged).toEqual([]);
  });

  it("rejects a result whose terminal event type is not terminal", () => {
    expect(
      ProviderResultSchema.safeParse({
        schemaVersion: "1.0.0",
        provider: "codex",
        executionId: "exec-1",
        status: "completed",
        terminalEventType: "agent.message",
        terminalSequenceNumber: 1
      }).success
    ).toBe(false);
  });

  it("parses a failed result with a populated error and a cancelled result", () => {
    const failed = ProviderResultSchema.parse({
      schemaVersion: "1.0.0",
      provider: "claude",
      executionId: "exec-2",
      status: "failed",
      terminalEventType: "run.failed",
      terminalSequenceNumber: 7,
      error: {
        code: "process_crashed",
        message: "boom",
        provider: "claude",
        executionId: "exec-2"
      }
    });
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("process_crashed");

    const cancelled = ProviderResultSchema.parse({
      schemaVersion: "1.0.0",
      provider: "codex",
      executionId: "exec-3",
      status: "cancelled",
      terminalEventType: "run.failed",
      terminalSequenceNumber: 3
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it(".strict() rejects an unknown key on the execution request", () => {
    expect(
      AgentExecutionRequestSchema.safeParse({
        executionId: "x",
        provider: "codex",
        objective: "o",
        timeoutMs: 1000,
        extra: true
      }).success
    ).toBe(false);
  });
});

describe("artifact contracts — round-trip + validation", () => {
  const examples: Array<{ name: string; schema: { parse: (v: unknown) => unknown }; value: unknown }> = [
    {
      name: "TaskSpecification",
      schema: TaskSpecificationSchema,
      value: {
        objective: "Add provider contracts",
        scope: ["packages/shared"],
        nonGoals: ["adapters"],
        invariants: ["no provider-specific logic"],
        acceptanceCriteria: ["schemas compile"],
        failureModes: ["circular import"],
        relationToPriorDecisions: ["ADR 0027"]
      }
    },
    {
      name: "ContextManifest",
      schema: ContextManifestSchema,
      value: {
        generatedAt: ISO,
        entries: [
          {
            sourceId: "s1",
            sourceType: "spec",
            provenance: "docs/instrucciones.md",
            contentHash: "h1",
            retrievalRef: "r1"
          }
        ]
      }
    },
    {
      name: "AgentPlan",
      schema: AgentPlanSchema,
      value: {
        owner: "codex",
        rationale: "structured implementation",
        steps: [{ index: 0, description: "write schemas", expectedOutcome: "compiles" }]
      }
    },
    {
      name: "CrossReview",
      schema: CrossReviewSchema,
      value: {
        reviewer: "claude",
        target: "codex-plan",
        findings: [{ summary: "missing test", agreement: "disagree", detail: null }]
      }
    },
    {
      name: "StrategyDecision",
      schema: StrategyDecisionSchema,
      value: {
        chosenOption: "single owner",
        consideredOptions: ["single owner", "debate"],
        authoritySourceRanking: ["safety_invariants", "spec", "tests"],
        decidingAuthoritySource: "spec",
        rationale: "spec is explicit"
      }
    },
    {
      name: "TaskProfile",
      schema: TaskProfileSchema,
      value: {
        taskKind: "contract",
        complexity: "medium",
        risk: "high",
        blastRadius: "package",
        reasoningDepthRequired: 3,
        repetitiveWorkRatio: 0.2,
        testBurden: 0.8,
        behavioralPreservationRequired: true
      }
    },
    {
      name: "RoutingDecision",
      schema: RoutingDecisionSchema,
      value: {
        preferredOwner: "claude",
        assignedOwner: "codex",
        capabilityScore: 0.7,
        quotaAvailabilityScore: 0.5,
        historicalPerformanceScore: 0.6,
        risk: "medium",
        degradedFromPreferredOwner: true,
        reason: ["claude unavailable"],
        humanApprovalRequired: false
      }
    },
    {
      name: "ImplementationResult",
      schema: ImplementationResultSchema,
      value: {
        owner: "codex",
        diffHash: "deadbeef",
        filesChanged: ["a.ts"],
        commands: ["pnpm build"],
        tests: { passed: 10, failed: 0, skipped: 1, total: 11 },
        mutationSummary: { filesCreated: 5, filesModified: 1, filesDeleted: 0 }
      }
    },
    {
      name: "ReviewFindings",
      schema: ReviewFindingsSchema,
      value: {
        reviewer: "claude",
        summary: "one blocker",
        findings: [
          {
            severity: "blocker",
            category: "security",
            file: "a.ts",
            line: 10,
            evidence: "unsanitized input",
            impact: "rce",
            requiredAction: "sanitize",
            missingTest: "injection test",
            confidence: 0.9
          }
        ]
      }
    },
    {
      name: "QualityGateResult",
      schema: QualityGateResultSchema,
      value: {
        overallStatus: "passed",
        gates: [
          { name: "typecheck", status: "passed", detail: null },
          { name: "build", status: "passed", detail: null },
          { name: "security", status: "unknown", detail: "not run" }
        ]
      }
    },
    {
      name: "GovernanceDecision",
      schema: GovernanceDecisionSchema,
      value: {
        task: "A1 provider contracts",
        specRef: "docs/specs/PROVIDER_CONTRACTS_SPEC.md",
        owner: "codex",
        reviewer: "claude",
        contextRef: "context-pack-1",
        diffHash: "cafe",
        tests: { passed: 30, failed: 0, skipped: 0, total: 30 },
        findingsSummary: { blocker: 0, critical: 0, major: 0, minor: 1, observation: 2 },
        quota: { provider: "codex", status: "available", window: "five_hour", source: "cli_status" },
        risks: ["schema drift"],
        mergeDecision: "merge",
        justification: "all gates green, no blockers",
        capabilityBinding: {
          threat: ["T-INJ-12"],
          control: ["A1.2 strict schema validation"],
          milestone: "A1",
          verification: ["providerContracts.test.ts"],
          recovery: "revert PR",
          residualRisk: "well-formed-but-false events (medium)"
        }
      }
    },
    {
      name: "RunFinalReport",
      schema: RunFinalReportSchema,
      value: {
        objective: "ship A1",
        baseSha: "abc123",
        branch: "feat/provider-contracts",
        commit: "def456",
        pr: "#42",
        mergeSha: null,
        files: ["packages/shared/src/provider/events.ts"],
        tests: { passed: 30, failed: 0, skipped: 0, total: 30 },
        findings: { blocker: 0, critical: 0, major: 0, minor: 1, observation: 2 },
        decisions: ["contracts precede adapters"],
        risks: ["schema drift"],
        finalState: "completed",
        nextObjective: "A2 mocks"
      }
    }
  ];

  it("covers all 12 artifact contracts", () => {
    expect(examples).toHaveLength(12);
  });

  for (const { name, schema, value } of examples) {
    it(`${name} parses and round-trips`, () => {
      const parsed = schema.parse(value);
      expect(schema.parse(parsed)).toEqual(parsed);
    });
  }
});

describe("artifact contracts — enum + binding enforcement", () => {
  const taskProfile = {
    taskKind: "contract",
    complexity: "medium",
    risk: "high",
    blastRadius: "package",
    reasoningDepthRequired: 3,
    repetitiveWorkRatio: 0.2,
    testBurden: 0.8,
    behavioralPreservationRequired: true
  };

  it("TaskProfile rejects an out-of-enum risk and blast radius", () => {
    expect(TaskProfileSchema.safeParse({ ...taskProfile, risk: "extreme" }).success).toBe(false);
    expect(TaskProfileSchema.safeParse({ ...taskProfile, blastRadius: "galaxy" }).success).toBe(
      false
    );
    expect(TaskProfileSchema.safeParse({ ...taskProfile, complexity: "epic" }).success).toBe(false);
  });

  it("RoutingDecision rejects an owner outside the provider enum", () => {
    expect(
      RoutingDecisionSchema.safeParse({
        preferredOwner: "gemini",
        assignedOwner: "codex",
        capabilityScore: 0.5,
        quotaAvailabilityScore: 0.5,
        historicalPerformanceScore: 0.5,
        risk: "low",
        degradedFromPreferredOwner: false,
        reason: [],
        humanApprovalRequired: false
      }).success
    ).toBe(false);
  });

  it("GovernanceDecision requires all 6 capability-binding fields", () => {
    const bindingFields = [
      "threat",
      "control",
      "milestone",
      "verification",
      "recovery",
      "residualRisk"
    ] as const;
    const fullBinding: Record<string, unknown> = {
      threat: ["T-INJ-12"],
      control: ["strict validation"],
      milestone: "A1",
      verification: ["providerContracts.test.ts"],
      recovery: "revert",
      residualRisk: "low"
    };
    const base = {
      task: "t",
      specRef: "s",
      owner: "codex",
      reviewer: "claude",
      contextRef: "c",
      diffHash: "d",
      tests: { passed: 1, failed: 0, skipped: 0, total: 1 },
      findingsSummary: { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 },
      risks: [],
      mergeDecision: "merge",
      justification: "ok",
      capabilityBinding: fullBinding
    };

    expect(GovernanceDecisionSchema.safeParse(base).success).toBe(true);

    for (const field of bindingFields) {
      const { [field]: _omitted, ...partialBinding } = fullBinding;
      void _omitted;
      const candidate = { ...base, capabilityBinding: partialBinding };
      expect(GovernanceDecisionSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("GovernanceDecision rejects an out-of-enum merge decision", () => {
    expect(
      GovernanceDecisionSchema.safeParse({
        task: "t",
        specRef: "s",
        owner: "codex",
        reviewer: "claude",
        contextRef: "c",
        diffHash: "d",
        tests: { passed: 1, failed: 0, skipped: 0, total: 1 },
        findingsSummary: { blocker: 0, critical: 0, major: 0, minor: 0, observation: 0 },
        mergeDecision: "maybe",
        justification: "ok",
        capabilityBinding: {
          threat: ["T-1"],
          control: ["c"],
          milestone: "A1",
          verification: ["v"],
          recovery: "r",
          residualRisk: "low"
        }
      }).success
    ).toBe(false);
  });

  it("ReviewFindings rejects an out-of-enum severity", () => {
    expect(
      ReviewFindingsSchema.safeParse({
        reviewer: "claude",
        summary: "s",
        findings: [
          {
            severity: "showstopper",
            category: "c",
            evidence: "e",
            impact: "i",
            requiredAction: "a",
            confidence: 0.5
          }
        ]
      }).success
    ).toBe(false);
  });

  it(".strict() rejects an unknown key on TaskSpecification", () => {
    expect(
      TaskSpecificationSchema.safeParse({
        objective: "o",
        extra: true
      }).success
    ).toBe(false);
  });
});
