/**
 * TriForge dashboard (A8) — the product interface for the writable-execution runtime.
 *
 * Grows across A8.1–A8.8 (provider status, task composer, run timeline, artifact
 * explorer, diff/review, governance dashboard, budget/quota, recovery). It composes the
 * presentational panels over the stable A1 contracts; each panel renders only what the
 * backend reports and invents no state. Mounted as the TriForge view in a later A8 step
 * (kept separate from the legacy context dashboard in `App.tsx` for now).
 */

import { ProviderStatusPanel } from "./ProviderStatus.js";
import type { ProviderStatusSnapshot } from "../lib/providerStatus.js";

export interface TriforgeDashboardProps {
  providerStatus: ProviderStatusSnapshot[];
}

export function TriforgeDashboard({ providerStatus }: TriforgeDashboardProps): JSX.Element {
  return (
    <main className="triforge-dashboard">
      <h1>TriForge</h1>
      <ProviderStatusPanel snapshots={providerStatus} />
    </main>
  );
}
