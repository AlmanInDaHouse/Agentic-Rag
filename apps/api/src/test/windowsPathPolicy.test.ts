/**
 * A10-W.2 — Windows path security policy (cross-platform negative matrix).
 *
 * The lexical + containment logic uses `path.win32` and an INJECTED canonicalizer,
 * so the full security matrix runs on any host (Linux CI included). The real-fs
 * behavior (junctions/symlinks/ADS on NTFS) is verified host-gated in
 * `windowsPathPolicy.host.test.ts`.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  findAlternateDataStream,
  findReservedDeviceName,
  findTrailingDotOrSpace,
  lexicalContains,
  matchForbiddenRoot,
  rejectDangerousNamespace,
  segmentsBelowRoot,
  toComparable,
  validateWindowsContainedPath,
  win32VolumeId,
  type CanonicalizeResult,
  type WindowsPathCanonicalizer
} from "../platform/windowsPathPolicy.js";

const w = path.win32;
const ROOT = "C:\\ws";

const idCanon: WindowsPathCanonicalizer = async (abs) => ({
  canonicalAbsolute: w.normalize(abs),
  leafExists: true,
  reparseInChain: false,
  resolvable: true
});

function mapCanon(overrides: Record<string, Partial<CanonicalizeResult>>): WindowsPathCanonicalizer {
  return async (abs) => {
    const key = w.normalize(abs);
    const base: CanonicalizeResult = { canonicalAbsolute: key, leafExists: true, reparseInChain: false, resolvable: true };
    return { ...base, ...(overrides[key] ?? {}) };
  };
}

function check(
  target: string,
  deps: { canonicalize?: WindowsPathCanonicalizer; forbiddenRoots?: string[]; root?: string } = {}
) {
  return validateWindowsContainedPath(
    { target, containmentRoot: deps.root ?? ROOT },
    { canonicalize: deps.canonicalize ?? idCanon, forbiddenRoots: deps.forbiddenRoots }
  );
}

describe("A10-W.2 windows path policy — allowed", () => {
  it("a normal relative file is contained and returns ONLY the canonical path", async () => {
    const r = await check("src/app.ts");
    expect(r.allowed).toBe(true);
    expect(r.canonical?.absolute).toBe("C:\\ws\\src\\app.ts");
    expect(r.canonical?.volumeId).toBe("C:\\");
  });

  it("mixed separators normalize to a contained path", async () => {
    const r = await check("src/sub\\file.ts");
    expect(r.allowed).toBe(true);
    expect(r.canonical?.absolute).toBe("C:\\ws\\src\\sub\\file.ts");
  });

  it("a contained reparse point is allowed but flagged", async () => {
    const r = await check("linkdir/file.ts", {
      canonicalize: mapCanon({ "C:\\ws\\linkdir\\file.ts": { reparseInChain: true, canonicalAbsolute: "C:\\ws\\real\\file.ts" } })
    });
    expect(r.allowed).toBe(true);
    expect(r.canonical?.hasReparsePointInChain).toBe(true);
  });

  it("allows a nonexistent target by default", async () => {
    const r = await check("src/new.ts", { canonicalize: mapCanon({ "C:\\ws\\src\\new.ts": { leafExists: false } }) });
    expect(r.allowed).toBe(true);
    expect(r.canonical?.exists).toBe(false);
  });

  it("honors allowNonexistentLeaf:false (denies a nonexistent target)", async () => {
    const r = await validateWindowsContainedPath(
      { target: "src/missing.ts", containmentRoot: ROOT, allowNonexistentLeaf: false },
      { canonicalize: mapCanon({ "C:\\ws\\src\\missing.ts": { leafExists: false } }) }
    );
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("nonexistent_leaf");
  });
});

describe("A10-W.2 windows path policy — dangerous namespaces", () => {
  it.each([
    ["\\\\server\\share\\x", "UNC"],
    ["\\\\?\\C:\\ws\\x", "extended-length"],
    ["\\\\.\\PhysicalDrive0", "device"],
    ["//server/share/x", "UNC with forward slashes"]
  ])("rejects %s (%s)", async (target) => {
    const r = await check(target);
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("dangerous_namespace");
  });
});

describe("A10-W.2 windows path policy — lexical hazards", () => {
  it("rejects an alternate data stream", async () => {
    const r = await check("notes.txt:hidden");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("alternate_data_stream");
  });

  it.each(["CON", "NUL", "AUX", "PRN", "COM1", "LPT1", "NUL.txt", "con.log"])(
    "rejects reserved device name %s",
    async (target) => {
      const r = await check(target);
      expect(r.allowed).toBe(false);
      expect(r.denyReason).toBe("reserved_device_name");
    }
  );

  it.each(["file.", "file ", "dir./child"])("rejects trailing dot/space %s", async (target) => {
    const r = await check(target);
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("trailing_dot_or_space");
  });
});

describe("A10-W.2 windows path policy — volume + containment", () => {
  it("rejects a traversal escape (..\\)", async () => {
    const r = await check("..\\evil");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("escapes_containment");
  });

  it("rejects prefix confusion (C:\\wsother is not inside C:\\ws)", async () => {
    const r = await check("C:\\wsother\\x");
    expect(r.allowed).toBe(false);
    expect(["escapes_containment", "different_volume"]).toContain(r.denyReason);
  });

  it("rejects a different drive", async () => {
    const r = await check("D:\\evil");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("different_volume");
  });

  it("rejects a different-case different-root (prefix confusion, case-folded)", async () => {
    const r = await check("c:\\wsX\\y");
    expect(r.allowed).toBe(false);
  });
});

describe("A10-W.2 windows path policy — canonical (reparse/junction) escapes", () => {
  it("rejects a junction whose realpath escapes the workspace", async () => {
    const r = await check("link/x", {
      canonicalize: mapCanon({ "C:\\ws\\link\\x": { canonicalAbsolute: "C:\\outside\\x", reparseInChain: true } })
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("escapes_containment");
  });

  it("rejects a junction that crosses to another volume", async () => {
    const r = await check("link/x", {
      canonicalize: mapCanon({ "C:\\ws\\link\\x": { canonicalAbsolute: "D:\\x", reparseInChain: true } })
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("different_volume");
  });

  it("rejects a nonexistent child below a hostile junction (ancestor escapes)", async () => {
    const r = await check("hostile/newfile", {
      canonicalize: mapCanon({ "C:\\ws\\hostile\\newfile": { canonicalAbsolute: "C:\\elsewhere\\newfile", leafExists: false, reparseInChain: true } })
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("escapes_containment");
  });

  it("rejects a dangling reparse point (not resolvable → fail-safe)", async () => {
    const r = await check("dangling/x", {
      canonicalize: mapCanon({ "C:\\ws\\dangling\\x": { resolvable: false } })
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("denied_reparse_point");
  });
});

describe("A10-W.2 windows path policy — .git + sensitive locations", () => {
  it("blocks a .git segment", async () => {
    const r = await check("src/.git/config");
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("blocked_git");
  });

  it("blocks a forbidden (sensitive) location even when lexically contained", async () => {
    const r = await check("secret/key", { forbiddenRoots: ["C:\\ws\\secret"] });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("blocked_sensitive_location");
  });
});

describe("A10-W.2 windows path policy — pure primitives", () => {
  it("toComparable folds case + separators", () => {
    expect(toComparable("C:/Work\\Sub")).toBe("c:\\work\\sub");
  });

  it("win32VolumeId returns the uppercased drive root", () => {
    expect(win32VolumeId("c:\\ws\\x")).toBe("C:\\");
  });

  it("lexicalContains is case-insensitive and segment-bounded", () => {
    expect(lexicalContains("C:\\Work", "c:\\work\\sub")).toBe(true);
    expect(lexicalContains("C:\\Work", "C:\\Work")).toBe(true);
    expect(lexicalContains("C:\\Work", "C:\\WorkOther")).toBe(false);
    expect(lexicalContains("C:\\Work", "C:\\")).toBe(false);
  });

  it("rejectDangerousNamespace flags UNC/extended/device only", () => {
    expect(rejectDangerousNamespace("\\\\?\\C:\\x")).toBe("dangerous_namespace");
    expect(rejectDangerousNamespace("//srv/share")).toBe("dangerous_namespace");
    expect(rejectDangerousNamespace("src\\app.ts")).toBeNull();
    expect(rejectDangerousNamespace("C:\\ws\\x")).toBeNull();
  });

  it("segment hazard detectors", () => {
    expect(findAlternateDataStream(["a", "b:stream"])).toBe("b:stream");
    expect(findAlternateDataStream(["a", "b"])).toBeNull();
    expect(findReservedDeviceName(["x", "COM1"])).toBe("COM1");
    expect(findReservedDeviceName(["x", "NUL.txt"])).toBe("NUL.txt");
    expect(findReservedDeviceName(["x", "community"])).toBeNull();
    expect(findTrailingDotOrSpace(["ok", "bad."])).toBe("bad.");
    expect(findTrailingDotOrSpace(["ok ", "x"])).toBe("ok ");
    expect(findTrailingDotOrSpace(["ok", "x"])).toBeNull();
  });

  it("segmentsBelowRoot excludes the drive root", () => {
    expect(segmentsBelowRoot("C:\\ws\\src\\app.ts")).toEqual(["ws", "src", "app.ts"]);
  });

  it("matchForbiddenRoot finds the containing forbidden root", () => {
    expect(matchForbiddenRoot("C:\\Users\\m\\AppData\\x", ["C:\\Users\\m\\AppData"])).toBe("C:\\Users\\m\\AppData");
    expect(matchForbiddenRoot("C:\\ws\\x", ["C:\\Users\\m\\AppData"])).toBeNull();
  });
});
