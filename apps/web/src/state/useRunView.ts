/**
 * useRunView (A11 redesign) — loads an integrated run by id, polls it live until it
 * reaches a terminal state, and derives every honest view-model the monitoring UI needs
 * (integrated view, stage progress, dual-agent activity). Also mirrors the latest status
 * into the local run registry so the Dashboard/Historial stay in sync.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getIntegratedRun, getIntegratedTimeline, cancelIntegratedRun } from "../integratedApi.js";
import {
  deriveIntegratedRunView,
  type IntegratedRunEventDTO,
  type IntegratedRunRecordDTO,
  type IntegratedRunView
} from "../lib/integratedRun.js";
import { deriveRunProgress, type RunProgressView } from "../lib/runProgress.js";
import { deriveAgentActivity, type AgentActivityView } from "../lib/agentActivity.js";
import { upsertRun } from "./runsStore.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "blocked"]);

export interface RunViewState {
  record: IntegratedRunRecordDTO | null;
  events: IntegratedRunEventDTO[];
  view: IntegratedRunView | null;
  progress: RunProgressView | null;
  agents: AgentActivityView | null;
  loading: boolean;
  error: string | null;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useRunView(runId: string | null): RunViewState {
  const [record, setRecord] = useState<IntegratedRunRecordDTO | null>(null);
  const [events, setEvents] = useState<IntegratedRunEventDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(runId));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      const [rec, tl] = await Promise.all([
        getIntegratedRun(id) as Promise<IntegratedRunRecordDTO>,
        getIntegratedTimeline(id) as Promise<{ events: IntegratedRunEventDTO[] }>
      ]);
      setRecord(rec);
      setEvents(tl.events);
      setError(null);
      upsertRun({
        id: rec.id,
        status: rec.status,
        objective: rec.spec.objective,
        owner: rec.spec.owner,
        reviewer: rec.spec.reviewer,
        providerMode: rec.spec.providerMode as "mock" | "real",
        collaborationMode: rec.spec.collaborationMode as "specialist" | "pair"
      });
      if (TERMINAL.has(rec.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!runId) {
      setRecord(null);
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void load(runId);
    pollRef.current = setInterval(() => void load(runId), 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [runId, load]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    try {
      await cancelIntegratedRun(runId);
      await load(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, load]);

  const refresh = useCallback(async () => {
    if (runId) await load(runId);
  }, [runId, load]);

  const view = record ? deriveIntegratedRunView(record, events) : null;
  const progress = record ? deriveRunProgress(record.status, events) : null;
  const agents = record ? deriveAgentActivity(events, record.spec.owner, record.spec.reviewer) : null;

  return { record, events, view, progress, agents, loading, error, cancel, refresh };
}
