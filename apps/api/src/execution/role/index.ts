/**
 * Writable-execution runtime — Owner/Reviewer enforcement (A5.4).
 */
export {
  OwnershipRegistry,
  type WorkUnit,
  type OwnershipDenyReason,
  type OwnershipResult,
  type OwnershipAuditEntry,
  type OwnershipRegistryOptions
} from "./ownership.js";

export {
  RoleEnforcer,
  type Role,
  type Actor,
  type RoleAction,
  type RoleDenyReason,
  type RoleDecision,
  type RoleEnforcerAuditEntry,
  type RoleEnforcerOptions
} from "./roleEnforcer.js";
