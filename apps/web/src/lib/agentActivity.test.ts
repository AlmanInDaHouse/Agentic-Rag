import { describe, expect, it } from "vitest";
import { deriveAgentActivity } from "./agentActivity.js";
import type { IntegratedRunEventDTO } from "./integratedRun.js";

function ev(seq: number, type: string, payload: Record<string, unknown> = {}, provider: string | null = null): IntegratedRunEventDTO {
  return { sequenceNumber: seq, type, provider, providerVersion: null, payload, at: "2026-06-30T00:00:00.000Z" };
}

describe("deriveAgentActivity — honest dual-agent split", () => {
  it("routes owner writes to the owner lane and reviewer findings to the reviewer lane", () => {
    const events = [
      ev(1, "agent.message", { text: "planning" }, "codex"),
      ev(2, "file.changed", { path: "src/x.ts" }, "codex"),
      ev(3, "mutations.recorded", { round: 0, filesChanged: ["src/x.ts"] }, "codex"),
      ev(4, "review.completed", { summary: "ok", findings: { blocker: 0, major: 0, minor: 1, observation: 2 } }, "claude")
    ];
    const v = deriveAgentActivity(events, "codex", "claude");
    expect(v.owner.provider).toBe("codex");
    expect(v.reviewer.provider).toBe("claude");
    expect(v.owner.items.map((i) => i.type)).toEqual(["agent.message", "file.changed", "mutations.recorded"]);
    expect(v.reviewer.items.map((i) => i.type)).toEqual(["review.completed"]);
    expect(v.owner.counts.changes).toBe(1);
    expect(v.reviewer.counts.findings).toBe(3);
  });

  it("does NOT attribute orchestration (provider-less) events to any agent", () => {
    const events = [
      ev(1, "run.started"),
      ev(2, "governance.decided", { verdict: "merge" }),
      ev(3, "cleanup.completed", { cleanedUp: true })
    ];
    const v = deriveAgentActivity(events, "codex", "claude");
    expect(v.owner.items).toHaveLength(0);
    expect(v.reviewer.items).toHaveLength(0);
  });

  it("sanitizes captured text (secrets masked) in details", () => {
    const events = [ev(1, "agent.message", { text: "token sk-ABCDEFGHIJKLMNOPQRSTUV done" }, "codex")];
    const v = deriveAgentActivity(events, "codex", "claude");
    expect(v.owner.items[0].detail).toContain("«redacted»");
    expect(v.owner.items[0].detail).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("gives Spanish titles and preserves sequence order", () => {
    const events = [ev(2, "file.changed", { path: "b.ts" }, "codex"), ev(1, "agent.message", { text: "hi" }, "codex")];
    const v = deriveAgentActivity(events, "codex", "claude");
    expect(v.owner.items.map((i) => i.sequenceNumber)).toEqual([1, 2]);
    expect(v.owner.items[0].title).toBe("Mensaje del agente");
    expect(v.owner.items[1].title).toBe("Fichero modificado");
  });

  it("flags when owner and reviewer are the same provider", () => {
    const v = deriveAgentActivity([], "codex", "codex");
    expect(v.sameProvider).toBe(true);
  });
});
