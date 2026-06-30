/**
 * A10-W.6 — real provider adapter factory (the TRUSTED provider-launch boundary).
 *
 * Constructs a real Codex/Claude adapter wired to the production
 * {@link PlatformProcessRunner}, so a real provider runs under the native Windows
 * Job Object (A10-W.4) with a credential-stripped restricted environment (A10-W.5)
 * and a safely-resolved executable (A10-W.6, never a `.cmd`/`.ps1` shim).
 *
 * This is the orchestrator's entry point to LAUNCH a provider. It is deliberately
 * separate from the agent-facing Safe Command Policy (A10-W.5), which BLOCKS
 * `codex`/`claude` so an agent inside a run cannot recursively re-invoke a provider.
 * The orchestrator launches here (trusted); agent-proposed commands go through the
 * command policy (untrusted) — the two never share a path.
 */

import type { ProviderId } from "@triforge/shared";
import { ClaudeAdapter } from "./claudeAdapter.js";
import { CodexAdapter } from "./codexAdapter.js";
import { PlatformProcessRunner } from "./platformProcessRunner.js";
import type { ProcessRunner } from "./processRunner.js";
import type { RealAdapter, RealAdapterOptions } from "./realAdapter.js";

export interface RealAdapterFactoryOptions extends RealAdapterOptions {
  /**
   * Override the process runner. Defaults to {@link PlatformProcessRunner} over the
   * detected execution platform (Windows Job Object on win32). Tests inject a
   * FakeProcessRunner; the real host uses the default.
   */
  runner?: ProcessRunner;
}

/**
 * Build the real adapter for a provider, launched through the trusted boundary.
 * A writable run still requires a complete `writableProfile` (A10.3 / A0.5); without
 * it the adapter stays read-only and refuses `readOnly:false`.
 */
export function createRealAdapter(provider: ProviderId, options: RealAdapterFactoryOptions = {}): RealAdapter {
  const { runner, ...adapterOptions } = options;
  const processRunner = runner ?? new PlatformProcessRunner();
  switch (provider) {
    case "codex":
      return new CodexAdapter(processRunner, adapterOptions);
    case "claude":
      return new ClaudeAdapter(processRunner, adapterOptions);
    default:
      throw new Error(`no real adapter is registered for provider "${String(provider)}"`);
  }
}
