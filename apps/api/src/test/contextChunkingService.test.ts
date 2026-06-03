import { describe, expect, it } from "vitest";
import { ContextChunkingService } from "../services/contextChunkingService.js";

describe("ContextChunkingService", () => {
  it("creates one chunk for short text", () => {
    const service = new ContextChunkingService();

    const chunks = service.chunk("Short project note with enough context.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      content: "Short project note with enough context."
    });
    expect(chunks[0].tokenEstimate).toBeGreaterThan(0);
  });

  it("creates multiple deterministic chunks for long text", () => {
    const service = new ContextChunkingService();
    const text = Array.from({ length: 20 }, (_, index) => `Paragraph ${index} alpha beta gamma.`).join("\n\n");

    const chunks = service.chunk(text, { targetCharacters: 120, overlapCharacters: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true);
  });

  it("normalizes line endings and does not emit empty chunks", () => {
    const service = new ContextChunkingService();

    const chunks = service.chunk("\r\n\r\n First paragraph. \r\n\r\n\r\n Second paragraph. \r\n");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("First paragraph.\n\nSecond paragraph.");
  });
});
