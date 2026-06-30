/**
 * A10-W — Execution platform boundary (api). Re-exports the concrete Node-backed
 * platforms and the factory. The contract lives in `@triforge/shared`.
 */
export { PosixExecutionPlatform, WindowsExecutionPlatform } from "./nodeExecutionPlatform.js";
export { detectExecutionPlatform } from "./detectPlatform.js";
