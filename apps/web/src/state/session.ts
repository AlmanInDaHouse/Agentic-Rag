/**
 * Demo session state (A11 redesign).
 *
 * HONEST BY DESIGN: TriForge's backend has no authentication. "Iniciar sesión" here is a
 * purely client-side demo gate (a localStorage flag) so the product can present a login
 * surface without pretending real auth exists. Social login (Google/GitHub) is visual
 * only and never sets a session. Nothing here authenticates a real user.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY = "triforge.demo-session";

export interface DemoSession {
  active: boolean;
  since: string | null;
}

function read(): DemoSession {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { active: false, since: null };
    const parsed = JSON.parse(raw) as Partial<DemoSession>;
    return { active: parsed.active === true, since: typeof parsed.since === "string" ? parsed.since : null };
  } catch {
    return { active: false, since: null };
  }
}

const listeners = new Set<() => void>();
let snapshot: DemoSession = read();

function emit(): void {
  snapshot = read();
  listeners.forEach((l) => l());
}

export function enterDemo(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ active: true, since: new Date().toISOString() }));
  } catch {
    /* storage may be unavailable; session stays in-memory for this tab */
  }
  emit();
}

export function leaveDemo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
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

export function useSession(): { session: DemoSession; enter: () => void; leave: () => void } {
  const session = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return { session, enter: useCallback(enterDemo, []), leave: useCallback(leaveDemo, []) };
}
