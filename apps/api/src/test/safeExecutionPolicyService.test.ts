import { describe, expect, it } from "vitest";
import { SafeExecutionPolicyService } from "../services/safeExecutionPolicyService.js";

describe("SafeExecutionPolicyService", () => {
  const service = new SafeExecutionPolicyService();

  it("classifies read and planning actions as low risk without approval", () => {
    expect(service.classifyAction("read_context")).toMatchObject({
      riskLevel: "low",
      requiresApproval: false,
      blockedByDefault: false
    });
    expect(service.requiresApproval("plan")).toBe(false);
  });

  it("requires approval for high risk actions", () => {
    expect(service.classifyAction("modify_code")).toMatchObject({
      riskLevel: "high",
      requiresApproval: true,
      blockedByDefault: false
    });
    expect(service.requiresApproval("run_command")).toBe(true);
    expect(service.requiresApproval("external_adapter_call")).toBe(true);
  });

  it("blocks critical actions by default", () => {
    expect(service.classifyAction("delete_file")).toMatchObject({
      riskLevel: "critical",
      requiresApproval: false,
      blockedByDefault: true
    });
    expect(service.isBlocked("delete_file")).toBe(true);
  });

  it("blocks dependency installs without review", () => {
    expect(service.classifyAction("install_dependency", { packageName: "left-pad" })).toMatchObject({
      riskLevel: "critical",
      blockedByDefault: true
    });
    expect(
      service.classifyAction("install_dependency", {
        packageName: "zod",
        dependencyReviewed: true
      })
    ).toMatchObject({
      riskLevel: "high",
      requiresApproval: true,
      blockedByDefault: false
    });
  });

  it("blocks destructive migrations and unapproved network requests", () => {
    expect(service.isBlocked("db_migration", { destructive: true })).toBe(true);
    expect(service.isBlocked("network_request", { url: "https://example.com" })).toBe(true);
    expect(service.requiresApproval("network_request", { adapterApproved: true })).toBe(true);
  });

  it("blocks dangerous git operations", () => {
    expect(service.isBlocked("git_operation", { operation: "force_push" })).toBe(true);
    expect(service.isBlocked("git_operation", { operation: "branch", branch: "main" })).toBe(true);
    expect(service.requiresApproval("git_operation", { operation: "status" })).toBe(true);
  });
});
