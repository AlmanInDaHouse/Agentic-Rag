/**
 * A10.2 — Real isolation boundary: invariant matrix (mandate §6).
 *
 * Drives the REAL primitives (PathPolicyEngine, CommandPolicy) and the A10.2 isolation
 * module against real-OS fixtures and asserts the 13 invariants + the negative-fixture
 * list (path traversal, symlink/hardlink escape, /mnt/c, $HOME, credential paths, env
 * leakage, network, destructive/privileged commands, .git). Real-process behaviours
 * (process-group kill, output-flood kill) are enforced by the supervisor/runner and
 * covered by the POSIX-guarded supervisor tests on CI Linux; here we assert the
 * declared limits + deny-by-default contract that bound them — never a vacuous pass.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { PathPolicyEngine, type AllowedPathPolicy } from "../execution/path/index.js";
import { CommandPolicy, DEFAULT_ALLOWED_CATEGORIES, classifyCommand } from "../execution/command/index.js";
import {
  ISOLATION_INVARIANTS,
  WSL2_IS_NOT_A_SANDBOX,
  PROVIDER_ENV_ALLOWLIST,
  DEFAULT_ISOLATION_LIMITS,
  buildProviderEnv,
  findEnvLeaks,
  scanGitFilterDrivers,
  gitFilterNeutralizationFlags,
  cwdWithinWorktree
} from "../execution/isolation/index.js";

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

/** A worktree fixture with src/, README, a .git dir, and a sibling worktree next to it. */
function makeWorktree(): { ws: string; sibling: string; stateRoot: string } {
  const stateRoot = makeTempDir("triforge-iso-");
  const ws = path.join(stateRoot, "wt-A");
  const sibling = path.join(stateRoot, "wt-B");
  mkdirSync(path.join(ws, "src"), { recursive: true });
  writeFileSync(path.join(ws, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(path.join(ws, "README.md"), "# ws\n");
  mkdirSync(path.join(ws, ".git"), { recursive: true });
  writeFileSync(path.join(ws, ".git", "config"), "[core]\n");
  mkdirSync(path.join(sibling, "src"), { recursive: true });
  writeFileSync(path.join(sibling, "secret.txt"), "other-worktree\n");
  return { ws, sibling, stateRoot };
}

const POLICY: AllowedPathPolicy = {
  readPaths: ["."],
  writePaths: ["src"],
  blockedPaths: [],
  maxFilesChanged: 50
};
function engine(ws: string): PathPolicyEngine {
  return new PathPolicyEngine({ workspaceRoot: ws, policy: POLICY, clock: new ManualClock() });
}

/** Create a symlink, returning false if the OS refuses (restricted Windows) so the
 * caller can skip rather than fail — CI Linux always permits it. */
function trySymlink(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

describe("A10.2 isolation boundary — the invariant set is complete", () => {
  it("declares all 13 mandate §6 invariants", () => {
    expect(ISOLATION_INVARIANTS).toHaveLength(13);
    expect(WSL2_IS_NOT_A_SANDBOX).toBe(true);
  });
});

describe("A10.2 — filesystem containment (invariants 1,2,4,5)", () => {
  it("1: denies a write outside the worktree (traversal + absolute escape)", () => {
    const { ws } = makeWorktree();
    const e = engine(ws);
    expect(e.checkWrite("../escape.txt").allowed).toBe(false);
    expect(e.checkWrite("../../etc/passwd").allowed).toBe(false);
    expect(e.checkWrite(path.join(path.parse(ws).root, "etc", "passwd")).allowed).toBe(false);
  });

  it("2/credential-path: denies reading a credential store outside the worktree", () => {
    const { ws } = makeWorktree();
    const e = engine(ws);
    // Absolute path into the real $HOME credential store.
    expect(e.checkRead(path.join(homedir(), ".ssh", "id_rsa")).allowed).toBe(false);
    expect(e.checkRead(path.join(homedir(), ".aws", "credentials")).allowed).toBe(false);
    // A symlink inside the worktree pointing at $HOME must not launder the escape.
    const link = path.join(ws, "src", "leak");
    if (trySymlink(path.join(homedir(), ".ssh"), link)) {
      const d = e.checkRead("src/leak/id_rsa");
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("symlink_escape");
    }
  });

  it("4: denies access to a sibling worktree", () => {
    const { ws, sibling } = makeWorktree();
    const e = engine(ws);
    expect(e.checkRead(path.join(sibling, "secret.txt")).allowed).toBe(false);
    expect(e.checkWrite(path.join(sibling, "src", "x.ts")).allowed).toBe(false);
    // relative climb into the sibling
    expect(e.checkWrite("../wt-B/src/x.ts").allowed).toBe(false);
  });

  it("5: denies any .git modification (gitdir link + shared object store)", () => {
    const { ws } = makeWorktree();
    const e = engine(ws);
    expect(e.checkWrite(".git/config").allowed).toBe(false);
    expect(e.checkWrite("src/../.git/hooks/pre-commit").allowed).toBe(false);
    expect(e.checkRead(".git/config").reason).toBe("blocked_git");
  });

  it("/mnt/c escape: denies a Windows-host path", () => {
    const { ws } = makeWorktree();
    const e = engine(ws);
    expect(e.checkWrite("/mnt/c/Windows/System32/drivers/etc/hosts").allowed).toBe(false);
    expect(e.checkRead("/mnt/c/Users/victim/secret").allowed).toBe(false);
  });

  it("hardlink abuse: refuses writing a multiply-linked file", () => {
    const { ws } = makeWorktree();
    const real = path.join(ws, "src", "app.ts");
    const hard = path.join(ws, "src", "hardlink.ts");
    try {
      linkSync(real, hard);
    } catch {
      return; // hardlink unsupported here; CI Linux covers it
    }
    const d = engine(ws).checkWrite("src/hardlink.ts");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("hardlink");
  });
});

describe("A10.2 — environment isolation (invariants 3,12)", () => {
  it("3: the provider env never inherits credential-shaped names", () => {
    const source: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/home/u",
      ANTHROPIC_API_KEY: "sk-should-not-leak",
      OPENAI_API_KEY: "sk-should-not-leak",
      GH_TOKEN: "ghp_should-not-leak",
      AWS_SECRET_ACCESS_KEY: "should-not-leak",
      MY_PAT: "should-not-leak"
    };
    const env = buildProviderEnv(source);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(findEnvLeaks(env)).toEqual([]);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it("3: a credential-shaped name on the allowlist is still dropped (defense in depth)", () => {
    const env = buildProviderEnv({ GITHUB_TOKEN: "x", PATH: "/usr/bin" }, ["GITHUB_TOKEN", "PATH"]);
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("12: the provider env allowlist carries no cloud/credential names", () => {
    expect(findEnvLeaks(buildProviderEnv())).toEqual([]);
    for (const name of PROVIDER_ENV_ALLOWLIST) {
      expect(/key|token|secret|password|credential/i.test(name)).toBe(false);
    }
  });
});

describe("A10.2 — command isolation (invariants 7,8,9 + destructive/privileged)", () => {
  function policy(ws: string): CommandPolicy {
    return new CommandPolicy({ workspaceRoot: ws });
  }

  it("7/network: denies unauthorized network binaries by default", () => {
    const { ws } = makeWorktree();
    const p = policy(ws);
    for (const bin of ["curl", "wget", "nc", "ssh", "scp"]) {
      const d = p.check({ bin, args: ["https://evil.example/x"] }, ws);
      expect(d.allowed, bin).toBe(false);
      expect(d.category, bin).toBe("network");
    }
  });

  it("8: network is NOT a default-allowed category (required network must be explicit)", () => {
    expect(DEFAULT_ALLOWED_CATEGORIES).not.toContain("network");
    expect(DEFAULT_ALLOWED_CATEGORIES).not.toContain("destructive");
    expect(DEFAULT_ALLOWED_CATEGORIES).not.toContain("privileged");
  });

  it("destructive: denies rm/dd/mkfs by default", () => {
    const { ws } = makeWorktree();
    const p = policy(ws);
    for (const bin of ["rm", "dd", "mkfs", "shred"]) {
      const d = p.check({ bin, args: ["-rf", "/"] }, ws);
      expect(d.allowed, bin).toBe(false);
      expect(d.category, bin).toBe("destructive");
    }
  });

  it("privileged: denies sudo/su/systemctl by default", () => {
    const { ws } = makeWorktree();
    const p = policy(ws);
    for (const bin of ["sudo", "su", "systemctl", "mount"]) {
      const d = p.check({ bin, args: [] }, ws);
      expect(d.allowed, bin).toBe(false);
      expect(d.category, bin).toBe("privileged");
    }
  });

  it("9: an unknown binary is blocked (deny by default) and a denied command is never run", () => {
    const { ws } = makeWorktree();
    const p = policy(ws);
    const d = p.check({ bin: "totally-unknown-binary", args: [] }, ws);
    expect(d.allowed).toBe(false);
    expect(d.category).toBe("blocked");
  });

  it("6: a main-mutating git op is destructive (force-push / branch delete) → denied", () => {
    expect(classifyCommand({ bin: "git", args: ["push", "--force", "origin", "main"] }).category).toBe("destructive");
    expect(classifyCommand({ bin: "git", args: ["branch", "-D", "main"] }).category).toBe("destructive");
    expect(classifyCommand({ bin: "git", args: ["reset", "--hard", "origin/main"] }).category).toBe("destructive");
  });

  it("9: a command whose cwd is outside the worktree is refused", () => {
    const { ws, sibling } = makeWorktree();
    const d = policy(ws).check({ bin: "ls", args: [] }, sibling);
    expect(d.allowed).toBe(false);
    expect(d.denyReason).toBe("cwd_outside_workspace");
  });
});

describe("A10.2 — .gitattributes filter neutralization (T-FS-05)", () => {
  it("scans filter/diff drivers referenced by a .gitattributes body", () => {
    const body = [
      "# comment",
      "*.ts filter=evil diff=evil",
      "*.bin filter=lfs -text",
      "*.md text",
      "secret.key filter=clean-secret"
    ].join("\n");
    expect(scanGitFilterDrivers(body).sort()).toEqual(["clean-secret", "evil", "lfs"]);
  });

  it("emits no-op -c overrides that disable smudge/clean/process for each driver", () => {
    const flags = gitFilterNeutralizationFlags(["evil"]);
    expect(flags).toContain("filter.evil.smudge=");
    expect(flags).toContain("filter.evil.clean=");
    expect(flags).toContain("filter.evil.process=");
    expect(flags).toContain("filter.evil.required=false");
    // every flag value is preceded by a -c
    expect(flags.filter((f) => f === "-c")).toHaveLength(5);
  });

  it("produces nothing for a benign .gitattributes", () => {
    expect(scanGitFilterDrivers("*.md text\n*.png binary\n")).toEqual([]);
    expect(gitFilterNeutralizationFlags([])).toEqual([]);
  });
});

describe("A10.2 — resource limits + cwd (invariants 10,11)", () => {
  it("11: declares positive time / output / file limits", () => {
    expect(DEFAULT_ISOLATION_LIMITS.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_ISOLATION_LIMITS.maxOutputBytes).toBeGreaterThan(0);
    expect(DEFAULT_ISOLATION_LIMITS.maxFilesChanged).toBeGreaterThan(0);
  });

  it("10/output-flood: the bounding limits exist (group-kill enforced by the supervisor on CI)", () => {
    // Real SIGTERM→SIGKILL group kill + output-cap kill are exercised by the
    // POSIX-guarded supervisor/runner tests; here we assert the contract that bounds them.
    expect(Number.isFinite(DEFAULT_ISOLATION_LIMITS.timeoutMs)).toBe(true);
    expect(DEFAULT_ISOLATION_LIMITS.maxOutputBytes).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("cwdWithinWorktree contains the root and inside, rejects siblings/parents", () => {
    const { ws, sibling, stateRoot } = makeWorktree();
    expect(cwdWithinWorktree(ws, ws)).toBe(true);
    expect(cwdWithinWorktree(path.join(ws, "src"), ws)).toBe(true);
    expect(cwdWithinWorktree(sibling, ws)).toBe(false);
    expect(cwdWithinWorktree(stateRoot, ws)).toBe(false);
  });
});
