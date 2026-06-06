import {
  RagAnswerabilityCalibrationSchema,
  RagAnswerabilityPolicySchema,
  type RagAnswerabilityCalibration,
  type RagAnswerabilityPolicy,
  type RagQueryType,
  type RagSearchMode
} from "@triforge/shared";

export type EffectiveRagAnswerabilityPolicy = RagAnswerabilityPolicy & {
  effectivePolicySource: string[];
};

export type ResolveRagAnswerabilityPolicyInput = {
  mode: RagSearchMode;
  queryType?: RagQueryType;
  fallbackUsed?: boolean;
  overrides?: Partial<RagAnswerabilityPolicy>;
};

export const defaultRagAnswerabilityCalibration: RagAnswerabilityCalibration =
  RagAnswerabilityCalibrationSchema.parse({
    default: {
      minRequiredScore: 0.35,
      minSupportingResults: 1,
      fallbackAllowed: true,
      fallbackPenalty: 0.1
    },
    modes: {
      lexical: { minRequiredScore: 0.5 },
      mock_vector: { minRequiredScore: 0.4 },
      hybrid: { minRequiredScore: 0.35 }
    },
    queryTypes: {
      answerable: {},
      no_answer: { minRequiredScore: 0.95, fallbackAllowed: false },
      ambiguous: { minRequiredScore: 0.65 },
      redaction: { minRequiredScore: 0.3 }
    },
    fallback: {
      fallbackAllowed: true,
      fallbackPenalty: 0.1
    }
  });

export class RagAnswerabilityPolicyService {
  private readonly calibration: RagAnswerabilityCalibration;

  constructor(
    calibration: RagAnswerabilityCalibration = defaultRagAnswerabilityCalibration
  ) {
    this.calibration = RagAnswerabilityCalibrationSchema.parse(calibration);
  }

  getCalibration(): RagAnswerabilityCalibration {
    return this.calibration;
  }

  resolve(input: ResolveRagAnswerabilityPolicyInput): EffectiveRagAnswerabilityPolicy {
    const queryType = input.queryType ?? "answerable";
    const sources = ["default"];
    let effective = RagAnswerabilityPolicySchema.parse(this.calibration.default);

    const modeOverride = this.calibration.modes[input.mode];
    if (modeOverride !== undefined) {
      effective = RagAnswerabilityPolicySchema.parse({ ...effective, ...modeOverride });
      sources.push(`mode:${input.mode}`);
    }

    const queryTypeOverride = this.calibration.queryTypes[queryType];
    if (queryTypeOverride !== undefined) {
      effective = RagAnswerabilityPolicySchema.parse({ ...effective, ...queryTypeOverride });
      sources.push(`queryType:${queryType}`);
    }

    if (input.overrides !== undefined) {
      effective = RagAnswerabilityPolicySchema.parse({ ...effective, ...input.overrides });
      sources.push("requestOverride");
    }

    if (input.fallbackUsed) {
      const fallbackPenalty = this.calibration.fallback.fallbackPenalty;
      effective = RagAnswerabilityPolicySchema.parse({
        ...effective,
        fallbackAllowed: effective.fallbackAllowed && this.calibration.fallback.fallbackAllowed,
        fallbackPenalty,
        minRequiredScore: Math.min(1, effective.minRequiredScore + fallbackPenalty)
      });
      sources.push("fallback");
    }

    return {
      ...effective,
      effectivePolicySource: sources
    };
  }
}

export const ragAnswerabilityPolicyService = new RagAnswerabilityPolicyService();

export function resolveAnswerabilityPolicy(
  inputOrMode: ResolveRagAnswerabilityPolicyInput | RagSearchMode,
  overrides?: Partial<RagAnswerabilityPolicy>
): EffectiveRagAnswerabilityPolicy {
  if (typeof inputOrMode === "string") {
    return ragAnswerabilityPolicyService.resolve({
      mode: inputOrMode,
      queryType: "answerable",
      fallbackUsed: false,
      overrides
    });
  }
  return ragAnswerabilityPolicyService.resolve(inputOrMode);
}
