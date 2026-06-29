import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { PathPolicyEngine } from "../execution/path/index.js";
import { CommandPolicy } from "../execution/command/index.js";
import {
  OwnershipRegistry,
  RoleEnforcer,
  type Actor,
  type OwnershipAuditEntry,
  type RoleEnforcerAuditEntry,
  type WorkUnit
} from "../execution/role/index.js";

const tempDirs: string[] = [];
function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-rolews-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const UNIT: WorkUnit = { runId: "run1", taskId: "taskA" };
const OWNER: Actor = { id: "codex", role: "owner" };
const REVIEWER: Actor = { id: "claude", role: "reviewer" };

interface Harness {
  enforcer: RoleEnforcer;
  ownership: OwnershipRegistry;
  roleAudit: RoleEnforcerAuditEntry[];
  ws: string;
}

function makeHarness(): Harness {
  const ws = makeWorkspace();
  const roleAudit: RoleEnforcerAuditEntry[] = [];
  const ownership = new OwnershipRegistry({ clock: new ManualClock() });
  const enforcer = new RoleEnforcer({
    unit: UNIT,
    ownership,
    pathPolicy: new PathPolicyEngine({
      workspaceRoot: ws,
      policy: { readPaths: ["."], writePaths: ["src"], blockedPaths: [], maxFilesChanged: 50 },
      clock: new ManualClock()
    }),
    commandPolicy: new CommandPolicy({ workspaceRoot: ws }),
    clock: new ManualClock(),
    onAudit: (e) => roleAudit.push(e)
  });
  return { enforcer, ownership, roleAudit, ws };
}

describe("OwnershipRegistry — single owner + explicit reassignment", () => {
  it("grants a single owner and blocks a two-owner race", () => {
    const audit: OwnershipAuditEntry[] = [];
    const reg = new OwnershipRegistry({ clock: new ManualClock(), onAudit: (e) => audit.push(e) });
    expect(reg.acquire(UNIT, "codex").ok).toBe(true);
    expect(reg.current(UNIT)).toBe("codex");
    // same actor re-acquires (idempotent)
    expect(reg.acquire(UNIT, "codex").ok).toBe(true);
    // a different actor is blocked
    const blocked = reg.acquire(UNIT, "claude");
    expect(blocked).toMatchObject({ ok: false, reason: "already_owned", ownerId: "codex" });
    expect(audit.some((e) => e.action === "acquire" && e.outcome === "denied")).toBe(true);
  });

  it("reassigns ownership only explicitly, by the current owner, audited", () => {
    const audit: OwnershipAuditEntry[] = [];
    const reg = new OwnershipRegistry({ clock: new ManualClock(), onAudit: (e) => audit.push(e) });
    reg.acquire(UNIT, "codex");
    // a non-owner cannot reassign
    expect(reg.reassign(UNIT, "claude", "claude", "steal")).toMatchObject({
      ok: false,
      reason: "not_current_owner"
    });
    // the owner reassigns explicitly
    expect(reg.reassign(UNIT, "codex", "claude", "handoff")).toMatchObject({ ok: true, ownerId: "claude" });
    expect(reg.current(UNIT)).toBe("claude");
    expect(audit.some((e) => e.action === "reassign" && e.outcome === "ok" && e.detail === "handoff")).toBe(true);
  });

  it("release is owner-only and idempotent", () => {
    const reg = new OwnershipRegistry({ clock: new ManualClock() });
    reg.acquire(UNIT, "codex");
    expect(reg.release(UNIT, "claude")).toMatchObject({ ok: false, reason: "not_current_owner" });
    expect(reg.release(UNIT, "codex").ok).toBe(true);
    expect(reg.current(UNIT)).toBeNull();
    expect(reg.release(UNIT, "codex").ok).toBe(true); // idempotent
  });
});

describe("RoleEnforcer — owner writes, reviewer is read-only", () => {
  it("lets the owner write within writePaths and denies outside", () => {
    const { enforcer, ownership } = makeHarness();
    ownership.acquire(UNIT, "codex");
    expect(enforcer.authorizeWrite(OWNER, "src/app.ts").allowed).toBe(true);
    expect(enforcer.authorizeWrite(OWNER, "README.md")).toMatchObject({
      allowed: false,
      denyReason: "path_denied"
    });
  });

  it("denies a reviewer write attempt (role), recorded with role binding", () => {
    const { enforcer, ownership, roleAudit } = makeHarness();
    ownership.acquire(UNIT, "codex");
    const d = enforcer.authorizeWrite(REVIEWER, "src/app.ts");
    expect(d).toMatchObject({ allowed: false, denyReason: "reviewer_cannot_write", role: "reviewer", actorId: "claude" });
    expect(roleAudit.at(-1)).toMatchObject({ allowed: false, denyReason: "reviewer_cannot_write", role: "reviewer" });
  });

  it("denies an owner-role actor that does not hold the lease (not_owner)", () => {
    const { enforcer } = makeHarness();
    // no acquire
    expect(enforcer.authorizeWrite(OWNER, "src/app.ts")).toMatchObject({
      allowed: false,
      denyReason: "not_owner"
    });
  });

  it("allows reads for both roles", () => {
    const { enforcer, ownership } = makeHarness();
    ownership.acquire(UNIT, "codex");
    expect(enforcer.authorizeRead(OWNER, "src/app.ts").allowed).toBe(true);
    expect(enforcer.authorizeRead(REVIEWER, "src/app.ts").allowed).toBe(true);
  });
});

describe("RoleEnforcer — command authority by role", () => {
  it("lets the owner run an allowed command and denies a destructive one", () => {
    const { enforcer, ownership, ws } = makeHarness();
    ownership.acquire(UNIT, "codex");
    expect(enforcer.authorizeCommand(OWNER, { bin: "tsc", args: ["-p", "."] }, ws).allowed).toBe(true);
    expect(enforcer.authorizeCommand(OWNER, { bin: "rm", args: ["-rf", "x"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "command_denied",
      category: "destructive"
    });
  });

  it("lets the reviewer run a read_only command but denies anything else", () => {
    const { enforcer, ownership, ws } = makeHarness();
    ownership.acquire(UNIT, "codex");
    expect(enforcer.authorizeCommand(REVIEWER, { bin: "cat", args: ["f"] }, ws).allowed).toBe(true);
    expect(enforcer.authorizeCommand(REVIEWER, { bin: "mkdir", args: ["x"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "reviewer_command_not_read_only",
      category: "write_local"
    });
    expect(enforcer.authorizeCommand(REVIEWER, { bin: "tsc", args: [] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "reviewer_command_not_read_only"
    });
  });

  it("denies an owner-role command when the actor does not hold the lease", () => {
    const { enforcer, ws } = makeHarness();
    expect(enforcer.authorizeCommand(OWNER, { bin: "cat", args: ["f"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "not_owner"
    });
  });
});
