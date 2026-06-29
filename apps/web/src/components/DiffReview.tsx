/**
 * A8.5 Diff & Review (mandate §10 A8.5).
 *
 * Renders the complete diff (via `buildDiffReview`) — NEVER hiding a changed file —
 * with binary/deleted/renamed markers, truncation warnings, per-file findings, the
 * gate status, repair rounds, and a changed-after-review banner. Presentational.
 */

import { buildDiffReview, type DiffReviewInput } from "../lib/diffReview.js";

export function DiffReview({ review }: { review: DiffReviewInput }): JSX.Element {
  const v = buildDiffReview(review);
  return (
    <section aria-label="Diff and review" className="diff-review">
      <h2>Diff &amp; review</h2>
      <p>
        {`${v.fileCount} file(s) · gate=${v.gateOverall} · repair rounds=${v.repairRounds}`}
      </p>
      {v.changedAfterReview ? (
        <p className="warn" role="alert">
          diff changed AFTER review (diff-hash ≠ reviewed-hash) — re-review required
        </p>
      ) : null}
      <ul className="diff-files">
        {v.files.map((f) => (
          <li key={f.path} data-status={f.status}>
            <span className="path">{f.renamedFrom ? `${f.renamedFrom} → ${f.path}` : f.path}</span>
            <span className="status">{f.status}</span>
            {f.findings.map((fd, i) => (
              <span className="finding" data-severity={fd.severity} key={i}>{`${fd.severity}: ${fd.message}`}</span>
            ))}
            {f.isBinary ? (
              <span className="binary">[binary]</span>
            ) : (
              <pre className="patch">
                {f.patch.text}
                {f.patch.truncated ? "\n…[diff truncated]" : ""}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
