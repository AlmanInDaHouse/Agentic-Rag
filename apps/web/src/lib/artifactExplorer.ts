/**
 * A8.4 Artifact Explorer view-model (mandate §10 A8.4).
 *
 * Normalizes the 12 A1 artifacts + the mutation ledger + raw evidence references into a
 * UNIFORM display list — without inventing data and WITHOUT HIDING any artifact: every
 * known kind is listed as present (with a sanitized summary + its hashes/refs) or
 * explicitly absent. Free text is run through `safeText`. Pure + deterministic.
 */

import type {
  AgentPlan,
  ContextManifest,
  CrossReview,
  GovernanceDecision,
  ImplementationResult,
  QualityGateResult,
  ReviewFindings,
  RoutingDecision,
  RunFinalReport,
  StrategyDecision,
  TaskProfile,
  TaskSpecification
} from "@triforge/shared";
import { safeText } from "./sanitize.js";

export interface RunArtifacts {
  taskSpecification?: TaskSpecification;
  contextManifest?: ContextManifest;
  agentPlan?: AgentPlan;
  crossReview?: CrossReview;
  strategyDecision?: StrategyDecision;
  taskProfile?: TaskProfile;
  routingDecision?: RoutingDecision;
  implementationResult?: ImplementationResult;
  reviewFindings?: ReviewFindings;
  qualityGateResult?: QualityGateResult;
  governanceDecision?: GovernanceDecision;
  runFinalReport?: RunFinalReport;
  mutationLedgerRef?: string;
  rawEvidenceRefs?: string[];
}

export interface ArtifactView {
  kind: string;
  present: boolean;
  summary: string;
  refs: { label: string; value: string }[];
}

export interface ArtifactExplorerView {
  views: ArtifactView[];
  absent: string[];
}

/** The fixed display order of artifact kinds (none is ever hidden). */
const ARTIFACT_KINDS = [
  "TaskSpecification",
  "ContextManifest",
  "AgentPlan",
  "CrossReview",
  "StrategyDecision",
  "TaskProfile",
  "RoutingDecision",
  "ImplementationResult",
  "ReviewFindings",
  "QualityGateResult",
  "GovernanceDecision",
  "RunFinalReport",
  "MutationLedger",
  "RawEvidence"
] as const;

function s(text: string): string {
  return safeText(text, 2000).text;
}

function describe(kind: string, a: RunArtifacts): { present: boolean; summary: string; refs: { label: string; value: string }[] } {
  switch (kind) {
    case "TaskSpecification":
      return a.taskSpecification
        ? { present: true, summary: s(a.taskSpecification.objective), refs: [] }
        : { present: false, summary: "", refs: [] };
    case "ContextManifest":
      return a.contextManifest
        ? { present: true, summary: `${a.contextManifest.entries.length} source(s)`, refs: a.contextManifest.entries.map((e) => ({ label: "contentHash", value: s(e.contentHash) })) }
        : { present: false, summary: "", refs: [] };
    case "AgentPlan":
      return a.agentPlan
        ? { present: true, summary: `${a.agentPlan.owner}: ${a.agentPlan.steps.length} step(s)`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "CrossReview":
      return a.crossReview
        ? { present: true, summary: `${a.crossReview.reviewer} → ${a.crossReview.findings.length} finding(s)`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "StrategyDecision":
      return a.strategyDecision
        ? { present: true, summary: s(a.strategyDecision.chosenOption), refs: [{ label: "decidingAuthority", value: a.strategyDecision.decidingAuthoritySource }] }
        : { present: false, summary: "", refs: [] };
    case "TaskProfile":
      return a.taskProfile
        ? { present: true, summary: `${a.taskProfile.taskKind}/${a.taskProfile.complexity}/${a.taskProfile.risk}`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "RoutingDecision":
      return a.routingDecision
        ? { present: true, summary: `owner=${a.routingDecision.assignedOwner}${a.routingDecision.degradedFromPreferredOwner ? " (degraded)" : ""}`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "ImplementationResult":
      return a.implementationResult
        ? { present: true, summary: `${a.implementationResult.filesChanged.length} file(s) changed`, refs: [{ label: "diffHash", value: s(a.implementationResult.diffHash) }] }
        : { present: false, summary: "", refs: [] };
    case "ReviewFindings":
      return a.reviewFindings
        ? { present: true, summary: `${a.reviewFindings.reviewer}: ${a.reviewFindings.findings.length} finding(s)`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "QualityGateResult":
      return a.qualityGateResult
        ? { present: true, summary: `overall=${a.qualityGateResult.overallStatus} (${a.qualityGateResult.gates.length} gate(s))`, refs: [] }
        : { present: false, summary: "", refs: [] };
    case "GovernanceDecision":
      return a.governanceDecision
        ? { present: true, summary: `decision=${a.governanceDecision.mergeDecision}`, refs: [{ label: "diffHash", value: s(a.governanceDecision.diffHash) }] }
        : { present: false, summary: "", refs: [] };
    case "RunFinalReport":
      return a.runFinalReport
        ? { present: true, summary: `state=${a.runFinalReport.finalState}`, refs: [{ label: "mergeSha", value: s(a.runFinalReport.mergeSha ?? "—") }] }
        : { present: false, summary: "", refs: [] };
    case "MutationLedger":
      return a.mutationLedgerRef
        ? { present: true, summary: "mutation ledger", refs: [{ label: "ref", value: s(a.mutationLedgerRef) }] }
        : { present: false, summary: "", refs: [] };
    case "RawEvidence":
      return a.rawEvidenceRefs && a.rawEvidenceRefs.length > 0
        ? { present: true, summary: `${a.rawEvidenceRefs.length} evidence ref(s)`, refs: a.rawEvidenceRefs.map((r) => ({ label: "ref", value: s(r) })) }
        : { present: false, summary: "", refs: [] };
    default:
      return { present: false, summary: "", refs: [] };
  }
}

export function buildArtifactExplorer(artifacts: RunArtifacts): ArtifactExplorerView {
  const views: ArtifactView[] = [];
  const absent: string[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const d = describe(kind, artifacts);
    views.push({ kind, present: d.present, summary: d.summary, refs: d.refs });
    if (!d.present) {
      absent.push(kind);
    }
  }
  return { views, absent };
}
