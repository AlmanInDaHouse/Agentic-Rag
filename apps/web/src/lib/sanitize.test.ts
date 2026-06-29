import { describe, expect, it } from "vitest";
import { stripControlAndAnsi, truncate, redactSecrets, safeText, safeFilename } from "./sanitize.js";

describe("stripControlAndAnsi — terminal-escape safe rendering", () => {
  it("removes ANSI colour/escape sequences", () => {
    expect(stripControlAndAnsi("\x1b[31mred\x1b[0m text")).toBe("red text");
    expect(stripControlAndAnsi("\x1b[2J\x1b[H cleared")).toBe(" cleared");
  });

  it("strips C0/C1 control characters incl. NUL, keeping tab and newline", () => {
    expect(stripControlAndAnsi("a\x00b\x07c")).toBe("abc");
    expect(stripControlAndAnsi("line1\nline2\tend")).toBe("line1\nline2\tend");
    expect(stripControlAndAnsi("a\x9bb")).toBe("ab"); // C1 CSI
  });

  it("renders a residual escape body inertly (ESC byte already removed)", () => {
    // Without the ESC byte a terminal cannot interpret the rest.
    expect(stripControlAndAnsi("\x1bX31mhi")).not.toContain("\x1b");
  });
});

describe("truncate / safeText / redactSecrets / safeFilename", () => {
  it("truncate flags dropped content", () => {
    expect(truncate("abcdef", 3)).toEqual({ text: "abc…", truncated: true });
    expect(truncate("abc", 10)).toEqual({ text: "abc", truncated: false });
  });

  it("redactSecrets masks common secret shapes", () => {
    expect(redactSecrets("key=ghp_ABCDEFGHIJKLMNOPQRSTU")).toContain("«redacted»");
    expect(redactSecrets("sk-ABCDEFGHIJKLMNOP1234")).toBe("«redacted»");
    expect(redactSecrets("nothing here")).toBe("nothing here");
  });

  it("safeText redacts + strips + truncates", () => {
    const out = safeText("\x1b[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU\x1b[0m end", 100);
    expect(out.text).not.toContain("\x1b");
    expect(out.text).toContain("«redacted»");
    expect(out.truncated).toBe(false);
    expect(safeText("x".repeat(50), 10).truncated).toBe(true);
  });

  it("safeFilename strips control chars and caps length", () => {
    expect(safeFilename("evil\x00\x1b[31mname.ts")).toBe("evilname.ts");
    expect(safeFilename("a".repeat(2000)).endsWith("…")).toBe(true);
  });
});
