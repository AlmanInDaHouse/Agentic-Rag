/**
 * A8.3 Run Timeline (mandate §10 A8.3).
 *
 * Renders the run events in SEQUENCE order (via `buildTimeline`), surfaces gaps and
 * deduped duplicates, and renders the already-sanitized type/detail. Presentational.
 */

import { buildTimeline, type RunEvent } from "../lib/runTimeline.js";

export function RunTimeline({ events }: { events: RunEvent[] }): JSX.Element {
  const view = buildTimeline(events);
  return (
    <section aria-label="Run timeline" className="run-timeline">
      <h2>Run timeline</h2>
      {view.gaps.length > 0 ? (
        <p className="warn" role="alert">
          {`sequence gap: missing event(s) ${view.gaps.join(", ")}`}
        </p>
      ) : null}
      {view.duplicateSequences.length > 0 ? (
        <p className="warn">{`deduped duplicate sequence(s): ${view.duplicateSequences.join(", ")}`}</p>
      ) : null}
      <ol className="timeline">
        {view.entries.map((e) => (
          <li key={e.sequenceNumber} data-type={e.type}>
            <span className="seq">#{e.sequenceNumber}</span>
            <span className="type">{e.type}</span>
            <span className="provider">{e.provider}</span>
            <span className="ts">{e.timestamp}</span>
            {e.detail ? <span className="detail">{e.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
