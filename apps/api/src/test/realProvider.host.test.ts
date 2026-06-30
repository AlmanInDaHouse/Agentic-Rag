/**
 * A10-W.6 — REAL Codex & Claude provider runs on the native Windows host.
 *
 * This is the `verified_real_provider` evidence for codex_windows_{readonly,writable}
 * and claude_windows_{readonly,writable}. It drives the REAL adapters through
 * `createRealAdapter` (PlatformProcessRunner → Job Object supervision, safe executable
 * resolution, credential-stripped restricted environment) against the live, installed,
 * authenticated CLIs.
 *
 * DOUBLE-GATED: `win32` AND `TRIFORGE_REAL_PROVIDER=1`. It never runs in CI (ubuntu,
 * no codex/claude, no auth) and never burns provider quota by accident. Run locally:
 *
 *   $env:TRIFORGE_REAL_PROVIDER = "1"
 *   corepack pnpm --filter @triforge/api exec vitest run realProvider.host
 *
 * Subscription auth ONLY: the runner strips OPENAI_API_KEY / ANTHROPIC_API_KEY, so
 * codex runs on ChatGPT and claude on claude.ai OAuth (apiKeySource:none). Claude uses
 * `--model sonnet` to conserve the 7-day quota; codex uses its configured default.
 * No secrets are read; raw evidence is the normalized event stream.
 */

import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentExecutionRequestSchema,
  type AgentExecutionRequest,
  type CapabilityBinding,
  type CapabilitySnapshot,
  type ProviderEvent,
  type ProviderId
} from "@triforge/shared";
import { createRealAdapter, type WritableProfile } from "../providers/real/index.js";

const RUN = process.platform === "win32" && process.env.TRIFORGE_REAL_PROVIDER === "1";
const CLAUDE_MODEL = "sonnet"; // conserve the 7-day Claude Max quota in real runs
const EXPECTED_VERSION: Record<string, string> = { codex: "0.142.4", claude: "2.1.195" };

const tempDirs: string[] = [];
function makeGitWorktree(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tf-rp-"));
  execFileSync("git", ["init", "-q", dir], { windowsHide: true });
  execFileSync("git", ["-C", dir, "config", "user.email", "probe@local"], { windowsHide: true });
  execFileSync("git", ["-C", dir, "config", "user.name", "probe"], { windowsHide: true });
  execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-qm", "init"], { windowsHide: true });
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const BINDING: CapabilityBinding = {
  threat: ["T-INT-14"],
  control: ["A10-W.2 path policy", "A10-W.4 Job Object", "A5.5 mutation ledger"],
  milestone: "A10-W.6",
  verification: ["realProvider.host.test.ts"],
  recovery: "revert the worktree branch",
  residualRisk: "RR-4"
};

let seq = 0;
function req(provider: ProviderId, over: Record<string, unknown> = {}): AgentExecutionRequest {
  seq += 1;
  return AgentExecutionRequestSchema.parse({
    executionId: `rp-${provider}-${seq}`,
    provider,
    objective: "Reply with exactly the single word PONG. Do not modify files.",
    timeoutMs: 180_000,
    readOnly: true,
    ...(provider === "claude" ? { model: CLAUDE_MODEL } : {}),
    ...over
  });
}

/** Build a writable profile from the REAL observed capability snapshot (write must be yes). */
async function writableProfile(provider: ProviderId, worktreeRoot: string): Promise<WritableProfile> {
  const observed = (await createRealAdapter(provider).getCapabilities()) as CapabilitySnapshot;
  expect(observed.write).toBe("yes");
  return { observedCapability: observed, binding: BINDING, worktreeRoot };
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of stream) {
    out.push(e);
  }
  return out;
}

function gitStatus(wt: string): string {
  return execFileSync("git", ["-C", wt, "status", "--porcelain=v1"], { encoding: "utf8", windowsHide: true }).trim();
}

describe.runIf(RUN)("A10-W.6 — real provider runs on native Windows (verified_real_provider)", () => {
  for (const provider of ["codex", "claude"] as ProviderId[]) {
    it(`${provider}: available + authenticated + observed snapshot (write=yes, version pinned)`, async () => {
      const adapter = createRealAdapter(provider);
      const avail = await adapter.checkAvailability();
      expect(avail.status).toBe("available");
      expect(avail.cliVersion).toBe(EXPECTED_VERSION[provider]);

      const auth = await adapter.checkAuthentication();
      expect(auth.state).toBe("authenticated");

      const caps = await adapter.getCapabilities();
      expect(caps.cliVersion).toBe(EXPECTED_VERSION[provider]);
      expect(caps.readOnly).toBe("yes");
      expect(caps.write).toBe("yes");
      expect(caps.eventStream).toBe("yes");
    }, 60_000);

    it(`${provider}: read-only run completes and changes no files in the worktree`, async () => {
      const wt = makeGitWorktree();
      const events = await collect(createRealAdapter(provider).execute(req(provider, { cwd: wt })));
      expect(events[0].type).toBe("run.started");
      expect(events[events.length - 1].type).toBe("run.completed");
      expect(events.some((e) => e.type === "file.changed")).toBe(false);
      expect(gitStatus(wt)).toBe(""); // worktree untouched
    }, 180_000);

    it(`${provider}: writable run actually writes the target file inside the worktree`, async () => {
      const wt = makeGitWorktree();
      const profile = await writableProfile(provider, wt);
      const adapter = createRealAdapter(provider, { writableProfile: profile });
      const target = `hello-${provider}.txt`;
      const events = await collect(
        adapter.execute(
          req(provider, {
            cwd: wt,
            readOnly: false,
            objective: `Create a file named ${target} in the working directory containing exactly the text HELLO and nothing else. Then stop.`
          })
        )
      );
      expect(events[events.length - 1].type).toBe("run.completed");
      // The filesystem is the authority for "a write happened" (mutation ledger uses the
      // worktree diff, not provider events).
      expect(existsSync(path.join(wt, target))).toBe(true);
      expect(readFileSync(path.join(wt, target), "utf8")).toContain("HELLO");
      // The filesystem (above) is the AUTHORITY that a write happened — the mutation
      // ledger reconciles against the worktree diff, not provider events. The event
      // stream must also reflect tool activity, but its SHAPE varies: codex may surface
      // a file_change (file.changed) OR a command_execution (tool.*) depending on how it
      // performs the edit; claude writes via the Write tool (tool.*). Assert "did real
      // tool work", not one specific event kind.
      const didWork = events.some(
        (e) => e.type === "file.changed" || e.type === "tool.started" || e.type === "tool.completed"
      );
      expect(didWork, "writable run should surface file.changed or tool activity").toBe(true);
    }, 240_000);
  }

  it("codex: cancellation stops emission with exactly one terminal (Job Object reap)", async () => {
    const wt = makeGitWorktree();
    const adapter = createRealAdapter("codex");
    const request = req("codex", {
      cwd: wt,
      objective: "Count slowly from 1 to 30, writing one number per line with a short pause between each."
    });
    const events: ProviderEvent[] = [];
    let cancelled = false;
    for await (const e of adapter.execute(request)) {
      events.push(e);
      if (!cancelled && e.type !== "run.started") {
        cancelled = true;
        await adapter.cancel(request.executionId);
      }
    }
    const terminals = events.filter((e) => e.type === "run.completed" || e.type === "run.failed");
    expect(terminals).toHaveLength(1); // exactly one terminal, no events after it
    const terminal = events[events.length - 1];
    expect(["run.completed", "run.failed"]).toContain(terminal.type);
    if (terminal.type === "run.failed") {
      expect((terminal.payload as { errorCode: string }).errorCode).toBe("cancelled");
    }
  }, 120_000);

  it("reviewer (read-only adapter, no profile) refuses a writable run BEFORE any spawn", async () => {
    const wt = makeGitWorktree();
    const events = await collect(
      createRealAdapter("claude").execute(req("claude", { cwd: wt, readOnly: false, objective: "edit the code" }))
    );
    const terminal = events[events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { errorCode: string }).errorCode).toBe("request_rejected");
  }, 30_000);

  it("writable run with cwd OUTSIDE the authorized worktree is refused", async () => {
    const wt = makeGitWorktree();
    const other = makeGitWorktree();
    const profile = await writableProfile("codex", wt);
    const events = await collect(
      createRealAdapter("codex", { writableProfile: profile }).execute(
        req("codex", { cwd: other, readOnly: false, objective: "edit the code" })
      )
    );
    const terminal = events[events.length - 1];
    expect(terminal.type).toBe("run.failed");
    expect((terminal.payload as { message: string }).message).toMatch(/outside the authorized worktree/);
  }, 30_000);
});
