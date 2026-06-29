/**
 * Ownership registry (A5.4) — enforces that, within a unit of work (run+task),
 * EXACTLY ONE actor holds the writable owner lease at a time (Charter §4.7 "one
 * writable owner"; mandate §A5.4; threat-model T-INT-14/15, SAT-A5-8).
 *
 * The lease is the single source of truth for "who may write". A second actor
 * cannot acquire it while it is held (two-owner race → blocked). Ownership only
 * changes through an EXPLICIT, audited `reassign` — never implicitly — so a reviewer
 * can never silently become the owner.
 */

export interface WorkUnit {
  runId: string;
  taskId: string;
}

export type OwnershipDenyReason = "already_owned" | "not_current_owner" | "no_owner";

export interface OwnershipResult {
  ok: boolean;
  unit: WorkUnit;
  ownerId: string | null;
  reason?: OwnershipDenyReason;
  detail?: string;
}

export interface OwnershipAuditEntry {
  timestamp: string;
  action: "acquire" | "reassign" | "release";
  unit: WorkUnit;
  actorId: string;
  fromOwnerId?: string | null;
  toOwnerId?: string | null;
  outcome: "ok" | "denied";
  detail?: string;
}

export interface OwnershipRegistryOptions {
  clock: { iso(): string };
  onAudit?: (entry: OwnershipAuditEntry) => void;
}

function unitKey(unit: WorkUnit): string {
  return `${unit.runId}/${unit.taskId}`;
}

export class OwnershipRegistry {
  private readonly leases = new Map<string, string>(); // unitKey -> ownerId
  private readonly clock: { iso(): string };
  private readonly onAudit?: (entry: OwnershipAuditEntry) => void;

  constructor(options: OwnershipRegistryOptions) {
    this.clock = options.clock;
    this.onAudit = options.onAudit;
  }

  /** Current owner of a unit, or null. */
  current(unit: WorkUnit): string | null {
    return this.leases.get(unitKey(unit)) ?? null;
  }

  /**
   * Acquire the owner lease. Granted only if unowned OR already held by the same
   * actor (idempotent re-acquire). A different actor is refused (two-owner block).
   */
  acquire(unit: WorkUnit, actorId: string): OwnershipResult {
    const key = unitKey(unit);
    const held = this.leases.get(key);
    if (held !== undefined && held !== actorId) {
      this.audit("acquire", unit, actorId, "denied", held, held, "unit already owned by another actor");
      return { ok: false, unit, ownerId: held, reason: "already_owned", detail: "owned by another actor" };
    }
    this.leases.set(key, actorId);
    this.audit("acquire", unit, actorId, "ok", held ?? null, actorId);
    return { ok: true, unit, ownerId: actorId };
  }

  /**
   * Explicitly reassign ownership. Only the current owner may hand it off, and only
   * when they actually hold it. Always audited — this is the ONLY path by which the
   * owner changes to a different actor.
   */
  reassign(unit: WorkUnit, fromActorId: string, toActorId: string, reason: string): OwnershipResult {
    const key = unitKey(unit);
    const held = this.leases.get(key);
    if (held === undefined) {
      this.audit("reassign", unit, fromActorId, "denied", null, toActorId, "no current owner");
      return { ok: false, unit, ownerId: null, reason: "no_owner" };
    }
    if (held !== fromActorId) {
      this.audit("reassign", unit, fromActorId, "denied", held, toActorId, "reassign by non-owner");
      return { ok: false, unit, ownerId: held, reason: "not_current_owner" };
    }
    this.leases.set(key, toActorId);
    this.audit("reassign", unit, fromActorId, "ok", held, toActorId, reason);
    return { ok: true, unit, ownerId: toActorId };
  }

  /** Release the lease (only the current owner). Idempotent for a non-owner. */
  release(unit: WorkUnit, actorId: string): OwnershipResult {
    const key = unitKey(unit);
    const held = this.leases.get(key);
    if (held === undefined) {
      return { ok: true, unit, ownerId: null };
    }
    if (held !== actorId) {
      this.audit("release", unit, actorId, "denied", held, held, "release by non-owner");
      return { ok: false, unit, ownerId: held, reason: "not_current_owner" };
    }
    this.leases.delete(key);
    this.audit("release", unit, actorId, "ok", held, null);
    return { ok: true, unit, ownerId: null };
  }

  private audit(
    action: OwnershipAuditEntry["action"],
    unit: WorkUnit,
    actorId: string,
    outcome: OwnershipAuditEntry["outcome"],
    fromOwnerId: string | null,
    toOwnerId: string | null,
    detail?: string
  ): void {
    if (this.onAudit === undefined) {
      return;
    }
    try {
      this.onAudit({
        timestamp: this.clock.iso(),
        action,
        unit,
        actorId,
        fromOwnerId,
        toOwnerId,
        outcome,
        detail
      });
    } catch {
      /* an audit sink must never break ownership */
    }
  }
}
