import { describe, expect, it } from "vitest";
import type {
  GovernanceDecision,
  ImplementationResult,
  TaskSpecification
} from "@triforge/shared";
import { buildArtifactExplorer, type RunArtifacts } from "./artifactExplorer.js";

describe("buildArtifactExplorer — never hides an artifact; honest absence; sanitized", () => {
  it("lists ALL 14 artifact kinds even when none are present", () => {
    const view = buildArtifactExplorer({});
    expect(view.views).toHaveLength(14);
    expect(view.views.every((v) => v.present === false)).toBe(true);
    expect(view.absent).toHaveLength(14);
  });

  it("marks present artifacts with a summary and surfaces hashes/refs", () => {
    const artifacts: RunArtifacts = {
      taskSpecification: { objective: "add feature" } as TaskSpecification,
      implementationResult: { diffHash: "diff-1", filesChanged: ["a.ts", "b.ts"] } as ImplementationResult,
      governanceDecision: { mergeDecision: "merge", diffHash: "diff-1" } as GovernanceDecision,
      mutationLedgerRef: "ledger://run1",
      rawEvidenceRefs: ["ev://1", "ev://2"]
    };
    const view = buildArtifactExplorer(artifacts);
    const by = (k: string) => view.views.find((v) => v.kind === k)!;

    expect(by("TaskSpecification").present).toBe(true);
    expect(by("TaskSpecification").summary).toBe("add feature");
    expect(by("ImplementationResult").summary).toContain("2 file");
    expect(by("ImplementationResult").refs).toContainEqual({ label: "diffHash", value: "diff-1" });
    expect(by("GovernanceDecision").summary).toContain("merge");
    expect(by("MutationLedger").present).toBe(true);
    expect(by("RawEvidence").summary).toContain("2 evidence");
    // Absent ones are still listed and reported as absent.
    expect(by("AgentPlan").present).toBe(false);
    expect(view.absent).toContain("AgentPlan");
  });

  it("sanitizes free text in artifact summaries", () => {
    const view = buildArtifactExplorer({
      taskSpecification: { objective: "\x1b[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU\x1b[0m" } as TaskSpecification
    });
    const summary = view.views.find((v) => v.kind === "TaskSpecification")!.summary;
    expect(summary).not.toContain("\x1b");
    expect(summary).toContain("«redacted»");
  });
});
