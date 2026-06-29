import { describe, expect, it } from "vitest";
import { buildDiffReview, type DiffReviewInput } from "./diffReview.js";

function input(over: Partial<DiffReviewInput> = {}): DiffReviewInput {
  return {
    files: [
      { path: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new\n" },
      { path: "src/b.ts", status: "added", patch: "+export const b = 1;\n" },
      { path: "src/old.ts", status: "deleted" },
      { path: "img.png", status: "binary" },
      { path: "src/new.ts", status: "renamed", renamedFrom: "src/older.ts", patch: "" }
    ],
    findings: [
      { severity: "major", file: "src/a.ts", message: "risky change" },
      { severity: "minor", message: "general note" }
    ],
    gateOverall: "passed",
    repairRounds: 1,
    diffHash: "diff-1",
    reviewedHash: "diff-1",
    ...over
  };
}

describe("buildDiffReview — never hides a changed file; flags review mismatch", () => {
  it("renders EVERY changed file (none hidden)", () => {
    const v = buildDiffReview(input());
    expect(v.fileCount).toBe(5);
    expect(v.hiddenFiles).toBe(0);
    expect(v.files.map((f) => f.path).sort()).toEqual(
      ["img.png", "src/a.ts", "src/b.ts", "src/new.ts", "src/old.ts"]
    );
  });

  it("marks binary / deleted / renamed files", () => {
    const v = buildDiffReview(input());
    const by = (p: string) => v.files.find((f) => f.path === p)!;
    expect(by("img.png").isBinary).toBe(true);
    expect(by("img.png").patch.text).toBe("[binary file]");
    expect(by("src/old.ts").status).toBe("deleted");
    expect(by("src/new.ts").status).toBe("renamed");
    expect(by("src/new.ts").renamedFrom).toBe("src/older.ts");
  });

  it("flags a diff changed AFTER review (diffHash != reviewedHash)", () => {
    expect(buildDiffReview(input({ diffHash: "diff-2", reviewedHash: "diff-1" })).changedAfterReview).toBe(true);
    expect(buildDiffReview(input()).changedAfterReview).toBe(false);
  });

  it("attaches findings per file + severity counts, sanitized", () => {
    const v = buildDiffReview(
      input({ findings: [{ severity: "blocker", file: "src/a.ts", message: "\x1b[31mtoken=ghp_ABCDEFGHIJKLMNOPQRSTU\x1b[0m" }] })
    );
    const a = v.files.find((f) => f.path === "src/a.ts")!;
    expect(a.findings[0].severity).toBe("blocker");
    expect(a.findings[0].message).not.toContain("\x1b");
    expect(a.findings[0].message).toContain("«redacted»");
    expect(v.findingsBySeverity.blocker).toBe(1);
  });

  it("truncation-flags an oversized patch", () => {
    const v = buildDiffReview(input({ files: [{ path: "big.ts", status: "modified", patch: "x".repeat(60_000) }] }));
    expect(v.files[0].patch.truncated).toBe(true);
  });
});
