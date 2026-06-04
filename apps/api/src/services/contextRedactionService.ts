import type {
  DataClassification,
  RedactionResult,
  RedactionStatus,
  SensitiveFinding,
  SensitiveFindingType
} from "@triforge/shared";

type FindingRule = {
  type: SensitiveFindingType;
  replacement: string;
  severity: SensitiveFinding["severity"];
  pattern: RegExp;
  validate?: (value: string) => boolean;
};

const rules: FindingRule[] = [
  {
    type: "private_key_like",
    replacement: "[REDACTED_PRIVATE_KEY]",
    severity: "critical",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  {
    type: "jwt_like",
    replacement: "[REDACTED_TOKEN]",
    severity: "high",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    type: "url_with_token",
    replacement: "[REDACTED_TOKEN]",
    severity: "high",
    pattern: /https?:\/\/[^\s"'<>?]+[^\s"'<>]*[?&](?:token|api_key|access_token|secret)=[^\s"'<>]+/gi
  },
  {
    type: "password_like",
    replacement: "[REDACTED_SECRET]",
    severity: "high",
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"',;]{6,}/gi
  },
  {
    type: "secret_token_like",
    replacement: "[REDACTED_TOKEN]",
    severity: "high",
    pattern: /\b(?:secret|token|access_token|refresh_token)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi
  },
  {
    type: "api_key_like",
    replacement: "[REDACTED_SECRET]",
    severity: "high",
    pattern: /\b(?:api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}|(?:sk|pk)_[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{16})\b/gi
  },
  {
    type: "iban",
    replacement: "[REDACTED_IBAN]",
    severity: "medium",
    pattern: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi
  },
  {
    type: "credit_card_like",
    replacement: "[REDACTED_SECRET]",
    severity: "medium",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: (value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19;
    }
  },
  {
    type: "dni_nie",
    replacement: "[REDACTED_DNI_NIE]",
    severity: "medium",
    pattern: /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/gi
  },
  {
    type: "email",
    replacement: "[REDACTED_EMAIL]",
    severity: "medium",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    type: "phone",
    replacement: "[REDACTED_PHONE]",
    severity: "medium",
    pattern: /(?:\+?\d[\d\s().-]{7,}\d)/g,
    validate: (value) => {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15;
    }
  }
];

export class ContextRedactionService {
  scanText(input: string): RedactionResult {
    const findings = findSensitiveData(input);
    return {
      classification: classifyFindings(findings),
      redactionStatus: redactionStatusForFindings(findings),
      findings,
      redactedContent: input
    };
  }

  redactText(input: string): RedactionResult {
    const findings = findSensitiveData(input);
    return {
      classification: classifyFindings(findings),
      redactionStatus: redactionStatusForFindings(findings),
      findings,
      redactedContent: redactWithFindings(input, findings)
    };
  }

  classifyText(input: string): DataClassification {
    return classifyFindings(findSensitiveData(input));
  }
}

function findSensitiveData(input: string): SensitiveFinding[] {
  const rawFindings = rules.flatMap((rule) => {
    const matches = Array.from(input.matchAll(rule.pattern));
    return matches.flatMap((match) => {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0 || (rule.validate && !rule.validate(value))) {
        return [];
      }
      return [{
        type: rule.type,
        start,
        end: start + value.length,
        replacement: rule.replacement,
        severity: rule.severity
      }];
    });
  });

  return dedupeOverlappingFindings(rawFindings);
}

function dedupeOverlappingFindings(findings: SensitiveFinding[]): SensitiveFinding[] {
  const severityRank: Record<SensitiveFinding["severity"], number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
  };
  const sorted = [...findings].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    if (right.end !== left.end) {
      return right.end - left.end;
    }
    return severityRank[right.severity] - severityRank[left.severity];
  });
  const selected: SensitiveFinding[] = [];
  for (const finding of sorted) {
    if (selected.some((existing) => rangesOverlap(existing, finding))) {
      continue;
    }
    selected.push(finding);
  }
  return selected;
}

function rangesOverlap(left: SensitiveFinding, right: SensitiveFinding): boolean {
  return left.start < right.end && right.start < left.end;
}

function classifyFindings(findings: SensitiveFinding[]): DataClassification {
  if (findings.some((finding) => finding.severity === "critical")) {
    return "restricted";
  }
  if (findings.some((finding) => finding.severity === "high")) {
    return "secret";
  }
  if (findings.length > 0) {
    return "confidential";
  }
  return "internal";
}

function redactionStatusForFindings(findings: SensitiveFinding[]): RedactionStatus {
  if (findings.some((finding) => finding.severity === "critical")) {
    return "blocked";
  }
  return findings.length > 0 ? "redacted" : "clean";
}

function redactWithFindings(input: string, findings: SensitiveFinding[]): string {
  let cursor = 0;
  let output = "";
  for (const finding of findings) {
    output += input.slice(cursor, finding.start);
    output += finding.replacement;
    cursor = finding.end;
  }
  output += input.slice(cursor);
  return output;
}
