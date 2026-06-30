/**
 * A10-W.7 — `ProcessRunner` for TRUSTED quality-gate commands on Windows.
 *
 * Quality-gate commands come from TRUSTED run/repo configuration (GateSpec), NOT from
 * provider output, and have already been classified+allowed by the Safe Command Policy
 * before they reach a runner. The Windows wrinkle: an allowed test/build runner
 * (`npm`/`pnpm`/`vitest`/`tsc`) is usually a `.cmd` shim, not a directly-spawnable
 * `.exe`. `NodeProcessRunner` spawns `shell:false`, so a bare `npm` fails to launch.
 *
 * This runner resolves the command first: a real `.exe` is spawned directly; a
 * `.cmd`/`.bat` shim runs through `cmd.exe /d /s /c <shim> <args>`. Because the argv is
 * TRUSTED CONFIG (never the free-text provider objective), the `.cmd` path is safe here
 * — this is exactly the distinction `windowsLauncher` draws for the provider objective,
 * which NEVER touches a `.cmd`. The resolved spec is then delegated to an inner
 * `ProcessRunner` (the real `NodeProcessRunner` by default), which keeps the timeout,
 * output cap, env allowlist and process-tree cancellation semantics.
 */

import { spawnSync } from "node:child_process";
import { NodeProcessRunner } from "../../providers/real/processRunner.js";
import type { ProcessRunner, ProcessRunSpec, RunningProcess } from "../../providers/real/processRunner.js";

/** All PATH matches for `bin` on Windows (via `where`), trimmed. */
function whichAll(bin: string): string[] {
  const r = spawnSync("where", [bin], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  if (r.status !== 0 || typeof r.stdout !== "string") {
    return [];
  }
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Resolve a trusted command to a spawnable {bin, prefixArgs} on the given platform. */
export function resolveTrustedCommand(
  bin: string,
  deps: { platform?: NodeJS.Platform; which?: (bin: string) => string[] } = {}
): { bin: string; prefixArgs: string[] } {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return { bin, prefixArgs: [] };
  }
  // An absolute/relative path that already names a concrete file: trust it as-is.
  if (/[/\\]/.test(bin) && /\.(exe)$/i.test(bin)) {
    return { bin, prefixArgs: [] };
  }
  const which = deps.which ?? whichAll;
  const matches = which(bin);
  const exe = matches.find((p) => p.toLowerCase().endsWith(".exe"));
  if (exe !== undefined) {
    return { bin: exe, prefixArgs: [] };
  }
  const shim = matches.find((p) => /\.(cmd|bat)$/i.test(p));
  if (shim !== undefined) {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    // `/d /c` (NOT `/d /s /c`): with `/s` cmd.exe re-strips outer quotes and mis-parses
    // a shim PATH containing spaces ("C:\Program Files\…"), splitting at the space. The
    // `/d /c` form lets Node's cmd-specific argv quoting and cmd's default rules align
    // (matches `tooling/triforge-cli/doctor.mjs`, proven on this host).
    return { bin: comspec, prefixArgs: ["/d", "/c", shim] };
  }
  // Nothing resolved: pass the bare name through (the spawn fails cleanly).
  return { bin, prefixArgs: [] };
}

export class TrustedCommandRunner implements ProcessRunner {
  private readonly inner: ProcessRunner;
  private readonly platform: NodeJS.Platform;

  constructor(options: { inner?: ProcessRunner; platform?: NodeJS.Platform } = {}) {
    this.inner = options.inner ?? new NodeProcessRunner();
    this.platform = options.platform ?? process.platform;
  }

  run(spec: ProcessRunSpec): RunningProcess {
    const resolved = resolveTrustedCommand(spec.bin, { platform: this.platform });
    return this.inner.run({
      ...spec,
      bin: resolved.bin,
      args: [...resolved.prefixArgs, ...spec.args]
    });
  }
}
