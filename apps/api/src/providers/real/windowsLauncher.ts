/**
 * A10-W.6 — deterministic provider-launcher resolution (ADR 0056).
 *
 * On Windows, an npm-installed CLI is reachable on PATH only through shims:
 * `codex` (a bash shim), `codex.cmd` and `codex.ps1`. None of those may be used to
 * launch the real provider from the writable runtime:
 *
 *  - the `.ps1` shim swallows piped stdout (we lose the JSONL event stream);
 *  - the `.cmd` shim must be run through `cmd.exe /c <shim> <args>`, which re-parses
 *    the argv as a shell line — the `.cmd` argument-injection class (CVE-2024-27980 /
 *    Node DEP0190). The provider objective is untrusted free text WITH spaces, so
 *    that path is unsafe by construction.
 *
 * The robust, injection-free resolution is to spawn the REAL program directly with
 * `shell:false` and a separated argv:
 *
 *  - `claude`  → the native `bin/claude.exe` inside the package (run directly);
 *  - `codex`   → `bin/codex.js` run via `node <codex.js>` (the JS entry, not a shim).
 *
 * Both are located deterministically under the npm global bin directory (the
 * directory that holds the resolved shim). If a real `.exe` is already on PATH it is
 * used directly. If nothing resolves, the bare name is returned so the spawn fails
 * cleanly as a `spawn_error` (never a silent `.cmd`/`.ps1` fallback).
 *
 * Pure + injectable: the PATH probe (`which`) and existence check are injected so the
 * resolution logic is unit-testable on any OS without a real codex/claude install.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** A safe, separated launcher: an executable plus argv that PRECEDES the CLI args. */
export interface ResolvedLauncher {
  /** The program to spawn directly (shell:false). */
  readonly executable: string;
  /** Argv prepended before the adapter's CLI args (e.g. the codex.js path for node). */
  readonly prefixArgs: readonly string[];
}

export interface LauncherResolverDeps {
  /** OS id (defaults to the running platform). */
  platform?: NodeJS.Platform;
  /** Return every PATH match for `bin` (defaults to `where` on win32). */
  which?: (bin: string) => string[];
  /** Existence predicate for a resolved package entry (defaults to fs.existsSync). */
  exists?: (p: string) => boolean;
  /** The `node` executable to run a `.js` entry with (defaults to process.execPath). */
  nodeExecPath?: string;
}

/** How each provider's real program is located under the npm global bin directory. */
const WINDOWS_PROVIDER_TARGETS: Readonly<
  Record<string, { readonly kind: "node" | "exe"; readonly rel: string }>
> = {
  codex: { kind: "node", rel: "node_modules/@openai/codex/bin/codex.js" },
  claude: { kind: "exe", rel: "node_modules/@anthropic-ai/claude-code/bin/claude.exe" }
};

/** Strip directory + a `.exe`/`.cmd`/`.bat`/`.ps1` suffix; lowercase. */
function binKey(bin: string): string {
  const base = bin.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

/** Default Windows PATH probe: `where <bin>`, returning every match (trimmed). */
function defaultWhich(bin: string): string[] {
  const r = spawnSync("where", [bin], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  if (r.status !== 0 || typeof r.stdout !== "string") {
    return [];
  }
  return r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve the safe launcher for a provider binary name.
 *
 * win32: prefer a real `.exe` already on PATH; else locate the package entry under
 * the npm global bin directory (codex → `node codex.js`; claude → `claude.exe`).
 * Never resolves to a `.cmd`/`.ps1` shim. Non-win32: the bare name (POSIX spawns the
 * shim/binary directly without the `.cmd` re-parsing hazard).
 */
export function resolveProviderLauncher(bin: string, deps: LauncherResolverDeps = {}): ResolvedLauncher {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return { executable: bin, prefixArgs: [] };
  }
  const which = deps.which ?? defaultWhich;
  const exists = deps.exists ?? existsSync;
  const nodeExecPath = deps.nodeExecPath ?? process.execPath;

  const matches = which(bin);

  // A real executable already on PATH (not a .ps1 shim) is safe to spawn directly.
  const directExe = matches.find((p) => p.toLowerCase().endsWith(".exe"));
  if (directExe !== undefined) {
    return { executable: directExe, prefixArgs: [] };
  }

  // Otherwise locate the package's real entry under the npm global bin directory
  // (the directory holding the resolved shim). Use win32 path semantics explicitly so
  // the resolution is correct on a real Windows host AND unit-testable on Linux CI.
  const binDir = matches.length > 0 ? path.win32.dirname(matches[0]) : null;
  const target = WINDOWS_PROVIDER_TARGETS[binKey(bin)];
  if (binDir !== null && target !== undefined) {
    const full = path.win32.join(binDir, ...target.rel.split("/"));
    if (exists(full)) {
      return target.kind === "node"
        ? { executable: nodeExecPath, prefixArgs: [full] }
        : { executable: full, prefixArgs: [] };
    }
  }

  // Nothing resolved safely: return the bare name so the spawn fails as a
  // spawn_error rather than silently falling back to a .cmd/.ps1 shim.
  return { executable: bin, prefixArgs: [] };
}
