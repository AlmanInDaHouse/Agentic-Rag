/**
 * Lightweight hash-based navigation (A11 redesign) — no router dependency. Views map to
 * `#/<view>[/<runId>]`. `useNavigation()` subscribes to `hashchange` via
 * useSyncExternalStore so the whole app reacts to back/forward and `navigate()` calls.
 */

import { useCallback, useSyncExternalStore } from "react";

export type ViewId = "dashboard" | "new-run" | "monitoring" | "history" | "agents" | "settings";

export interface Route {
  view: ViewId;
  runId: string | null;
}

const KNOWN: ViewId[] = ["dashboard", "new-run", "monitoring", "history", "agents", "settings"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = (KNOWN as string[]).includes(raw[0]) ? (raw[0] as ViewId) : "dashboard";
  const runId = view === "monitoring" && raw[1] ? decodeURIComponent(raw[1]) : null;
  return { view, runId };
}

export function routeToHash(route: Route): string {
  if (route.view === "monitoring" && route.runId) {
    return `#/monitoring/${encodeURIComponent(route.runId)}`;
  }
  return `#/${route.view}`;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

function getSnapshot(): string {
  return window.location.hash || "#/dashboard";
}

export function navigate(view: ViewId, runId?: string): void {
  window.location.hash = routeToHash({ view, runId: runId ?? null });
}

export function useNavigation(): { route: Route; navigate: typeof navigate } {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => "#/dashboard");
  const nav = useCallback((view: ViewId, runId?: string) => navigate(view, runId), []);
  return { route: parseHash(hash), navigate: nav };
}
