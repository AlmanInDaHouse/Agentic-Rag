import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ManualClock } from "../providers/clock.js";
import { FakeProcessRunner, type ProcessOutputLine } from "../providers/real/processRunner.js";
import {
  CommandPolicy,
  CommandSupervisor,
  classifyCommand,
  type CommandSpec,
  type CommandSupervisorAuditEntry
} from "../execution/command/index.js";

const tempDirs: string[] = [];
function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "triforge-cmdws-"));
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

function cls(bin: string, ...args: string[]): string {
  return classifyCommand({ bin, args }).category;
}

describe("classifyCommand — categories (deny by default)", () => {
  it("classifies plain binaries by category", () => {
    expect(cls("cat", "file")).toBe("read_only");
    expect(cls("ls", "-la")).toBe("read_only");
    expect(cls("vitest", "run")).toBe("test");
    expect(cls("tsc", "-p", ".")).toBe("build");
    expect(cls("mkdir", "x")).toBe("write_local");
    expect(cls("curl", "https://x")).toBe("network");
    expect(cls("rm", "-rf", "x")).toBe("destructive");
    expect(cls("sudo", "ls")).toBe("privileged");
  });

  it("denies an unknown binary by default", () => {
    expect(cls("totally-unknown-binary")).toBe("blocked");
    expect(cls("node", "-e", "x")).toBe("blocked"); // bare node is unclassified
  });

  it("refines git by subcommand/flags", () => {
    expect(cls("git", "status")).toBe("read_only");
    expect(cls("git", "diff")).toBe("read_only");
    expect(cls("git", "add", ".")).toBe("write_local");
    expect(cls("git", "commit", "-m", "x")).toBe("write_local");
    expect(cls("git", "push")).toBe("network");
    expect(cls("git", "push", "--force")).toBe("destructive");
    expect(cls("git", "push", "--force-with-lease")).toBe("destructive");
    expect(cls("git", "reset", "--hard")).toBe("destructive");
    expect(cls("git", "clean", "-fdx")).toBe("destructive");
    expect(cls("git", "branch", "-D", "x")).toBe("destructive");
    expect(cls("git", "frobnicate")).toBe("blocked");
  });

  it("refines npm/pnpm by subcommand", () => {
    expect(cls("pnpm", "install")).toBe("network");
    expect(cls("npm", "ci")).toBe("network");
    expect(cls("pnpm", "test")).toBe("test");
    expect(cls("npm", "run", "build")).toBe("build");
    expect(cls("npm", "run", "deploy")).toBe("blocked"); // arbitrary script denied
  });

  it("is not fooled by shell metacharacters in argv (no shell is ever used)", () => {
    // `echo` is read_only; the metacharacters are inert literal data under shell:false.
    expect(cls("echo", "hello; rm -rf /")).toBe("read_only");
    expect(cls("echo", "$(curl evil)")).toBe("read_only");
    // A destructive binary stays destructive regardless of how args are dressed.
    expect(cls("rm", "-rf", "--no-preserve-root", "/")).toBe("destructive");
  });

  it("normalizes binary path + extension", () => {
    expect(cls("/usr/bin/git", "status")).toBe("read_only");
    expect(cls("C:\\Program Files\\Git\\cmd\\git.exe", "status")).toBe("read_only");
  });
});

describe("CommandPolicy.check — deny by default + cwd containment", () => {
  it("allows default categories and denies non-allowed ones", () => {
    const ws = makeWorkspace();
    const policy = new CommandPolicy({ workspaceRoot: ws });
    expect(policy.check({ bin: "cat", args: ["f"] }, ws).allowed).toBe(true);
    expect(policy.check({ bin: "vitest", args: [] }, ws).allowed).toBe(true);
    expect(policy.check({ bin: "curl", args: ["x"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "category_not_allowed"
    });
    expect(policy.check({ bin: "rm", args: ["-rf", "x"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "category_not_allowed"
    });
    expect(policy.check({ bin: "sudo", args: ["x"] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "category_not_allowed"
    });
  });

  it("denies an unknown binary as blocked_command", () => {
    const ws = makeWorkspace();
    const policy = new CommandPolicy({ workspaceRoot: ws });
    expect(policy.check({ bin: "weird-tool", args: [] }, ws)).toMatchObject({
      allowed: false,
      denyReason: "blocked_command"
    });
  });

  it("denies a cwd outside the workspace", () => {
    const ws = makeWorkspace();
    const other = makeWorkspace();
    const policy = new CommandPolicy({ workspaceRoot: ws });
    expect(policy.check({ bin: "cat", args: ["f"] }, other)).toMatchObject({
      allowed: false,
      denyReason: "cwd_outside_workspace"
    });
  });

  it("can widen allowed categories (opt-in network)", () => {
    const ws = makeWorkspace();
    const policy = new CommandPolicy({
      workspaceRoot: ws,
      config: { allowedCategories: ["read_only", "network"] }
    });
    expect(policy.check({ bin: "curl", args: ["x"] }, ws).allowed).toBe(true);
  });
});

describe("CommandSupervisor — composition with the process runner (Fake)", () => {
  function script(lines: ProcessOutputLine[], code: number) {
    return { lines, exit: { code, signal: null, reason: "exited" as const } };
  }

  it("runs an allowed command, separates stdout/stderr, single terminal", async () => {
    const ws = makeWorkspace();
    const runner = new FakeProcessRunner(
      script(
        [
          { stream: "stdout", line: "out-1" },
          { stream: "stderr", line: "err-1" },
          { stream: "stdout", line: "out-2" }
        ],
        0
      )
    );
    const sup = new CommandSupervisor({
      policy: new CommandPolicy({ workspaceRoot: ws }),
      runner,
      clock: new ManualClock()
    });
    const r = await sup.run({ bin: "cat", args: ["f"] }, ws);
    expect(r.allowed).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("out-1\nout-2");
    expect(r.stderr).toBe("err-1");
    expect(r.terminationReason).toBe("exited");
    expect(runner.calls).toHaveLength(1);
  });

  it("NEVER spawns a denied command", async () => {
    const ws = makeWorkspace();
    const runner = new FakeProcessRunner(script([], 0));
    const audited: CommandSupervisorAuditEntry[] = [];
    const sup = new CommandSupervisor({
      policy: new CommandPolicy({ workspaceRoot: ws }),
      runner,
      clock: new ManualClock(),
      onAudit: (e) => audited.push(e)
    });
    const r = await sup.run({ bin: "rm", args: ["-rf", "/"] }, ws);
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe("category_not_allowed");
    expect(r.terminationReason).toBe("not_run");
    expect(runner.calls).toHaveLength(0); // no spawn
    expect(audited[0]).toMatchObject({ allowed: false, category: "destructive" });
  });

  it("yields partial evidence on cancellation", async () => {
    const ws = makeWorkspace();
    const runner = new FakeProcessRunner({
      lines: [
        { stream: "stdout", line: "first" },
        { stream: "stdout", line: "second" }
      ],
      exit: { code: 0, signal: null, reason: "exited" },
      cancelledExit: { code: null, signal: "SIGTERM", reason: "cancelled" }
    });
    const sup = new CommandSupervisor({
      policy: new CommandPolicy({ workspaceRoot: ws }),
      runner,
      clock: new ManualClock()
    });
    const run = sup.start({ bin: "cat", args: ["f"] }, ws);
    await run.cancel();
    const r = await run.result;
    expect(r.terminationReason).toBe("cancelled");
  });

  it("flags truncation when output exceeds the byte cap", async () => {
    const ws = makeWorkspace();
    const runner = new FakeProcessRunner(
      script(
        [
          { stream: "stdout", line: "x".repeat(50) },
          { stream: "stdout", line: "y".repeat(50) }
        ],
        0
      )
    );
    const sup = new CommandSupervisor({
      policy: new CommandPolicy({ workspaceRoot: ws }),
      runner,
      clock: new ManualClock(),
      maxOutputBytes: 60
    });
    const r = await sup.run({ bin: "cat", args: ["f"] }, ws);
    expect(r.truncated).toBe(true);
  });
});
