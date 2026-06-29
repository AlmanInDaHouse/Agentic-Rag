/**
 * A8.4 Artifact Explorer (mandate §10 A8.4).
 *
 * Lists ALL 12 A1 artifacts + the mutation ledger + raw evidence references (via
 * `buildArtifactExplorer`) — never hiding one. Present artifacts show a sanitized
 * summary + their hashes/refs; absent ones are shown explicitly as absent.
 * Presentational.
 */

import { buildArtifactExplorer, type RunArtifacts } from "../lib/artifactExplorer.js";

export function ArtifactExplorer({ artifacts }: { artifacts: RunArtifacts }): JSX.Element {
  const view = buildArtifactExplorer(artifacts);
  return (
    <section aria-label="Artifact explorer" className="artifact-explorer">
      <h2>Artifacts</h2>
      <ul>
        {view.views.map((a) => (
          <li key={a.kind} data-kind={a.kind} data-present={a.present}>
            <span className="kind">{a.kind}</span>
            {a.present ? (
              <>
                <span className="summary">{a.summary}</span>
                {a.refs.map((r, i) => (
                  <span className="ref" key={i}>{`${r.label}: ${r.value}`}</span>
                ))}
              </>
            ) : (
              <span className="absent">absent</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
