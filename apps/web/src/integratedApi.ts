/**
 * Integrated-runtime API client (A10-W.8b). Thin fetch wrappers over the backend's
 * /api/integrated-runs/* routes. Validation lives on the backend; the UI only renders.
 */

import type { IntegratedRunEventDTO, IntegratedRunRecordDTO } from "./lib/integratedRun.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body — a bodyless POST
  // (start/cancel/recover) with `content-type: application/json` is rejected by Fastify
  // as an empty JSON body (A10-W.8b).
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...init?.headers }
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface CreateIntegratedRunInput {
  objective: string;
  owner: string;
  reviewer: string;
  providerMode?: "mock" | "real";
  collaborationMode?: "specialist" | "pair";
  fixtureRepoPath: string;
  writePaths: string[];
  readPaths?: string[];
  blockedPaths?: string[];
  maxFilesChanged?: number;
  gates?: { name: string; command: { bin: string; args: string[] } }[];
  ownerModel?: string | null;
  reviewerModel?: string | null;
  budget?: { maxRepairRounds: number; perRunTimeoutMs: number };
}

export function createIntegratedRun(input: CreateIntegratedRunInput): Promise<{ id: string; status: string }> {
  return call("/api/integrated-runs", { method: "POST", body: JSON.stringify(input) });
}
export function startIntegratedRun(id: string): Promise<{ id: string; status: string }> {
  return call(`/api/integrated-runs/${id}/start`, { method: "POST" });
}
export function getIntegratedRun(id: string): Promise<IntegratedRunRecordDTO> {
  return call(`/api/integrated-runs/${id}`);
}
export function getIntegratedTimeline(id: string): Promise<{ events: IntegratedRunEventDTO[] }> {
  return call(`/api/integrated-runs/${id}/timeline`);
}
export function getIntegratedArtifacts(id: string): Promise<Record<string, unknown>> {
  return call(`/api/integrated-runs/${id}/artifacts`);
}
export function getIntegratedDiff(id: string): Promise<{ changedFiles: { path: string; status: string }[]; patch: string | null }> {
  return call(`/api/integrated-runs/${id}/diff`);
}
export function cancelIntegratedRun(id: string): Promise<IntegratedRunRecordDTO> {
  return call(`/api/integrated-runs/${id}/cancel`, { method: "POST" });
}
