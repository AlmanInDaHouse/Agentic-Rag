import { describe, expect, it } from "vitest";
import {
  deriveIntegratedRunView,
  type IntegratedRunEventDTO,
  type IntegratedRunRecordDTO
} from "./integratedRun.js";

function record(over: Partial<IntegratedRunRecordDTO> = {}): IntegratedRunRecordDTO {
  return {
    id: "run-1",
    status: "completed",
    spec: { providerMode: "real", collaborationMode: "specialist", owner: "codex", reviewer: "claude", objective: "do x" },
    ownerProvenance: { provider: "codex", mode: "real", version: "0.142.4", isReal: true },
    reviewerProvenance: { provider: "claude", mode: "real", version: "2.1.195", isReal: true },
    report: {
      governance: { verdict: "merge" },
      merged: true,
      repairState: "accepted",
      ledgerEntryCount: 2,
      reconciledTampered: false,
      gateTampered: false,
      cleanedUp: true,
      changedFiles: [{ path: "src/feature.ts", status: "added" }],
      diffText: "diff --git a/src/feature.ts\n+export const f = 1;\n"
    },
    terminalReason: "verdict=merge; merged=true",
    createdAt: "2026-06-30T00:00:00.000Z",
    startedAt: "2026-06-30T00:00:01.000Z",
    completedAt: "2026-06-30T00:00:09.000Z",
    ...over
  };
}
function ev(seq: number, type: string, over: Partial<IntegratedRunEventDTO> = {}): IntegratedRunEventDTO {
  return { sequenceNumber: seq, type, provider: null, providerVersion: null, payload: {}, at: "2026-06-30T00:00:00.000Z", ...over };
}

const ESC = String.fromCharCode(0x1b);
const BELL = String.fromCharCode(0x07);

describe("deriveIntegratedRunView — honest provider provenance", () => {
  it("labels a real provider with its version and isReal=true", () => {
    const v = deriveIntegratedRunView(record(), []);
    expect(v.owner.label).toBe("codex — real (0.142.4)");
    expect(v.owner.isReal).toBe(true);
    expect(v.reviewer.label).toContain("claude — real (2.1.195)");
  });

  it("labels a mock provider as mock (never as real)", () => {
    const v = deriveIntegratedRunView(
      record({ ownerProvenance: { provider: "codex", mode: "mock", version: "mock-codex", isReal: false } }),
      []
    );
    expect(v.owner.label).toBe("codex — mock (mock-codex)");
    expect(v.owner.isReal).toBe(false);
  });

  it("shows UNKNOWN provenance (never invented) when absent", () => {
    const v = deriveIntegratedRunView(record({ ownerProvenance: null }), []);
    expect(v.owner.isReal).toBe("unknown");
    expect(v.owner.label).toContain("unknown");
  });
});

describe("deriveIntegratedRunView — honest event stream", () => {
  it("orders by sequence and detects no gap for a gapless run", () => {
    const v = deriveIntegratedRunView(record(), [ev(2, "b"), ev(1, "a"), ev(3, "run.completed")]);
    expect(v.events.map((e) => e.sequenceNumber)).toEqual([1, 2, 3]);
    expect(v.sequenceGap).toBe(false);
    expect(v.terminalCount).toBe(1);
  });

  it("flags a sequence gap and multiple terminals", () => {
    const v = deriveIntegratedRunView(record(), [ev(1, "run.completed"), ev(3, "run.failed")]);
    expect(v.sequenceGap).toBe(true);
    expect(v.terminalCount).toBe(2);
  });

  it("sanitizes secrets and terminal escapes out of event detail", () => {
    const hostile = `${ESC}[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU${ESC}[0m done`;
    const v = deriveIntegratedRunView(record(), [ev(1, "agent.message", { payload: { text: hostile } })]);
    expect(v.events[0].detail).not.toContain(ESC);
    expect(v.events[0].detail).toContain("«redacted»");
  });
});

describe("deriveIntegratedRunView — unknown vs zero, no hidden files", () => {
  it("reports unknown (not 0/false) when there is no report yet", () => {
    const v = deriveIntegratedRunView(record({ report: null, status: "running" }), []);
    expect(v.governanceVerdict).toBe("unknown");
    expect(v.merged).toBe("unknown");
    expect(v.cleanup).toBe("unknown");
    expect(v.diff.lineCount).toBe("unknown");
    expect(v.diff.present).toBe(false);
  });

  it("never hides changed files and sanitizes hostile filenames", () => {
    const v = deriveIntegratedRunView(
      record({
        report: {
          ...record().report!,
          changedFiles: [
            { path: "src/ok.ts", status: "added" },
            { path: `src/${BELL}bell.ts`, status: "modified" }
          ]
        }
      }),
      []
    );
    expect(v.changedFiles).toHaveLength(2);
    expect(v.changedFiles[1].path).not.toContain(BELL);
  });
});
