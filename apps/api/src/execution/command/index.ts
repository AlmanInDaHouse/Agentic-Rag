/**
 * Writable-execution runtime — Safe Command Policy + Process Supervision (A5.3).
 */
export {
  CommandPolicy,
  classifyCommand,
  DEFAULT_ALLOWED_CATEGORIES,
  type CommandCategory,
  type CommandSpec,
  type CommandClassification,
  type CommandDecision,
  type CommandDenyReason,
  type CommandPolicyConfig
} from "./commandPolicy.js";

export {
  CommandSupervisor,
  type SupervisedCommandResult,
  type SupervisedRun,
  type CommandSupervisorAuditEntry,
  type CommandSupervisorOptions
} from "./commandSupervisor.js";
