import { describe, expect, it } from "vitest";
import { createConfiguredAdapter, describeConfiguredProvider } from "../providers/configuredAdapter.js";
import { MockCodexAdapter, MockClaudeAdapter } from "../providers/mock/mockAdapter.js";

describe("createConfiguredAdapter — explicit mode, no silent fallback", () => {
  it("mock mode returns the deterministic mock adapter", () => {
    expect(createConfiguredAdapter("codex", "mock")).toBeInstanceOf(MockCodexAdapter);
    expect(createConfiguredAdapter("claude", "mock")).toBeInstanceOf(MockClaudeAdapter);
  });

  it("real mode returns a REAL adapter — never a mock (no degradation)", () => {
    const codex = createConfiguredAdapter("codex", "real");
    const claude = createConfiguredAdapter("claude", "real");
    expect(codex).not.toBeInstanceOf(MockCodexAdapter);
    expect(claude).not.toBeInstanceOf(MockClaudeAdapter);
    expect(codex.provider).toBe("codex");
    expect(claude.provider).toBe("claude");
  });

  it("rejects an unknown mode rather than guessing", () => {
    // @ts-expect-error exercising the runtime guard
    expect(() => createConfiguredAdapter("codex", "wishful")).toThrow(/unknown provider mode/);
  });

  it("describeConfiguredProvider reports honest mock provenance (isReal=false)", async () => {
    const id = await describeConfiguredProvider("codex", "mock");
    expect(id.isReal).toBe(false);
    expect(id.mode).toBe("mock");
    expect(id.version).toMatch(/mock-codex/);
  });
});
