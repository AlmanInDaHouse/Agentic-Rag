import { describe, expect, it } from "vitest";
import { deriveRunProgress } from "./runProgress.js";
import type { IntegratedRunEventDTO } from "./integratedRun.js";

function ev(seq: number, type: string, payload: Record<string, unknown> = {}, provider: string | null = null): IntegratedRunEventDTO {
  return { sequenceNumber: seq, type, provider, providerVersion: null, payload, at: "2026-06-30T00:00:00.000Z" };
}

describe("deriveRunProgress — honest stage-based progress", () => {
  it("a fresh running run sits at the start, never at a random value", () => {
    const p = deriveRunProgress("running", [ev(1, "run.started")]);
    expect(p.tone).toBe("running");
    expect(p.isTerminal).toBe(false);
    expect(p.currentStageId).toBe("inicio");
    expect(p.stages.find((s) => s.id === "inicio")?.status).toBe("active");
    expect(p.percent).toBeGreaterThan(0);
    expect(p.percent).toBeLessThan(100);
  });

  it("climbs as later pipeline events appear and never reaches 100 while running", () => {
    const events = [
      ev(1, "run.started"),
      ev(2, "provider.selected"),
      ev(3, "worktree.created"),
      ev(4, "file.changed", { path: "src/x.ts" }, "codex"),
      ev(5, "gates.completed", { status: "passed" })
    ];
    const p = deriveRunProgress("running", events);
    expect(p.currentStageId).toBe("gates");
    expect(p.stages.find((s) => s.id === "ejecucion")?.status).toBe("done");
    expect(p.stages.find((s) => s.id === "gates")?.status).toBe("active");
    expect(p.stages.find((s) => s.id === "revision")?.status).toBe("pending");
    expect(p.percent).toBeLessThan(100);
  });

  it("terminal success is 100% with every non-skipped stage done", () => {
    const events = [
      ev(1, "run.started"),
      ev(2, "provider.selected"),
      ev(3, "gates.completed", { status: "passed" }),
      ev(4, "governance.decided", { verdict: "merge" }),
      ev(5, "merge.completed", { merged: true }),
      ev(6, "cleanup.completed", { cleanedUp: true }),
      ev(7, "run.completed", {})
    ];
    const p = deriveRunProgress("completed", events);
    expect(p.percent).toBe(100);
    expect(p.tone).toBe("success");
    expect(p.stages.every((s) => s.status === "done" || s.status === "skipped")).toBe(true);
  });

  it("a failed run freezes at the furthest stage and marks it failed", () => {
    const events = [ev(1, "run.started"), ev(2, "provider.selected"), ev(3, "gates.completed"), ev(4, "run.failed", { reason: "boom" })];
    const p = deriveRunProgress("failed", events);
    expect(p.tone).toBe("danger");
    expect(p.percent).toBeLessThan(100);
    expect(p.stages.find((s) => s.id === "gates")?.status).toBe("failed");
    expect(p.stages.find((s) => s.id === "revision")?.status).toBe("pending");
  });

  it("a blocked run uses the blocked tone and does not fabricate later stages", () => {
    const p = deriveRunProgress("blocked", [ev(1, "run.started"), ev(2, "run.blocked", { reason: "no write capability" })]);
    expect(p.tone).toBe("blocked");
    expect(p.stages.find((s) => s.id === "merge")?.status).toBe("pending");
  });

  it("counts repair rounds and skips the reparación stage when none occurred", () => {
    // A run that has moved PAST the repair point (governance decided) with no repair
    // rounds marks reparación as skipped — never failed, never fabricated.
    const none = deriveRunProgress("running", [
      ev(1, "run.started"),
      ev(2, "repair.round.started", { round: 0 }, "codex"),
      ev(3, "gates.completed", { status: "passed" }),
      ev(4, "review.completed", {}, "claude"),
      ev(5, "governance.decided", { verdict: "merge" })
    ]);
    expect(none.repairRounds).toBe(0);
    expect(none.stages.find((s) => s.id === "reparacion")?.status).toBe("skipped");

    // Early on, before reaching that point, reparación is honestly still pending.
    const early = deriveRunProgress("running", [ev(1, "run.started"), ev(2, "repair.round.started", { round: 0 }, "codex")]);
    expect(early.stages.find((s) => s.id === "reparacion")?.status).toBe("pending");

    const repaired = deriveRunProgress("running", [
      ev(1, "run.started"),
      ev(2, "repair.round.started", { round: 0 }, "codex"),
      ev(3, "repair.round.started", { round: 1 }, "codex")
    ]);
    expect(repaired.repairRounds).toBe(1);
    expect(repaired.stages.find((s) => s.id === "reparacion")?.status).not.toBe("skipped");
  });
});
