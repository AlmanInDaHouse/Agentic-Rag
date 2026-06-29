/**
 * Role enforcer (A5.4) — the gate that binds every owner/reviewer action to a role
 * and the single owner lease, composing the A5.2 allowed-path policy and the A5.3
 * command policy behind it (mandate §A5.4; threat-model T-INT-14/15, SAT-A5-8).
 *
 * Authority model:
 *  - **Owner** (must hold the lease): may READ, WRITE within `writePaths`, and run any
 *    command its command policy permits.
 *  - **Reviewer** (no lease): may READ and run ONLY `read_only` commands. It may NOT
 *    write, run a non-read-only command, or otherwise mutate — a reviewer write/exec
 *    attempt is denied and audited. A reviewer never becomes the owner implicitly;
 *    ownership only moves through an explicit, audited `OwnershipRegistry.reassign`.
 *
 * Every decision carries the actor, role and unit (role binding for events/artifacts).
 */

import type { PathDecision, PathPolicyEngine } from "../path/index.js";
import type { CommandCategory, CommandDecision, CommandPolicy, CommandSpec } from "../command/index.js";
import type { OwnershipRegistry, WorkUnit } from "./ownership.js";

export type Role = "owner" | "reviewer";

export interface Actor {
  id: string;
  role: Role;
}

export type RoleAction = "read" | "write" | "command";

export type RoleDenyReason =
  | "reviewer_cannot_write"
  | "reviewer_command_not_read_only"
  | "not_owner"
  | "path_denied"
  | "command_denied";

export interface RoleDecision {
  allowed: boolean;
  action: RoleAction;
  actorId: string;
  role: Role;
  unit: WorkUnit;
  denyReason?: RoleDenyReason;
  /** The category, when the action is a command. */
  category?: CommandCategory;
  /** The underlying path/command decision, when one was consulted. */
  pathDecision?: PathDecision;
  commandDecision?: CommandDecision;
  reason: string;
}

export interface RoleEnforcerAuditEntry {
  timestamp: string;
  action: RoleAction;
  actorId: string;
  role: Role;
  unit: WorkUnit;
  allowed: boolean;
  denyReason?: RoleDenyReason;
  detail: string;
}

export interface RoleEnforcerOptions {
  unit: WorkUnit;
  ownership: OwnershipRegistry;
  pathPolicy: PathPolicyEngine;
  commandPolicy: CommandPolicy;
  clock: { iso(): string };
  onAudit?: (entry: RoleEnforcerAuditEntry) => void;
}

export class RoleEnforcer {
  private readonly unit: WorkUnit;
  private readonly ownership: OwnershipRegistry;
  private readonly pathPolicy: PathPolicyEngine;
  private readonly commandPolicy: CommandPolicy;
  private readonly clock: { iso(): string };
  private readonly onAudit?: (entry: RoleEnforcerAuditEntry) => void;

  constructor(options: RoleEnforcerOptions) {
    this.unit = options.unit;
    this.ownership = options.ownership;
    this.pathPolicy = options.pathPolicy;
    this.commandPolicy = options.commandPolicy;
    this.clock = options.clock;
    this.onAudit = options.onAudit;
  }

  /** READ is permitted for both roles, subject to the path policy. */
  authorizeRead(actor: Actor, relPath: string): RoleDecision {
    const pathDecision = this.pathPolicy.checkRead(relPath);
    if (!pathDecision.allowed) {
      return this.record({
        allowed: false,
        action: "read",
        actor,
        denyReason: "path_denied",
        pathDecision,
        reason: `read denied by path policy: ${pathDecision.reason}`
      });
    }
    return this.record({ allowed: true, action: "read", actor, pathDecision, reason: "read allowed" });
  }

  /** WRITE is owner-only (must hold the lease) and subject to the path policy. */
  authorizeWrite(actor: Actor, relPath: string): RoleDecision {
    if (actor.role !== "owner") {
      return this.record({
        allowed: false,
        action: "write",
        actor,
        denyReason: "reviewer_cannot_write",
        reason: "a reviewer may not write"
      });
    }
    if (this.ownership.current(this.unit) !== actor.id) {
      return this.record({
        allowed: false,
        action: "write",
        actor,
        denyReason: "not_owner",
        reason: "actor does not hold the owner lease"
      });
    }
    const pathDecision = this.pathPolicy.checkWrite(relPath);
    if (!pathDecision.allowed) {
      return this.record({
        allowed: false,
        action: "write",
        actor,
        denyReason: "path_denied",
        pathDecision,
        reason: `write denied by path policy: ${pathDecision.reason}`
      });
    }
    return this.record({ allowed: true, action: "write", actor, pathDecision, reason: "write allowed" });
  }

  /**
   * COMMAND: the owner (holding the lease) may run any command its command policy
   * permits; the reviewer may run ONLY `read_only` commands.
   */
  authorizeCommand(actor: Actor, command: CommandSpec, cwd: string): RoleDecision {
    const commandDecision = this.commandPolicy.check(command, cwd);
    const category = commandDecision.category;

    if (actor.role === "reviewer") {
      if (category !== "read_only") {
        return this.record({
          allowed: false,
          action: "command",
          actor,
          category,
          commandDecision,
          denyReason: "reviewer_command_not_read_only",
          reason: `a reviewer may run only read_only commands (got ${category})`
        });
      }
      if (!commandDecision.allowed) {
        return this.record({
          allowed: false,
          action: "command",
          actor,
          category,
          commandDecision,
          denyReason: "command_denied",
          reason: `command denied by command policy: ${commandDecision.denyReason}`
        });
      }
      return this.record({ allowed: true, action: "command", actor, category, commandDecision, reason: "reviewer read_only command allowed" });
    }

    // owner
    if (this.ownership.current(this.unit) !== actor.id) {
      return this.record({
        allowed: false,
        action: "command",
        actor,
        category,
        commandDecision,
        denyReason: "not_owner",
        reason: "actor does not hold the owner lease"
      });
    }
    if (!commandDecision.allowed) {
      return this.record({
        allowed: false,
        action: "command",
        actor,
        category,
        commandDecision,
        denyReason: "command_denied",
        reason: `command denied by command policy: ${commandDecision.denyReason}`
      });
    }
    return this.record({ allowed: true, action: "command", actor, category, commandDecision, reason: "owner command allowed" });
  }

  private record(input: {
    allowed: boolean;
    action: RoleAction;
    actor: Actor;
    reason: string;
    denyReason?: RoleDenyReason;
    category?: CommandCategory;
    pathDecision?: PathDecision;
    commandDecision?: CommandDecision;
  }): RoleDecision {
    const decision: RoleDecision = {
      allowed: input.allowed,
      action: input.action,
      actorId: input.actor.id,
      role: input.actor.role,
      unit: this.unit,
      denyReason: input.denyReason,
      category: input.category,
      pathDecision: input.pathDecision,
      commandDecision: input.commandDecision,
      reason: input.reason
    };
    if (this.onAudit !== undefined) {
      try {
        this.onAudit({
          timestamp: this.clock.iso(),
          action: decision.action,
          actorId: decision.actorId,
          role: decision.role,
          unit: decision.unit,
          allowed: decision.allowed,
          denyReason: decision.denyReason,
          detail: decision.reason
        });
      } catch {
        /* an audit sink must never break enforcement */
      }
    }
    return decision;
  }
}
