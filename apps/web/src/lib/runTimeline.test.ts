import { describe, expect, it } from "vitest";
import { buildTimeline, type RunEvent } from "./runTimeline.js";

function ev(seq: number, type = "tool", over: Partial<RunEvent> = {}): RunEvent {
  return { sequenceNumber: seq, type, timestamp: `2026-06-29T00:00:0${seq}.000Z`, provider: "codex", ...over };
}

describe("buildTimeline — ordered by sequence, deduped, gap-flagged, sanitized", () => {
  it("orders by sequence number, not timestamp", () => {
    // Out of order, and timestamps that would mislead a timestamp sort.
    const events = [
      ev(2, "run.completed", { timestamp: "2026-06-29T00:00:01.000Z" }),
      ev(0, "run.started", { timestamp: "2026-06-29T00:00:09.000Z" }),
      ev(1, "tool")
    ];
    const view = buildTimeline(events);
    expect(view.entries.map((e) => e.sequenceNumber)).toEqual([0, 1, 2]);
    expect(view.entries[0].type).toBe("run.started");
  });

  it("dedupes a repeated sequence number (keeps the first)", () => {
    const view = buildTimeline([ev(0, "a"), ev(1, "b"), ev(1, "DUPLICATE")]);
    expect(view.entries).toHaveLength(2);
    expect(view.duplicateSequences).toEqual([1]);
    expect(view.entries[1].type).toBe("b"); // first kept
  });

  it("flags a sequence gap (a possible dropped event)", () => {
    const view = buildTimeline([ev(0), ev(1), ev(4)]);
    expect(view.gaps).toEqual([2, 3]);
  });

  it("has no gaps for a contiguous sequence", () => {
    expect(buildTimeline([ev(0), ev(1), ev(2)]).gaps).toEqual([]);
  });

  it("sanitizes the event type and detail (no control/ANSI/secret leak)", () => {
    const view = buildTimeline([ev(0, "tool", { detail: "\x1b[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU\x1b[0m ran" })]);
    expect(view.entries[0].detail).not.toContain("\x1b");
    expect(view.entries[0].detail).toContain("«redacted»");
  });
});
