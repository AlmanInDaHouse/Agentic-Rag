/**
 * A8.2 Task Composer view-model + validator (mandate §10 A8.2).
 *
 * Validates the composed task on the FRONTEND against the SAME contracts the backend
 * enforces — the A1 `TaskSpecificationSchema` from `@triforge/shared` and a Zod
 * allowed-path-policy schema mirroring the A5.2 shape (`readPaths`/`writePaths`/
 * `blockedPaths`/`maxFilesChanged`). The frontend never applies a looser rule than the
 * backend; it surfaces typed field errors and normalizes path lists. The backend
 * re-validates authoritatively. Pure + deterministic.
 */

import { z } from "zod";
import { RiskLevelSchema, TaskSpecificationSchema, type TaskSpecification } from "@triforge/shared";

export const CollaborationModeSchema = z.enum(["specialist", "pair", "debate"]);
export type CollaborationMode = z.infer<typeof CollaborationModeSchema>;

/** Mirrors the A5.2 AllowedPathPolicy contract (which lives in apps/api). */
export const AllowedPathPolicySchema = z
  .object({
    readPaths: z.array(z.string()).default([]),
    writePaths: z.array(z.string()).default([]),
    blockedPaths: z.array(z.string()).default([]),
    maxFilesChanged: z.number().int().min(1)
  })
  .strict();
export type AllowedPathPolicy = z.infer<typeof AllowedPathPolicySchema>;

export interface TaskComposerInput {
  objective: string;
  scope: string;
  nonGoals: string;
  acceptanceCriteria: string;
  risk: string;
  mode: string;
  budgetUnits: string;
  readPaths: string;
  writePaths: string;
  blockedPaths: string;
  maxFilesChanged: string;
  timeoutMs: string;
  repairRounds: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ComposedTask {
  spec: TaskSpecification;
  policy: AllowedPathPolicy;
  risk: z.infer<typeof RiskLevelSchema>;
  mode: CollaborationMode;
  budgetUnits: number;
  timeoutMs: number;
  repairRounds: number;
}

export interface ComposerResult {
  valid: boolean;
  errors: FieldError[];
  task?: ComposedTask;
}

/** Split a textarea value into trimmed, non-empty lines (path/list normalization). */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function intField(value: string, field: string, min: number, errors: FieldError[]): number | null {
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < min) {
    errors.push({ field, message: `must be an integer ≥ ${min}` });
    return null;
  }
  return n;
}

/** Validate the composer input; returns typed field errors and, when valid, the task. */
export function validateTaskComposer(input: TaskComposerInput): ComposerResult {
  const errors: FieldError[] = [];

  const specRaw = {
    objective: input.objective.trim(),
    scope: lines(input.scope),
    nonGoals: lines(input.nonGoals),
    invariants: [],
    acceptanceCriteria: lines(input.acceptanceCriteria),
    failureModes: [],
    relationToPriorDecisions: []
  };
  const specParsed = TaskSpecificationSchema.safeParse(specRaw);
  if (!specParsed.success) {
    for (const issue of specParsed.error.issues) {
      errors.push({ field: String(issue.path[0] ?? "objective"), message: issue.message });
    }
  }

  const riskParsed = RiskLevelSchema.safeParse(input.risk.trim());
  if (!riskParsed.success) {
    errors.push({ field: "risk", message: "risk must be low | medium | high | critical" });
  }
  const modeParsed = CollaborationModeSchema.safeParse(input.mode.trim());
  if (!modeParsed.success) {
    errors.push({ field: "mode", message: "mode must be specialist | pair | debate" });
  }

  const budgetUnits = intField(input.budgetUnits, "budgetUnits", 0, errors);
  const maxFilesChanged = intField(input.maxFilesChanged, "maxFilesChanged", 1, errors);
  const timeoutMs = intField(input.timeoutMs, "timeoutMs", 0, errors);
  const repairRounds = intField(input.repairRounds, "repairRounds", 0, errors);

  const policyParsed =
    maxFilesChanged !== null
      ? AllowedPathPolicySchema.safeParse({
          readPaths: lines(input.readPaths),
          writePaths: lines(input.writePaths),
          blockedPaths: lines(input.blockedPaths),
          maxFilesChanged
        })
      : null;
  if (policyParsed && !policyParsed.success) {
    errors.push({ field: "paths", message: "invalid allowed-path policy" });
  }

  if (
    errors.length > 0 ||
    !specParsed.success ||
    !riskParsed.success ||
    !modeParsed.success ||
    !policyParsed ||
    !policyParsed.success ||
    budgetUnits === null ||
    timeoutMs === null ||
    repairRounds === null
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    task: {
      spec: specParsed.data,
      policy: policyParsed.data,
      risk: riskParsed.data,
      mode: modeParsed.data,
      budgetUnits,
      timeoutMs,
      repairRounds
    }
  };
}
