/**
 * Strategy resolution (A4.5) — authority-order conflict resolution.
 *
 * When two providers disagree (independent plans in Full Debate, or a plan vs a
 * critique in Pair), TriForge resolves the conflict by an EXPLICIT authority order
 * — NEVER by agent majority or by the highest-confidence proposal (mandate §A4.5):
 *
 *   1. safety invariants  2. spec            3. acceptance criteria
 *   4. code evidence      5. tests           6. ADRs
 *   7. threat model       8. risk policy     9. governance decision
 *
 * The first authority source (highest priority) that has a ruling for one of the
 * candidate options decides the outcome. Confidence and the number of agents
 * favouring an option are recorded but are NEVER the tiebreaker. The result is a
 * validated `StrategyDecision` artifact that names the deciding authority source.
 *
 * Pure and deterministic: no clock, no randomness, no I/O.
 */

import {
  StrategyDecisionSchema,
  type AuthoritySource,
  type ProviderId,
  type StrategyDecision
} from "@triforge/shared";

/**
 * The canonical authority ranking (highest priority first). Matches the order of
 * `AuthoritySourceSchema` in the A1 artifact contracts and mandate §A4.5.
 */
export const AUTHORITY_ORDER: readonly AuthoritySource[] = [
  "safety_invariants",
  "spec",
  "acceptance_criteria",
  "code_evidence",
  "tests",
  "adrs",
  "threat_model",
  "risk_policy",
  "governance_decision"
] as const;

/** A single competing option (a plan or a position) entering resolution. */
export interface StrategyCandidate {
  /** Stable id used by the authority evidence to reference this option. */
  id: string;
  /** The provider that proposed it (recorded for audit, never a tiebreaker). */
  proposedBy: ProviderId;
  /** Human-readable option statement (becomes `chosenOption` / `consideredOptions`). */
  summary: string;
  /**
   * Informational confidence (0..1). Recorded only; the resolver NEVER decides by
   * confidence — that would be a majority/popularity rule, which §A4.5 forbids.
   */
  confidence: number;
}

/** What a single authority source rules: which candidate it backs, and why. */
export interface AuthorityRuling {
  /** The candidate id this authority source backs. */
  supports: string;
  /** Evidence-based rationale for the ruling. */
  rationale: string;
}

/**
 * Evidence keyed by authority source. A source with no entry (or `null`) is silent
 * on this conflict and is skipped. Resolution walks `AUTHORITY_ORDER` and the FIRST
 * source whose `supports` matches a candidate decides.
 */
export type AuthorityEvidence = Partial<Record<AuthoritySource, AuthorityRuling | null>>;

export interface StrategyResolutionInput {
  candidates: StrategyCandidate[];
  evidence: AuthorityEvidence;
  /** Override the authority ranking (defaults to the canonical `AUTHORITY_ORDER`). */
  authorityOrder?: readonly AuthoritySource[];
}

export interface StrategyResolution {
  /** The validated A1 artifact. */
  decision: StrategyDecision;
  /** The authority source that actually resolved the conflict. */
  decidingAuthoritySource: AuthoritySource;
  /** The candidate the authority backed. */
  chosen: StrategyCandidate;
  /**
   * True when the chosen option is NOT the highest-confidence / most-favoured one —
   * concrete proof the decision was authority-driven, not majority-driven.
   */
  overrodeHighestConfidence: boolean;
  /**
   * True when the deciding ruling was a SYNTHESIZED DEFAULT rather than real authority
   * evidence (e.g. a mode injected a fallback `spec` grounding because the caller
   * supplied none). Keeps the audit trail honest: a defaulted resolution did not have a
   * real authority source rule on the conflict. `resolveStrategy` itself never defaults
   * (always false); callers that synthesize evidence set it.
   */
  defaulted: boolean;
}

/** Thrown when no authority source can decide — agent majority is never a fallback. */
export class UnresolvedStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnresolvedStrategyError";
  }
}

/**
 * Resolve competing options by authority order. Returns the winning option, the
 * deciding authority source and the validated `StrategyDecision` artifact.
 *
 * @throws UnresolvedStrategyError when no authority source rules for a candidate
 *   (the resolver refuses to fall back to majority/confidence).
 */
export function resolveStrategy(input: StrategyResolutionInput): StrategyResolution {
  const { candidates, evidence } = input;
  if (candidates.length === 0) {
    throw new UnresolvedStrategyError("strategy resolution requires at least one candidate");
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) {
      throw new UnresolvedStrategyError(`duplicate candidate id "${candidate.id}"`);
    }
    ids.add(candidate.id);
  }

  const order = input.authorityOrder ?? AUTHORITY_ORDER;

  let decidingAuthoritySource: AuthoritySource | null = null;
  let ruling: AuthorityRuling | null = null;
  for (const source of order) {
    const candidateRuling = evidence[source];
    if (candidateRuling && ids.has(candidateRuling.supports)) {
      decidingAuthoritySource = source;
      ruling = candidateRuling;
      break;
    }
  }

  if (decidingAuthoritySource === null || ruling === null) {
    throw new UnresolvedStrategyError(
      "no authority source resolved the conflict; agent majority/confidence is never a tiebreaker"
    );
  }

  const chosen = candidates.find((candidate) => candidate.id === ruling.supports);
  if (!chosen) {
    // Unreachable: `ids.has(ruling.supports)` was checked above.
    throw new UnresolvedStrategyError(`deciding ruling referenced unknown candidate "${ruling.supports}"`);
  }

  // The highest-confidence candidate (deterministic tiebreak by input order). Used
  // ONLY to report whether authority overrode the popular/confident choice.
  const highestConfidence = candidates.reduce((best, candidate) =>
    candidate.confidence > best.confidence ? candidate : best
  );

  const decision = StrategyDecisionSchema.parse({
    chosenOption: chosen.summary,
    consideredOptions: candidates.map((candidate) => candidate.summary),
    authoritySourceRanking: [...order],
    decidingAuthoritySource,
    rationale:
      `${ruling.rationale} ` +
      `[resolved by authority source "${decidingAuthoritySource}" proposed by ${chosen.proposedBy}; ` +
      `not decided by agent majority or confidence]`
  });

  return {
    decision,
    decidingAuthoritySource,
    chosen,
    overrodeHighestConfidence: chosen.id !== highestConfidence.id,
    defaulted: false
  };
}
