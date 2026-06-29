/**
 * A8.7 Budget & Quota (mandate §10 A8.7).
 *
 * Shows each provider's budget/quota signals SEPARATELY and HONESTLY (via
 * `buildBudgetQuotaView`): configured, reserved, consumed, remaining, status, confidence,
 * provider-reported signal, and a reset time only when reliable. Presentational.
 */

import { buildBudgetQuotaView, type QuotaSnapshotInput } from "../lib/budgetQuota.js";

export function BudgetQuota({ snapshots }: { snapshots: QuotaSnapshotInput[] }): JSX.Element {
  const views = snapshots.map(buildBudgetQuotaView);
  return (
    <section aria-label="Budget and quota" className="budget-quota">
      <h2>Budget &amp; quota</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Configured</th>
            <th>Reserved</th>
            <th>Consumed</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Confidence</th>
            <th>Provider signal</th>
            <th>Reset</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.provider} data-provider={v.provider} data-status={v.statusLabel}>
              <td>{v.provider}</td>
              <td>{String(v.configured)}</td>
              <td>{v.reserved}</td>
              <td>{v.consumed}</td>
              <td data-confidence={v.confidence}>{String(v.remaining)}</td>
              <td>{v.statusLabel}</td>
              <td>{v.confidence}</td>
              <td>{v.providerReported}</td>
              <td>{v.reset}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
