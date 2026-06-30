/**
 * Configured provider-adapter selection (A10-W.8b).
 *
 * The single seam where the integrated runtime chooses between the deterministic MOCK
 * adapters and the capability-gated REAL adapters. The choice is EXPLICIT (a typed
 * `ProviderMode`, sourced from `TRIFORGE_PROVIDER_MODE` or a per-run override) — never
 * inferred, and there is NO silent real->mock fallback: a caller that asks for `real`
 * gets a real adapter (or an error), so a mock execution can never masquerade as real.
 *
 * Provenance is first-class: `describeConfiguredProvider` returns the mode + the adapter
 * identity/version so every run record and every emitted event can carry honest
 * "who actually executed this" metadata.
 */

import type { ProviderAdapter, ProviderId } from "@triforge/shared";
import { MockCodexAdapter, MockClaudeAdapter } from "./mock/mockAdapter.js";
import { createRealAdapter, type RealAdapterFactoryOptions } from "./real/index.js";

export type ProviderMode = "mock" | "real";

export interface ConfiguredAdapterOptions {
  /** Real-adapter options (writable profile, injected runner). Ignored in mock mode. */
  real?: RealAdapterFactoryOptions;
  /** Mock scenario id; defaults to the happy path. Ignored in real mode. */
  mockScenario?: "success";
}

/**
 * Build the adapter for `provider` under `mode`. Mock mode returns a deterministic
 * scenario adapter; real mode returns the capability-gated real adapter. Throws for an
 * unknown provider/mode — it never degrades `real` to `mock`.
 */
export function createConfiguredAdapter(
  provider: ProviderId,
  mode: ProviderMode,
  options: ConfiguredAdapterOptions = {}
): ProviderAdapter {
  if (mode === "real") {
    return createRealAdapter(provider, options.real ?? {});
  }
  if (mode === "mock") {
    const scenario = options.mockScenario ?? "success";
    switch (provider) {
      case "codex":
        return new MockCodexAdapter({ scenario });
      case "claude":
        return new MockClaudeAdapter({ scenario });
      default:
        throw new Error(`no mock adapter is registered for provider "${String(provider)}"`);
    }
  }
  throw new Error(`unknown provider mode "${String(mode)}"`);
}

export interface ConfiguredProviderIdentity {
  provider: ProviderId;
  mode: ProviderMode;
  /** The adapter-reported CLI version (real probe) or the mock identity string. */
  version: string;
  /** True only for a real, authenticated CLI run. */
  isReal: boolean;
}

/**
 * Probe the configured adapter's identity (its `getCapabilities().cliVersion`). For a
 * real adapter this is a cheap version probe against the live CLI; for a mock it is the
 * fixed mock version. The returned `isReal` flag is the authoritative provenance bit.
 */
export async function describeConfiguredProvider(
  provider: ProviderId,
  mode: ProviderMode,
  options: ConfiguredAdapterOptions = {}
): Promise<ConfiguredProviderIdentity> {
  const adapter = createConfiguredAdapter(provider, mode, options);
  let version = mode === "real" ? "unknown" : `mock-${provider}`;
  try {
    const caps = await adapter.getCapabilities();
    if (caps && typeof caps.cliVersion === "string" && caps.cliVersion.trim() !== "") {
      version = caps.cliVersion;
    }
  } catch {
    // A real probe that fails leaves version "unknown" — never fabricated.
  }
  return { provider, mode, version, isReal: mode === "real" };
}
