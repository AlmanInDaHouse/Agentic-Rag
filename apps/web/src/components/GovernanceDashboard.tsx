/**
 * A8.6 Governance Dashboard (mandate §10 A8.6).
 *
 * Observes the governance of a run (via `buildGovernanceDashboard`): the merge verdict +
 * rationale, policy/command decisions, risk/quota state, rollback/cancel, and the human
 * override shown as AUDITED. Presentational; invents nothing.
 */

import { buildGovernanceDashboard, type GovernanceObservation } from "../lib/governanceDashboard.js";

export function GovernanceDashboard({ observation }: { observation: GovernanceObservation }): JSX.Element {
  const v = buildGovernanceDashboard(observation);
  return (
    <section aria-label="Governance" className="governance-dashboard">
      <h2>Governance</h2>
      {v.merge ? (
        <p className="merge-decision" data-verdict={v.merge.verdict}>
          {`merge decision: ${v.merge.verdict} — ${v.merge.rationale}`}
        </p>
      ) : (
        <p className="merge-decision">no governance decision yet</p>
      )}
      <p>{`risk: ${v.riskState} · quota: ${v.quotaState}${v.rollback ? " · rolled back" : ""}${v.cancelled ? " · cancelled" : ""}`}</p>
      <ul className="decisions">
        {v.decisions.map((d, i) => (
          <li key={i} data-kind={d.kind} data-outcome={d.outcome}>{`${d.kind}: ${d.outcome} — ${d.detail}`}</li>
        ))}
      </ul>
      {v.humanOverride ? (
        <p className="human-override" role="note">
          {`human override (audited): ${v.humanOverride.actor} @ ${v.humanOverride.at} — ${v.humanOverride.reason}`}
        </p>
      ) : null}
    </section>
  );
}
