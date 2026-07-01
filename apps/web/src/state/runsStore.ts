/**
 * Local run registry (A11 redesign).
 *
 * HONEST SCOPE: the backend exposes a run by id but has no "list all runs" endpoint, so
 * the Dashboard / Historial can only show runs THIS browser has created. We persist a
 * light summary per created run to localStorage and label it clearly as local-session
 * history in the UI. We never invent runs we didn't create.
 */

import { useSyncExternalStore } from "react";

export interface RunSummary {
  id: string;
  objective: string;
  owner: string;
  reviewer: string;
  providerMode: "mock" | "real";
  collaborationMode: "specialist" | "pair";
  status: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = "triforge.local-runs";
const MAX = 50;

function read(): RunSummary[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as RunSummary[]).filter((r) => r && typeof r.id === "string") : [];
  } catch {
    return [];
  }
}

function write(list: RunSummary[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();
let snapshot: RunSummary[] = read();

function emit(): void {
  snapshot = read();
  listeners.forEach((l) => l());
}

/** Insert or update a run summary (newest first). */
export function upsertRun(patch: Partial<RunSummary> & { id: string }): void {
  const now = new Date().toISOString();
  const list = read();
  const idx = list.findIndex((r) => r.id === patch.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch, updatedAt: now };
  } else {
    list.unshift({
      id: patch.id,
      objective: patch.objective ?? "(sin objetivo)",
      owner: patch.owner ?? "codex",
      reviewer: patch.reviewer ?? "claude",
      providerMode: (patch.providerMode as RunSummary["providerMode"]) ?? "mock",
      collaborationMode: (patch.collaborationMode as RunSummary["collaborationMode"]) ?? "specialist",
      status: patch.status ?? "created",
      createdAt: patch.createdAt ?? now,
      updatedAt: now
    });
  }
  write(list);
  emit();
}

export function clearRuns(): void {
  write([]);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRuns(): RunSummary[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
