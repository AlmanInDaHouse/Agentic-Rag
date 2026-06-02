import type { ActionType, ExecutionPolicy, RiskLevel } from "@triforge/shared";

const safeActions = new Set<ActionType>([
  "read_context",
  "plan",
  "debate",
  "judge"
]);

const approvalRequiredActions = new Set<ActionType>([
  "modify_code",
  "run_command",
  "external_adapter_call"
]);

export class SafeExecutionPolicyService {
  classifyAction(actionType: ActionType, payload: Record<string, unknown> = {}): ExecutionPolicy {
    if (safeActions.has(actionType)) {
      return policy(actionType, "low", false, false, "Mock runtime context action.");
    }

    if (actionType === "write_artifact") {
      return policy(actionType, "medium", false, false, "Mock artifact write without code changes.");
    }

    if (actionType === "delete_file") {
      return policy(actionType, "critical", false, true, "File deletion is blocked by default.");
    }

    if (actionType === "install_dependency") {
      if (payload.dependencyReviewed !== true) {
        return policy(
          actionType,
          "critical",
          false,
          true,
          "Dependency installation without dependency review is blocked."
        );
      }
      return policy(actionType, "high", true, false, "Dependency installation requires approval.");
    }

    if (actionType === "db_migration") {
      if (payload.destructive === true) {
        return policy(actionType, "critical", false, true, "Destructive migrations are blocked.");
      }
      return policy(actionType, "high", true, false, "Database migrations require approval.");
    }

    if (actionType === "network_request") {
      if (payload.adapterApproved !== true) {
        return policy(
          actionType,
          "critical",
          false,
          true,
          "External network calls without an approved adapter are blocked."
        );
      }
      return policy(actionType, "high", true, false, "Approved adapter network calls require approval.");
    }

    if (actionType === "git_operation") {
      if (isBlockedGitOperation(payload)) {
        return policy(actionType, "critical", false, true, "Dangerous git operations are blocked.");
      }
      return policy(actionType, "high", true, false, "Git operations require approval.");
    }

    if (approvalRequiredActions.has(actionType)) {
      return policy(actionType, "high", true, false, "High risk actions require approval.");
    }

    return policy(actionType, "medium", true, false, "Unclassified action requires approval.");
  }

  requiresApproval(actionType: ActionType, payload: Record<string, unknown> = {}): boolean {
    return this.classifyAction(actionType, payload).requiresApproval;
  }

  isBlocked(actionType: ActionType, payload: Record<string, unknown> = {}): boolean {
    return this.classifyAction(actionType, payload).blockedByDefault;
  }
}

function isBlockedGitOperation(payload: Record<string, unknown>): boolean {
  const operation = String(payload.operation ?? "").toLowerCase();
  const branch = String(payload.branch ?? payload.targetBranch ?? "").toLowerCase();
  return (
    payload.force === true ||
    operation.includes("force") ||
    operation === "delete_branch" ||
    operation === "delete-branch" ||
    branch === "main"
  );
}

function policy(
  actionType: ActionType,
  riskLevel: RiskLevel,
  requiresApproval: boolean,
  blockedByDefault: boolean,
  reason: string
): ExecutionPolicy {
  return {
    actionType,
    riskLevel,
    requiresApproval,
    blockedByDefault,
    reason
  };
}
