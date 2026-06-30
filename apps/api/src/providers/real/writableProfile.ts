/**
 * Writable execution profile + authorization (A10.3, mandate §7).
 *
 * The real adapters are read-only by default and REFUSE `readOnly:false`. A controlled
 * writable execution profile lifts that refusal for a single run ONLY when every
 * precondition holds — there is no silent permission mixing:
 *
 *  1. the adapter actually has a writable argv builder (`supportsWritable`);
 *  2. an OBSERVED real writable capability snapshot authorizes it — `write === "yes"`
 *     for THIS provider, taken from a real `getCapabilities()` probe;
 *  3. the snapshot's `cliVersion` matches the version the adapter is built for — a
 *     version change INVALIDATES the snapshot (ADR 0054 §4);
 *  4. a complete 6-field A0.5 `CapabilityBinding` is present; and
 *  5. the request carries an explicit `cwd` inside the authorized worktree.
 *
 * Without an observed snapshot (the reality until the owner authenticates the real
 * CLIs), authorization fails and the adapter refuses exactly as in A3. A fixture
 * snapshot exercises the MECHANISM (verified_fixture); only a real authenticated probe
 * yields `verified_real_provider`.
 */

import type {
  AgentExecutionRequest,
  CapabilityBinding,
  CapabilitySnapshot,
  ProviderId
} from "@triforge/shared";
import path from "node:path";

export interface WritableProfile {
  /** Observed REAL writable capability snapshot (from a real getCapabilities probe). */
  observedCapability: CapabilitySnapshot;
  /** The 6-field A0.5 capability binding authorizing this writable run. */
  binding: CapabilityBinding;
  /** The worktree root the writable `cwd` must stay inside. */
  worktreeRoot: string;
}

export type WritableAuthorization =
  | { authorized: true }
  | { authorized: false; message: string };

export interface WritableContext {
  provider: ProviderId;
  /** The version the adapter (and its capability fixture) is built for. */
  knownVersion: string;
  /** Whether the adapter has a writable argv builder at all. */
  supportsWritable: boolean;
}

/** True when `cwd` is the worktree root or strictly inside it (lexical containment). */
function cwdWithin(cwd: string, worktreeRoot: string): boolean {
  const root = path.resolve(worktreeRoot);
  const c = path.resolve(cwd);
  return c === root || c.startsWith(root + path.sep);
}

/** A structurally complete A0.5 binding (the 6 closure fields are all present). */
function isCompleteBinding(b: CapabilityBinding | undefined): boolean {
  return (
    b !== undefined &&
    Array.isArray(b.threat) &&
    b.threat.length > 0 &&
    Array.isArray(b.control) &&
    b.control.length > 0 &&
    typeof b.milestone === "string" &&
    b.milestone.length > 0 &&
    Array.isArray(b.verification) &&
    b.verification.length > 0 &&
    typeof b.recovery === "string" &&
    b.recovery.length > 0 &&
    typeof b.residualRisk === "string" &&
    b.residualRisk.length > 0
  );
}

/**
 * Decide whether a writable (`readOnly:false`) request is authorized. A non-writable
 * request is always authorized (read-only is the safe default and is handled
 * elsewhere). Pure + deterministic. The refusal messages for the "no support" and "no
 * profile" cases deliberately mention the A0.5 capability binding so callers can map
 * them to the existing boundary contract.
 */
export function authorizeWritable(
  profile: WritableProfile | undefined,
  ctx: WritableContext,
  request: AgentExecutionRequest
): WritableAuthorization {
  if (request.readOnly !== false) {
    return { authorized: true };
  }
  if (!ctx.supportsWritable) {
    return {
      authorized: false,
      message:
        "writable provider execution is not authorized: this adapter has no writable profile and requires the A0.5 capability binding"
    };
  }
  if (profile === undefined) {
    return {
      authorized: false,
      message:
        "writable provider execution is not authorized: no observed writable capability snapshot and A0.5 capability binding (read-only adapter)"
    };
  }
  const cap = profile.observedCapability;
  if (cap.provider !== ctx.provider) {
    return {
      authorized: false,
      message: `writable capability snapshot is for ${cap.provider}, not ${ctx.provider}`
    };
  }
  if (cap.write !== "yes") {
    return {
      authorized: false,
      message: `writable capability not observed (write=${cap.write}); a real authenticated capability snapshot is required`
    };
  }
  if (cap.cliVersion === null || cap.cliVersion !== ctx.knownVersion) {
    return {
      authorized: false,
      message: `writable capability snapshot invalidated by version drift (snapshot=${cap.cliVersion ?? "null"}, expected=${ctx.knownVersion})`
    };
  }
  if (!isCompleteBinding(profile.binding)) {
    return {
      authorized: false,
      message: "writable execution requires a complete A0.5 capability binding"
    };
  }
  if (request.cwd === null || request.cwd === "") {
    return {
      authorized: false,
      message: "writable execution requires an explicit worktree cwd"
    };
  }
  if (!cwdWithin(request.cwd, profile.worktreeRoot)) {
    return { authorized: false, message: "writable cwd is outside the authorized worktree" };
  }
  return { authorized: true };
}
