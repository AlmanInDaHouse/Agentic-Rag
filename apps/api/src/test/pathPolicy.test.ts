import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import {
  PathPolicyEngine,
  type AllowedPathPolicy,
  type PathPolicyAuditEntry
} from "../execution/path/index.js";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

/** A workspace with src/app.ts, README.md, secret.txt and a .git/config. */
function makeWorkspace(): string {
  const ws = makeTempDir("triforge-ws-");
  mkdirSync(path.join(ws, "src"), { recursive: true });
  writeFileSync(path.join(ws, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(path.join(ws, "README.md"), "# ws\n");
  writeFileSync(path.join(ws, "secret.txt"), "shh\n");
  mkdirSync(path.join(ws, ".git"), { recursive: true });
  writeFileSync(path.join(ws, ".git", "config"), "[core]\n");
  return ws;
}

const DEFAULT_POLICY: AllowedPathPolicy = {
  readPaths: ["src", "README.md"],
  writePaths: ["src"],
  blockedPaths: ["src/blocked"],
  maxFilesChanged: 10
};

function makeEngine(
  ws: string,
  policy: Partial<AllowedPathPolicy> = {},
  onAudit?: (e: PathPolicyAuditEntry) => void
): PathPolicyEngine {
  return new PathPolicyEngine({
    workspaceRoot: ws,
    policy: { ...DEFAULT_POLICY, ...policy },
    clock: new ManualClock(),
    onAudit
  });
}

describe("PathPolicyEngine — read/write gating", () => {
  it("allows a read within readPaths and returns the canonical realPath", () => {
    const ws = makeWorkspace();
    const d = makeEngine(ws).checkRead("src/app.ts");
    expect(d.allowed).toBe(true);
    expect(d.realPath && path.basename(d.realPath)).toBe("app.ts");
    expect(d.relPath).toBe("src/app.ts");
  });

  it("denies a read outside readPaths (not_readable)", () => {
    const ws = makeWorkspace();
    expect(makeEngine(ws).checkRead("secret.txt")).toMatchObject({ allowed: false, reason: "not_readable" });
  });

  it("allows a write within writePaths, including a not-yet-existing nested file", () => {
    const ws = makeWorkspace();
    const eng = makeEngine(ws);
    expect(eng.checkWrite("src/app.ts").allowed).toBe(true);
    expect(eng.checkWrite("src/new/deep/file.ts")).toMatchObject({ allowed: true, relPath: "src/new/deep/file.ts" });
  });

  it("denies a write outside writePaths (not_writable)", () => {
    const ws = makeWorkspace();
    expect(makeEngine(ws).checkWrite("README.md")).toMatchObject({ allowed: false, reason: "not_writable" });
  });

  it("treats writePaths as segment prefixes — no prefix confusion (`src` !~ `srcfoo`)", () => {
    const ws = makeWorkspace();
    expect(makeEngine(ws).checkWrite("srcfoo/x.ts")).toMatchObject({ allowed: false, reason: "not_writable" });
  });

  it("blockedPaths override an otherwise-writable path", () => {
    const ws = makeWorkspace();
    expect(makeEngine(ws).checkWrite("src/blocked/x.ts")).toMatchObject({ allowed: false, reason: "blocked_path" });
  });
});

describe("PathPolicyEngine — .git / object store (T-FS-08)", () => {
  it("blocks any .git path segment, case-insensitively, for read and write", () => {
    const ws = makeWorkspace();
    const eng = makeEngine(ws, { readPaths: ["."], writePaths: ["."] });
    expect(eng.checkRead(".git/config")).toMatchObject({ allowed: false, reason: "blocked_git" });
    expect(eng.checkWrite(".git/objects/abc")).toMatchObject({ allowed: false, reason: "blocked_git" });
    expect(eng.checkWrite(".GIT/config")).toMatchObject({ allowed: false, reason: "blocked_git" });
    expect(eng.checkWrite("src/.git/hook")).toMatchObject({ allowed: false, reason: "blocked_git" });
  });
});

describe("PathPolicyEngine — containment & traversal (SAT-A5-2/3)", () => {
  it("denies parent traversal", () => {
    const ws = makeWorkspace();
    expect(makeEngine(ws, { readPaths: ["."] }).checkRead("../escape.txt")).toMatchObject({
      allowed: false,
      reason: "traversal"
    });
  });

  it("denies absolute out-of-workspace reads/writes ($HOME, /mnt/c, /etc) — SAT-A5-2", () => {
    const ws = makeWorkspace();
    const eng = makeEngine(ws, { readPaths: ["."], writePaths: ["."] });
    for (const abs of ["/etc/passwd", "/mnt/c/Windows/System32/config/SAM", "/home/victim/.ssh/id_rsa"]) {
      expect(eng.checkRead(abs)).toMatchObject({ allowed: false, reason: "traversal" });
      expect(eng.checkWrite(abs)).toMatchObject({ allowed: false, reason: "traversal" });
    }
  });

  it("denies a write to a SIBLING worktree path (cross-worktree) — SAT-A5-3", () => {
    const stateRoot = makeTempDir("triforge-state-");
    const wsA = path.join(stateRoot, "worktrees", "runA", "t");
    const wsB = path.join(stateRoot, "worktrees", "runB", "t");
    mkdirSync(wsA, { recursive: true });
    mkdirSync(wsB, { recursive: true });
    writeFileSync(path.join(wsB, "victim.ts"), "x\n");
    const eng = new PathPolicyEngine({
      workspaceRoot: wsA,
      policy: { readPaths: ["."], writePaths: ["."], blockedPaths: [], maxFilesChanged: 10 },
      clock: new ManualClock()
    });
    const rel = path.relative(wsA, path.join(wsB, "victim.ts"));
    expect(eng.checkWrite(rel)).toMatchObject({ allowed: false, reason: "traversal" });
  });
});

describe("PathPolicyEngine — symlink & hardlink (SAT-A5-1)", () => {
  it("denies access through a symlinked ancestor escaping the workspace", () => {
    const ws = makeWorkspace();
    const external = makeTempDir("triforge-external-");
    writeFileSync(path.join(external, "loot.txt"), "secret\n");
    let linked = false;
    try {
      symlinkSync(external, path.join(ws, "src", "out"), "dir");
      linked = true;
    } catch {
      /* symlink needs privilege on win32; CI is Linux */
    }
    if (!linked) return;
    const eng = makeEngine(ws, { readPaths: ["."], writePaths: ["."] });
    expect(eng.checkRead("src/out/loot.txt")).toMatchObject({ allowed: false, reason: "symlink_escape" });
    expect(eng.checkWrite("src/out/loot.txt")).toMatchObject({ allowed: false, reason: "symlink_escape" });
  });

  it("denies a not-yet-existing target whose ancestor is a symlink escaping the workspace", () => {
    const ws = makeWorkspace();
    const external = makeTempDir("triforge-external-");
    let linked = false;
    try {
      symlinkSync(external, path.join(ws, "src", "out"), "dir");
      linked = true;
    } catch {
      /* skip on win32 without privilege */
    }
    if (!linked) return;
    expect(makeEngine(ws).checkWrite("src/out/new.ts")).toMatchObject({
      allowed: false,
      reason: "symlink_escape"
    });
  });

  it("refuses a WRITE to a hardlinked file (clobber guard, T-FS-04)", () => {
    const ws = makeWorkspace();
    const external = makeTempDir("triforge-external-");
    const externalFile = path.join(external, "target");
    writeFileSync(externalFile, "external\n");
    let hardlinked = false;
    try {
      linkSync(externalFile, path.join(ws, "src", "hard.ts"));
      hardlinked = true;
    } catch {
      /* cross-device or unsupported; skip */
    }
    if (!hardlinked) return;
    expect(makeEngine(ws).checkWrite("src/hard.ts")).toMatchObject({ allowed: false, reason: "hardlink" });
  });
});

describe("PathPolicyEngine — maxFilesChanged & audit", () => {
  it("enforces maxFilesChanged across distinct files; re-writing a file is free", () => {
    const ws = makeWorkspace();
    const eng = makeEngine(ws, { writePaths: ["src"], maxFilesChanged: 2 });
    expect(eng.checkWrite("src/a.ts").allowed).toBe(true);
    expect(eng.checkWrite("src/a.ts").allowed).toBe(true); // same file, no extra budget
    expect(eng.approvedWriteCount()).toBe(1);
    expect(eng.checkWrite("src/b.ts").allowed).toBe(true);
    expect(eng.approvedWriteCount()).toBe(2);
    expect(eng.checkWrite("src/c.ts")).toMatchObject({ allowed: false, reason: "max_files" });
  });

  it("rejects invalid input (empty / NUL byte)", () => {
    const ws = makeWorkspace();
    const eng = makeEngine(ws);
    expect(eng.checkRead("")).toMatchObject({ allowed: false, reason: "invalid_input" });
    expect(eng.checkRead("src/\0evil")).toMatchObject({ allowed: false, reason: "invalid_input" });
  });

  it("audits every decision (allowed and denied)", () => {
    const ws = makeWorkspace();
    const audited: PathPolicyAuditEntry[] = [];
    const eng = makeEngine(ws, {}, (e) => audited.push(e));
    eng.checkRead("src/app.ts");
    eng.checkWrite("README.md");
    expect(audited).toHaveLength(2);
    expect(audited[0]).toMatchObject({ mode: "read", allowed: true });
    expect(audited[1]).toMatchObject({ mode: "write", allowed: false, reason: "not_writable" });
  });
});
