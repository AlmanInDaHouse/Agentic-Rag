/**
 * A9.5 Observability — run reconstruction (mandate §11 A9.5).
 */

import { describe, expect, it } from "vitest";
import { reconstructRun, type RunObservabilityInput } from "../execution/observability/runReconstruction.js";

function input(over: Partial<RunObservabilityInput> = {}): RunObservabilityInput {
  return {
    ledger: [
      { file: "src/a.ts", owner: "codex", tool: "codex-cli", reason: "add feature", sequence: 0 },
      { file: "src/b.ts", owner: "codex", tool: "codex-cli", reason: "wire it", sequence: 1 }
    ],
    events: [
      { sequenceNumber: 0, type: "run.started" },
      { sequenceNumber: 1, type: "file.changed" },
      { sequenceNumber: 2, type: "run.completed" }
    ],
    recordedDiffHash: "diff-1",
    governanceDiffHash: "diff-1",
    worktreeChangedFiles: ["src/a.ts", "src/b.ts"],
    ...over
  };
}

describe("reconstructRun — a run is reconstructable, with no hidden state", () => {
  it("reports a fully observable run as reconstructable", () => {
    const r = reconstructRun(input());
    expect(r.fullyAttributed).toBe(true);
    expect(r.unattributedMutations).toEqual([]);
    expect(r.eventSequenceGapless).toBe(true);
    expect(r.hasLifecycleBookends).toBe(true);
    expect(r.diffReconciles).toBe(true);
    expect(r.reconstructable).toBe(true);
  });

  it("detects a HIDDEN-STATE mutation (a worktree change with no ledger entry)", () => {
    const r = reconstructRun(input({ worktreeChangedFiles: ["src/a.ts", "src/b.ts", "src/ghost.ts"] }));
    expect(r.unattributedMutations).toEqual(["src/ghost.ts"]);
    expect(r.reconstructable).toBe(false);
  });

  it("detects an unattributed ledger entry (missing owner/tool/reason)", () => {
    const r = reconstructRun(
      input({ ledger: [{ file: "src/a.ts", owner: "", tool: "codex-cli", reason: "x", sequence: 0 }] })
    );
    expect(r.fullyAttributed).toBe(false);
    expect(r.unattributedEntries).toContain(0);
    expect(r.reconstructable).toBe(false);
  });

  it("detects a sequence GAP in the event stream", () => {
    const r = reconstructRun(
      input({
        events: [
          { sequenceNumber: 0, type: "run.started" },
          { sequenceNumber: 2, type: "run.completed" }
        ]
      })
    );
    expect(r.eventSequenceGapless).toBe(false);
    expect(r.reconstructable).toBe(false);
  });

  it("requires lifecycle bookends (a start + a terminal event)", () => {
    const r = reconstructRun(input({ events: [{ sequenceNumber: 0, type: "file.changed" }] }));
    expect(r.hasLifecycleBookends).toBe(false);
    expect(r.reconstructable).toBe(false);
  });

  it("detects a diff that does not reconcile to the governance binding", () => {
    const r = reconstructRun(input({ governanceDiffHash: "diff-OTHER" }));
    expect(r.diffReconciles).toBe(false);
    expect(r.reconstructable).toBe(false);
  });
});
