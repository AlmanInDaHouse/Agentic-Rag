/**
 * A10-W.1 — Execution platform factory.
 *
 * Selects the concrete {@link ExecutionPlatform} for the current (or an explicitly
 * supplied) OS. `win32` → {@link WindowsExecutionPlatform} (the initial supported
 * substrate, ADR 0056); everything else → {@link PosixExecutionPlatform} (legacy /
 * future, ADR 0030). This is the ONLY place a raw `process.platform` check should
 * live; the rest of the codebase depends on the interface.
 */

import type { ExecutionPlatform } from "@triforge/shared";
import { PosixExecutionPlatform, WindowsExecutionPlatform } from "./nodeExecutionPlatform.js";

/** Build the execution platform for a given OS id (defaults to the running OS). */
export function detectExecutionPlatform(
  platform: NodeJS.Platform = process.platform
): ExecutionPlatform {
  return platform === "win32" ? new WindowsExecutionPlatform() : new PosixExecutionPlatform();
}
