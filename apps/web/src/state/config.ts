/**
 * Runtime config + system-health probe (A11 redesign).
 * The API base URL matches the integrated API client. The health hook polls the backend
 * `/health` route so the topbar/dashboard can show an HONEST system status (online /
 * offline / checking) rather than assuming the backend is up.
 */

import { useEffect, useState } from "react";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

export type SystemStatus = "checking" | "online" | "offline";

export function useSystemHealth(pollMs = 15000): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>("checking");
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const ping = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { method: "GET" });
        if (!cancelled) setStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    };
    void ping();
    timer = setInterval(() => void ping(), pollMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);
  return status;
}
