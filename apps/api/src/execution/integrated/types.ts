/**
 * Integrated runtime domain model (A10-W.8b).
 *
 * The integrated run is the productionized writable pipeline: a task submitted through
 * the API/UI is profiled, routed, assigned a provider (mock OR the capability-gated real
 * adapter), executed on the Windows substrate over an isolated worktree, and streamed as
 * a sequence-numbered event log persisted to a store. The run is reconstructable purely
 * from the store — never from process memory (mandate §8) — which is what enables
 * restart recovery and the UI timeline.
 */

import type { ProviderId } from "@triforge/shared";
import type { ProviderMode } from "../../providers/configuredAdapter.js";
import type { GateSpec } from "../gates/index.js";
import type { WritableRunReport } from "../e2e/writableRun.js";

export type CollaborationModeName = "specialist" | "pair";

export type IntegratedRunStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export const TERMINAL_RUN_STATUSES: readonly IntegratedRunStatus[] = ["completed", "failed", "cancelled", "blocked"];

export interface IntegratedRunBudget {
  maxRepairRounds: number;
  perRunTimeoutMs: number;
}

/** Validated task submission (the backend re-validates; never trusts the client). */
export interface IntegratedRunSpec {
  objective: string;
  owner: ProviderId;
  reviewer: ProviderId;
  providerMode: ProviderMode;
  collaborationMode: CollaborationModeName;
  /** Disposable base git repo the worktree is cut from — NEVER the TriForge tree. */
  fixtureRepoPath: string;
  /** Workspace-relative prefixes the owner may write (e.g. ["src"]). */
  writePaths: string[];
  readPaths: string[];
  blockedPaths: string[];
  maxFilesChanged: number;
  gates: GateSpec[];
  ownerModel: string | null;
  reviewerModel: string | null;
  budget: IntegratedRunBudget;
}

/** Honest "who actually executed this" provenance attached to the run + every event. */
export interface ProviderProvenance {
  provider: ProviderId;
  mode: ProviderMode;
  version: string;
  isReal: boolean;
}

export interface IntegratedRunEvent {
  sequenceNumber: number;
  type: string;
  provider: ProviderId | null;
  providerVersion: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export interface IntegratedRunRecord {
  id: string;
  status: IntegratedRunStatus;
  spec: IntegratedRunSpec;
  ownerProvenance: ProviderProvenance | null;
  reviewerProvenance: ProviderProvenance | null;
  report: WritableRunReport | null;
  terminalReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface IntegratedRunPatch {
  status?: IntegratedRunStatus;
  ownerProvenance?: ProviderProvenance | null;
  reviewerProvenance?: ProviderProvenance | null;
  report?: WritableRunReport | null;
  terminalReason?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

/**
 * Persistence boundary. A run + its events are reconstructable from the store alone.
 * The in-memory implementation backs tests/CI; the Pg implementation (A10-W.8b.2) backs
 * the running server and survives a process restart.
 */
export interface IntegratedRunStore {
  create(record: IntegratedRunRecord): Promise<void>;
  get(id: string): Promise<IntegratedRunRecord | null>;
  patch(id: string, patch: IntegratedRunPatch): Promise<void>;
  appendEvent(runId: string, event: IntegratedRunEvent): Promise<void>;
  listEvents(runId: string): Promise<IntegratedRunEvent[]>;
  /** Highest sequence number persisted for a run (0 if none) — for restart-safe append. */
  maxSequence(runId: string): Promise<number>;
}
