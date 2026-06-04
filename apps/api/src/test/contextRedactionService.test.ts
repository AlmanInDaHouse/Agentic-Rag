import { describe, expect, it } from "vitest";
import { ContextRedactionService } from "../services/contextRedactionService.js";

describe("ContextRedactionService", () => {
  const service = new ContextRedactionService();

  it("detects and redacts common sensitive values", () => {
    const result = service.redactText([
      "email manuel@example.com",
      "phone +34 612 345 678",
      "dni 12345678Z",
      "iban ES91 2100 0418 4502 0005 1332",
      "card 4111 1111 1111 1111",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456",
      "api_key=sk_1234567890abcdef1234567890",
      "password=supersecret",
      "token=abcdef1234567890",
      "https://example.test/callback?token=abcdef1234567890"
    ].join("\n"));

    expect(result.redactionStatus).toBe("redacted");
    expect(result.classification).toBe("secret");
    expect(result.findings.map((finding) => finding.type)).toEqual(expect.arrayContaining([
      "email",
      "phone",
      "dni_nie",
      "iban",
      "credit_card_like",
      "jwt_like",
      "api_key_like",
      "password_like",
      "secret_token_like",
      "url_with_token"
    ]));
    expect(result.redactedContent).toContain("[REDACTED_EMAIL]");
    expect(result.redactedContent).toContain("[REDACTED_PHONE]");
    expect(result.redactedContent).toContain("[REDACTED_DNI_NIE]");
    expect(result.redactedContent).toContain("[REDACTED_IBAN]");
    expect(result.redactedContent).toContain("[REDACTED_TOKEN]");
    expect(result.redactedContent).toContain("[REDACTED_SECRET]");
    expect(result.redactedContent).not.toContain("manuel@example.com");
    expect(result.redactedContent).not.toContain("supersecret");
  });

  it("marks private keys as restricted and blocked", () => {
    const result = service.redactText(
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----"
    );

    expect(result.classification).toBe("restricted");
    expect(result.redactionStatus).toBe("blocked");
    expect(result.findings[0]).toMatchObject({
      type: "private_key_like",
      severity: "critical",
      replacement: "[REDACTED_PRIVATE_KEY]"
    });
  });

  it("keeps clean internal notes clean", () => {
    const result = service.redactText("Runtime context explains approval gates.");

    expect(result.classification).toBe("internal");
    expect(result.redactionStatus).toBe("clean");
    expect(result.findings).toEqual([]);
    expect(result.redactedContent).toBe("Runtime context explains approval gates.");
  });

  it("handles empty and whitespace-only text as clean", () => {
    expect(service.redactText("")).toMatchObject({
      classification: "internal",
      redactionStatus: "clean",
      findings: [],
      redactedContent: ""
    });
    expect(service.redactText(" \n\t ")).toMatchObject({
      classification: "internal",
      redactionStatus: "clean",
      findings: [],
      redactedContent: " \n\t "
    });
  });

  it("returns metadata-only findings with stable positions", () => {
    const input = "Contact ops@example.com.";
    const result = service.redactText(input);

    expect(result.findings).toEqual([{
      type: "email",
      start: 8,
      end: 23,
      replacement: "[REDACTED_EMAIL]",
      severity: "medium"
    }]);
    expect(JSON.stringify(result.findings)).not.toContain("ops@example.com");
  });

  it("redacts secret token findings without retaining raw token values", () => {
    const input = "token=abcdef1234567890";
    const result = service.redactText(input);

    expect(result.classification).toBe("secret");
    expect(result.redactionStatus).toBe("redacted");
    expect(result.findings).toEqual([{
      type: "secret_token_like",
      start: 0,
      end: input.length,
      replacement: "[REDACTED_TOKEN]",
      severity: "high"
    }]);
    expect(result.redactedContent).toBe("[REDACTED_TOKEN]");
    expect(result.redactedContent).not.toContain("abcdef1234567890");
    expect(JSON.stringify(result.findings)).not.toContain("abcdef1234567890");
  });

  it("is stable for repeated redaction", () => {
    const input = "Contact security@example.com with token=abcdef1234567890.";

    expect(service.redactText(input)).toEqual(service.redactText(input));
  });
});
