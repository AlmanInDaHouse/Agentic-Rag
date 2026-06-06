import {
  RagAnswerabilityPolicySchema,
  type ContextSearchResult,
  type RagAnswerabilityPolicy,
  type RagAnswerabilityResult
} from "@triforge/shared";
import {
  ragAnswerabilityPolicyService,
  type EffectiveRagAnswerabilityPolicy,
  type ResolveRagAnswerabilityPolicyInput
} from "./ragAnswerabilityPolicyService.js";

export type RagAnswerabilityEvaluationContext = ResolveRagAnswerabilityPolicyInput;

export function evaluateAnswerability(
  searchResult: { results: ContextSearchResult[] },
  context: RagAnswerabilityEvaluationContext | EffectiveRagAnswerabilityPolicy | Partial<RagAnswerabilityPolicy> = {
    mode: "lexical",
    queryType: "answerable",
    fallbackUsed: false
  }
): RagAnswerabilityResult {
  const policy = isEffectivePolicy(context)
    ? context
    : isPlainPolicy(context)
      ? {
          ...RagAnswerabilityPolicySchema.parse(context),
          effectivePolicySource: ["requestPolicy"]
        }
      : ragAnswerabilityPolicyService.resolve(context);

  if (searchResult.results.length === 0) {
    return abstain({
      reason: "no_results",
      confidence: 0,
      topScore: null,
      policy,
      supportingResultIds: [],
      warnings: ["No retrieved chunks are available"]
    });
  }

  const topScore = scoreOf(searchResult.results[0]);
  const activeResults = searchResult.results.filter(isActiveResult);
  if (activeResults.length === 0) {
    const hasDeleted = searchResult.results.some(isDeletedResult);
    return abstain({
      reason: hasDeleted ? "deleted_context_excluded" : "redacted_or_restricted",
      confidence: confidence(topScore, policy.minRequiredScore),
      topScore,
      policy,
      supportingResultIds: [],
      warnings: [
        hasDeleted
          ? "Retrieved chunks are marked deleted and cannot support an answer"
          : "Retrieved chunks are restricted or blocked by redaction policy"
      ]
    });
  }

  if (!policy.fallbackAllowed && activeResults.every((result) => result.fallbackUsed)) {
    return abstain({
      reason: "fallback_only",
      confidence: confidence(topScore, policy.minRequiredScore),
      topScore,
      policy,
      supportingResultIds: [],
      warnings: ["Only fallback retrieval results were available"]
    });
  }

  if (topScore === null || topScore < policy.minRequiredScore) {
    return abstain({
      reason: "low_score",
      confidence: confidence(topScore, policy.minRequiredScore),
      topScore,
      policy,
      supportingResultIds: [],
      warnings: ["No retrieved chunk passed the minimum relevance threshold"]
    });
  }

  const supportingResults = activeResults.filter((result) => (
    (scoreOf(result) ?? -Infinity) >= policy.minRequiredScore &&
    (policy.fallbackAllowed || !result.fallbackUsed)
  ));
  if (supportingResults.length < policy.minSupportingResults) {
    return abstain({
      reason: "insufficient_context",
      confidence: confidence(topScore, policy.minRequiredScore),
      topScore,
      policy,
      supportingResultIds: supportingResults.map((result) => result.chunk.id),
      warnings: ["Not enough retrieved chunks passed the answerability policy"]
    });
  }

  return {
    shouldAnswer: true,
    answerability: "answerable",
    reason: "sufficient_context",
    confidence: confidence(topScore, policy.minRequiredScore),
    topScore,
    minRequiredScore: policy.minRequiredScore,
    effectiveMinRequiredScore: policy.minRequiredScore,
    effectiveFallbackAllowed: policy.fallbackAllowed,
    effectivePolicySource: policy.effectivePolicySource,
    supportingResultIds: supportingResults.map((result) => result.chunk.id),
    warnings: []
  };
}

function abstain(input: {
  reason: Exclude<RagAnswerabilityResult["reason"], "sufficient_context">;
  confidence: number;
  topScore: number | null;
  policy: EffectiveRagAnswerabilityPolicy;
  supportingResultIds: string[];
  warnings: string[];
}): RagAnswerabilityResult {
  return {
    shouldAnswer: false,
    answerability: "abstain",
    reason: input.reason,
    confidence: input.confidence,
    topScore: input.topScore,
    minRequiredScore: input.policy.minRequiredScore,
    effectiveMinRequiredScore: input.policy.minRequiredScore,
    effectiveFallbackAllowed: input.policy.fallbackAllowed,
    effectivePolicySource: input.policy.effectivePolicySource,
    supportingResultIds: input.supportingResultIds,
    warnings: input.warnings
  };
}

function confidence(topScore: number | null, minRequiredScore: number): number {
  if (topScore === null) {
    return 0;
  }
  if (minRequiredScore === 0) {
    return topScore > 0 ? 1 : 0;
  }
  return Math.max(0, Math.min(1, topScore / minRequiredScore));
}

function scoreOf(result: ContextSearchResult | undefined): number | null {
  if (!result || !Number.isFinite(result.finalScore)) {
    return null;
  }
  if (result.searchMode === "lexical") {
    return result.finalScore / (result.finalScore + 1);
  }
  return Math.min(1, result.finalScore);
}

function isActiveResult(result: ContextSearchResult): boolean {
  return !isDeletedResult(result) && !isRestrictedOrBlocked(result);
}

function isDeletedResult(result: ContextSearchResult): boolean {
  return Boolean(result.source.deletedAt || result.document.deletedAt || result.chunk.deletedAt);
}

function isRestrictedOrBlocked(result: ContextSearchResult): boolean {
  return result.document.classification === "restricted" ||
    result.document.redactionStatus === "blocked" ||
    result.chunk.redactionStatus === "blocked";
}

function isEffectivePolicy(
  value: RagAnswerabilityEvaluationContext | EffectiveRagAnswerabilityPolicy | Partial<RagAnswerabilityPolicy>
): value is EffectiveRagAnswerabilityPolicy {
  return "minRequiredScore" in value && "effectivePolicySource" in value;
}

function isPlainPolicy(
  value: RagAnswerabilityEvaluationContext | EffectiveRagAnswerabilityPolicy | Partial<RagAnswerabilityPolicy>
): value is Partial<RagAnswerabilityPolicy> {
  return !("mode" in value) && !("effectivePolicySource" in value);
}
