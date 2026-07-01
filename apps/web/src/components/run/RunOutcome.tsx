/**
 * Run outcome (A11 redesign) — governance verdict, merge/cleanup, changed files and the
 * captured diff. Values come straight from the honest integrated view; the diff text is
 * sanitized (secrets masked, control/ANSI stripped) and line-coloured. `unknown` is shown
 * as "desconocido", never fabricated as a value. The documented E2E data-testids are kept.
 */

import React from "react";
import { Badge, EmptyState } from "../ui/index.js";
import { IconFile, IconGavel } from "../brand/icons.js";
import { safeText } from "../../lib/sanitize.js";
import { verdictLabelEs, verdictTone } from "../../lib/labels.js";
import type { IntegratedRunView } from "../../lib/integratedRun.js";

function boolLabel(v: boolean | "unknown"): string {
  return v === "unknown" ? "desconocido" : v ? "sí" : "no";
}
function boolTone(v: boolean | "unknown"): "success" | "neutral" | "warning" {
  return v === "unknown" ? "neutral" : v ? "success" : "warning";
}

function DiffView({ text }: { text: string }): JSX.Element {
  const safe = safeText(text, 40_000);
  const lines = safe.text.split("\n");
  return (
    <div className="tf-diff" data-testid="diff">
      <pre>
        {lines.map((ln, i) => {
          const cls = ln.startsWith("+") && !ln.startsWith("+++")
            ? "tf-diff__line--add"
            : ln.startsWith("-") && !ln.startsWith("---")
              ? "tf-diff__line--del"
              : ln.startsWith("@@")
                ? "tf-diff__line--hunk"
                : undefined;
          return (
            <span key={i} className={cls}>
              {ln + "\n"}
            </span>
          );
        })}
        {safe.truncated ? "…[diff truncado]\n" : ""}
      </pre>
    </div>
  );
}

export function RunOutcome({ view, diffText }: { view: IntegratedRunView; diffText: string | null }): JSX.Element {
  return (
    <div className="tf-stack" style={{ gap: "var(--tf-space-6)" }}>
      <div className="tf-kv">
        <div className="tf-kv__item">
          <span className="tf-kv__k">Gobernanza</span>
          <span className="tf-kv__v" data-testid="governance-verdict">
            <Badge tone={verdictTone(view.governanceVerdict)} dot>
              {verdictLabelEs(view.governanceVerdict)}
            </Badge>
          </span>
        </div>
        <div className="tf-kv__item">
          <span className="tf-kv__k">Merge</span>
          <span className="tf-kv__v" data-testid="merged">
            <Badge tone={boolTone(view.merged)}>{boolLabel(view.merged)}</Badge>
          </span>
        </div>
        <div className="tf-kv__item">
          <span className="tf-kv__k">Limpieza</span>
          <span className="tf-kv__v" data-testid="cleanup">
            <Badge tone={boolTone(view.cleanup)}>{boolLabel(view.cleanup)}</Badge>
          </span>
        </div>
        <div className="tf-kv__item">
          <span className="tf-kv__k">Diff</span>
          <span className="tf-kv__v tf-mono">
            {view.diff.present ? `${String(view.diff.lineCount)} líneas` : "desconocido"}
          </span>
        </div>
      </div>

      {view.terminalReason ? (
        <div className="tf-alert tf-alert--info" data-testid="terminal-reason">
          <span className="tf-mono" style={{ fontSize: "0.82rem" }}>{view.terminalReason}</span>
        </div>
      ) : null}

      <div>
        <div className="tf-row tf-between" style={{ marginBottom: "var(--tf-space-3)" }}>
          <h4 className="tf-row" style={{ gap: 8 }}>
            <IconFile size={16} /> Ficheros modificados ({view.changedFiles.length})
          </h4>
        </div>
        <div className="tf-files" data-testid="changed-files">
          {view.changedFiles.length === 0 ? (
            <EmptyState icon={<IconFile size={18} />} title="Sin cambios registrados" />
          ) : (
            view.changedFiles.map((f) => (
              <div className="tf-file" key={f.path} data-status={f.status}>
                <span className="tf-file__tag" data-s={f.status}>{f.status}</span>
                <span className="tf-file__path tf-grow">{f.path}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="tf-row" style={{ gap: 8, marginBottom: "var(--tf-space-3)" }}>
          <IconGavel size={16} /> Diff capturado
        </h4>
        {diffText ? (
          <DiffView text={diffText} />
        ) : (
          <div className="tf-diff" data-testid="diff">
            <pre style={{ color: "var(--tf-text-muted)" }}>sin diff capturado (desconocido)</pre>
          </div>
        )}
      </div>
    </div>
  );
}
