/**
 * IntegratedRunService (A10-W.8b) — the productionized writable pipeline behind the
 * API/UI. Submits a task, selects a provider (mock OR capability-gated real), runs it
 * over an isolated worktree on the Windows substrate, streams sequence-numbered events
 * to the store, and persists the terminal report. Reconstructable from the store alone
 * (mandate §8): the basis for the UI timeline and restart recovery.
 *
 * No silent real->mock fallback: a `real` run whose owner is not write-capable /
 * authenticated terminates `blocked`, never a mock execution dressed up as real.
 */

import type { CapabilitySnapshot, ProviderId } from "@triforge/shared";
import type { Clock } from "../../providers/clock.js";
import { createConfiguredAdapter, type ProviderMode } from "../../providers/configuredAdapter.js";
import type { ProcessRunner } from "../../providers/real/processRunner.js";
import type { GitRunner } from "../worktree/index.js";
import type { CommandPolicyConfig } from "../command/index.js";
import { runWritableTask } from "../e2e/writableRun.js";
import { buildRunPlan, INTEGRATED_BINDING, type RunControls, type StageSink } from "./runCallbacks.js";
import {
  TERMINAL_RUN_STATUSES,
  type IntegratedRunEvent,
  type IntegratedRunRecord,
  type IntegratedRunSpec,
  type IntegratedRunStore,
  type ProviderProvenance
} from "./types.js";

export interface IntegratedRunDeps {
  store: IntegratedRunStore;
  gitRunner: GitRunner;
  /** Process runner for quality gates (Trusted runner in prod; Fake in tests). */
  processRunner: ProcessRunner;
  clock: Clock;
  stateRoot: string;
  /** Wall-clock ISO timestamp source (injected for determinism in tests). */
  now: () => string;
  /** Run id generator (uuid in prod; deterministic in tests). */
  newId: () => string;
  /** Env allowlist for real gate commands (PATH/ComSpec/...); credential names stripped. */
  envAllowlist?: string[];
  /** Command policy for quality gates (defaults applied by CommandPolicy if omitted). */
  commandConfig?: CommandPolicyConfig;
}

interface InflightRun {
  cancelRequested: boolean;
  cancelHooks: Array<() => Promise<void>>;
}

export class IntegratedRunService {
  private readonly inflight = new Map<string, InflightRun>();

  constructor(private readonly deps: IntegratedRunDeps) {}

  /** Create a run (status=created). Does not execute. */
  async create(spec: IntegratedRunSpec): Promise<IntegratedRunRecord> {
    const record: IntegratedRunRecord = {
      id: this.deps.newId(),
      status: "created",
      spec,
      ownerProvenance: null,
      reviewerProvenance: null,
      report: null,
      terminalReason: null,
      createdAt: this.deps.now(),
      startedAt: null,
      completedAt: null
    };
    await this.deps.store.create(record);
    return record;
  }

  async get(id: string): Promise<IntegratedRunRecord | null> {
    return this.deps.store.get(id);
  }

  async timeline(id: string): Promise<IntegratedRunEvent[]> {
    return this.deps.store.listEvents(id);
  }

  /**
   * Start (and run to terminal) the run. Streams events; persists the terminal report.
   * Returns the final record. Throws only for a missing/already-started run.
   */
  async start(id: string): Promise<IntegratedRunRecord> {
    const record = await this.deps.store.get(id);
    if (!record) {
      throw new Error(`integrated run ${id} not found`);
    }
    if (record.status !== "created") {
      throw new Error(`integrated run ${id} is ${record.status}, not startable`);
    }

    const spec = record.spec;
    const mode = spec.providerMode;
    const inflight: InflightRun = { cancelRequested: false, cancelHooks: [] };
    this.inflight.set(id, inflight);

    await this.deps.store.patch(id, { status: "running", startedAt: this.deps.now() });

    // --- provider selection + provenance (no silent fallback) ---
    let ownerProvenance: ProviderProvenance | null = null;
    let reviewerProvenance: ProviderProvenance | null = null;
    let ownerSnapshot: CapabilitySnapshot | null = null;

    // Sequence-numbered, restart-safe event sink.
    let seq = await this.deps.store.maxSequence(id);
    const provenanceFor = (provider: ProviderId | null | undefined): ProviderProvenance | null => {
      if (provider && provider === spec.owner) return ownerProvenance;
      if (provider && provider === spec.reviewer) return reviewerProvenance;
      return null;
    };
    const sink: StageSink = async (e) => {
      seq += 1;
      const prov = provenanceFor(e.provider ?? null);
      await this.deps.store.appendEvent(id, {
        sequenceNumber: seq,
        type: e.type,
        provider: e.provider ?? null,
        providerVersion: prov?.version ?? null,
        payload: e.payload,
        at: this.deps.now()
      });
    };

    try {
      if (mode === "real") {
        const ownerAdapter = createConfiguredAdapter(spec.owner, "real");
        const caps = (await ownerAdapter.getCapabilities()) as CapabilitySnapshot;
        ownerSnapshot = caps;
        ownerProvenance = { provider: spec.owner, mode, version: caps.cliVersion ?? "unknown", isReal: true };
        const reviewerCaps = (await createConfiguredAdapter(spec.reviewer, "real").getCapabilities()) as CapabilitySnapshot;
        reviewerProvenance = { provider: spec.reviewer, mode, version: reviewerCaps.cliVersion ?? "unknown", isReal: true };
        if (caps.write !== "yes") {
          return await this.block(id, sink, `owner ${spec.owner} is not write-capable/authenticated (write=${caps.write}); real run refused (no mock fallback)`);
        }
      } else {
        ownerProvenance = { provider: spec.owner, mode, version: `mock-${spec.owner}`, isReal: false };
        reviewerProvenance = { provider: spec.reviewer, mode, version: `mock-${spec.reviewer}`, isReal: false };
      }
    } catch (err) {
      return await this.block(id, sink, `provider selection failed: ${sanitize(err)}`);
    }

    await this.deps.store.patch(id, { ownerProvenance, reviewerProvenance });
    await sink({ type: "run.started", payload: { objective: spec.objective, collaborationMode: spec.collaborationMode } });
    await sink({
      type: "provider.selected",
      payload: {
        mode,
        owner: ownerProvenance,
        reviewer: reviewerProvenance,
        readPaths: spec.readPaths,
        writePaths: spec.writePaths,
        maxFilesChanged: spec.maxFilesChanged,
        budget: spec.budget
      }
    });

    const controls: RunControls = {
      register: (cancel) => inflight.cancelHooks.push(cancel),
      isCancelRequested: () => inflight.cancelRequested
    };

    try {
      const plan = buildRunPlan(spec, mode, sink, this.deps.gitRunner, ownerSnapshot, controls);
      const report = await runWritableTask({
        baseRepoPath: spec.fixtureRepoPath,
        stateRoot: this.deps.stateRoot,
        runId: id,
        taskId: "t1",
        owner: spec.owner,
        reviewer: spec.reviewer,
        task: spec.objective,
        pathPolicy: {
          readPaths: spec.readPaths,
          writePaths: spec.writePaths,
          blockedPaths: spec.blockedPaths,
          maxFilesChanged: spec.maxFilesChanged
        },
        gates: spec.gates,
        processRunner: this.deps.processRunner,
        envAllowlist: this.deps.envAllowlist,
        commandConfig: this.deps.commandConfig,
        ownerImplement: plan.ownerImplement,
        reviewerReview: plan.reviewerReview,
        clock: this.deps.clock,
        gitRunner: this.deps.gitRunner,
        maxRepairRounds: spec.budget.maxRepairRounds,
        onEvent: sink,
        captureDiff: true,
        capabilityBinding: INTEGRATED_BINDING
      });

      if (inflight.cancelRequested) {
        const completedAt = this.deps.now();
        await sink({ type: "run.cancelled", payload: { verdict: report.governance.verdict, merged: report.merged } });
        await this.deps.store.patch(id, { status: "cancelled", report, terminalReason: "cancelled by request", completedAt });
        return (await this.deps.store.get(id))!;
      }

      const terminalReason = `verdict=${report.governance.verdict}; merged=${report.merged}; repair=${report.repairState}`;
      await sink({
        type: "run.completed",
        payload: {
          verdict: report.governance.verdict,
          merged: report.merged,
          repairState: report.repairState,
          ledgerEntryCount: report.ledgerEntryCount,
          changedFiles: report.changedFiles,
          cleanedUp: report.cleanedUp
        }
      });
      await this.deps.store.patch(id, { status: "completed", report, terminalReason, completedAt: this.deps.now() });
      return (await this.deps.store.get(id))!;
    } catch (err) {
      const reason = inflight.cancelRequested ? "cancelled by request" : `run failed: ${sanitize(err)}`;
      const status = inflight.cancelRequested ? "cancelled" : "failed";
      await sink({ type: inflight.cancelRequested ? "run.cancelled" : "run.failed", payload: { reason } });
      await this.deps.store.patch(id, { status, terminalReason: reason, completedAt: this.deps.now() });
      return (await this.deps.store.get(id))!;
    } finally {
      this.inflight.delete(id);
    }
  }

  /** Cancel a run. Idempotent on a terminal run. Interrupts an in-flight real execution. */
  async cancel(id: string): Promise<IntegratedRunRecord> {
    const record = await this.deps.store.get(id);
    if (!record) {
      throw new Error(`integrated run ${id} not found`);
    }
    if (TERMINAL_RUN_STATUSES.includes(record.status)) {
      return record; // idempotent
    }
    const inflight = this.inflight.get(id);
    if (inflight) {
      inflight.cancelRequested = true;
      for (const hook of inflight.cancelHooks) {
        try {
          await hook();
        } catch {
          /* best-effort cancel */
        }
      }
      return (await this.deps.store.get(id))!; // start() finalizes the terminal state
    }
    // created-but-not-started, or running with no live process (e.g. after a restart):
    let seq = await this.deps.store.maxSequence(id);
    await this.deps.store.appendEvent(id, {
      sequenceNumber: seq + 1,
      type: "run.cancelled",
      provider: null,
      providerVersion: null,
      payload: { reason: "cancelled (no live execution)" },
      at: this.deps.now()
    });
    await this.deps.store.patch(id, { status: "cancelled", terminalReason: "cancelled (no live execution)", completedAt: this.deps.now() });
    return (await this.deps.store.get(id))!;
  }

  /**
   * Reconstruct a run from the store after a process restart (mandate §12). A run left
   * `running` with no live process is reconciled to a single terminal (`failed`,
   * interrupted) — never duplicating a terminal event and never re-merging.
   */
  async recover(id: string): Promise<{ record: IntegratedRunRecord; events: IntegratedRunEvent[] }> {
    const record = await this.deps.store.get(id);
    if (!record) {
      throw new Error(`integrated run ${id} not found`);
    }
    const events = await this.deps.store.listEvents(id);
    if (record.status === "running" && !this.inflight.has(id)) {
      const hasTerminal = events.some((e) => e.type === "run.completed" || e.type === "run.failed" || e.type === "run.cancelled");
      if (!hasTerminal) {
        const seq = await this.deps.store.maxSequence(id);
        await this.deps.store.appendEvent(id, {
          sequenceNumber: seq + 1,
          type: "run.failed",
          provider: null,
          providerVersion: null,
          payload: { reason: "interrupted by restart; reconstructed from the store" },
          at: this.deps.now()
        });
        await this.deps.store.patch(id, { status: "failed", terminalReason: "interrupted by restart", completedAt: this.deps.now() });
      }
      return { record: (await this.deps.store.get(id))!, events: await this.deps.store.listEvents(id) };
    }
    return { record, events };
  }

  /** Structured artifacts view derived from the persisted record (no process memory). */
  async artifacts(id: string): Promise<Record<string, unknown> | null> {
    const record = await this.deps.store.get(id);
    if (!record) {
      return null;
    }
    const r = record.report;
    return {
      runId: record.id,
      status: record.status,
      providerMode: record.spec.providerMode,
      owner: record.ownerProvenance,
      reviewer: record.reviewerProvenance,
      collaborationMode: record.spec.collaborationMode,
      governanceVerdict: r?.governance.verdict ?? "unknown",
      merged: r?.merged ?? false,
      repairState: r?.repairState ?? "unknown",
      ledgerEntryCount: r?.ledgerEntryCount ?? 0,
      reconciledTampered: r?.reconciledTampered ?? null,
      gateTampered: r?.gateTampered ?? null,
      cleanedUp: r?.cleanedUp ?? null,
      changedFiles: r?.changedFiles ?? [],
      terminalReason: record.terminalReason
    };
  }

  /** Diff view: changed files + (captured) unified patch text for the UI. */
  async diff(id: string): Promise<{ changedFiles: { path: string; status: string }[]; patch: string | null } | null> {
    const record = await this.deps.store.get(id);
    if (!record) {
      return null;
    }
    return {
      changedFiles: record.report?.changedFiles ?? [],
      patch: record.report?.diffText ?? null
    };
  }

  private async block(id: string, sink: StageSink, reason: string): Promise<IntegratedRunRecord> {
    await sink({ type: "run.blocked", payload: { reason } });
    await this.deps.store.patch(id, { status: "blocked", terminalReason: reason, completedAt: this.deps.now() });
    this.inflight.delete(id);
    return (await this.deps.store.get(id))!;
  }
}

function sanitize(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[ -]/g, " ").slice(0, 300);
}
