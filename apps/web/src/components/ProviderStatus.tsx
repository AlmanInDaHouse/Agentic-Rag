/**
 * A8.1 Provider Status panel (mandate §10 A8.1).
 *
 * Presentational only — it renders the honest view-model from
 * `deriveProviderStatusView` and invents NO state the backend does not know (every
 * "unknown" / "never verified" comes from the snapshot, not a default). React escapes
 * all text children, and the view-model already strips control/ANSI from free text.
 */

import { deriveProviderStatusView, type ProviderStatusSnapshot } from "../lib/providerStatus.js";

export function ProviderStatusPanel({ snapshots }: { snapshots: ProviderStatusSnapshot[] }): JSX.Element {
  const views = snapshots.map(deriveProviderStatusView);
  return (
    <section aria-label="Provider status" className="provider-status">
      <h2>Providers</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Installed</th>
            <th>Version</th>
            <th>Auth</th>
            <th>Capabilities</th>
            <th>Quota</th>
            <th>Last verified</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.provider} data-provider={v.provider}>
              <td>{v.provider}</td>
              <td data-state={v.installed}>{v.installed}</td>
              <td>
                {v.version}
                {v.versionSupport === "unsupported" ? <span className="badge warn"> unsupported</span> : null}
              </td>
              <td data-state={v.authLabel}>{v.authLabel}</td>
              <td>{v.capabilities.known ? v.capabilities.value.join(", ") || "none" : "unknown"}</td>
              <td data-confidence={v.quota}>
                {v.quotaLabel}
                {v.quota !== "known" ? <span className="badge"> ({v.quota})</span> : null}
              </td>
              <td>{v.lastVerified}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {views.some((v) => v.warnings.length > 0) ? (
        <ul className="warnings" aria-label="Provider warnings">
          {views.flatMap((v) => v.warnings.map((w, i) => <li key={`${v.provider}-${i}`}>{`${v.provider}: ${w}`}</li>))}
        </ul>
      ) : null}
    </section>
  );
}
