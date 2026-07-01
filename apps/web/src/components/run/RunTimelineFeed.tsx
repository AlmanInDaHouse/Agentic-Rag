/**
 * Run timeline feed (A11 redesign) — the full, sequence-ordered event log rendered as a
 * vertical rail with per-event nodes, Spanish labels, provider attribution and sanitized
 * detail. Events are shown exactly in persisted order; a detected sequence gap is flagged
 * upstream (never silently filled).
 */

import React from "react";
import {
  IconMessage,
  IconFile,
  IconGavel,
  IconSearch,
  IconTool,
  IconAlert,
  IconSparkle,
  IconGitMerge,
  IconCheck,
  IconX,
  IconClock
} from "../brand/icons.js";
import { eventMeta, eventLabel, providerDisplayName, providerTone, type Tone } from "../../lib/labels.js";
import type { TimelineEventView } from "../../lib/integratedRun.js";

type NodeTone = "success" | "danger" | "warning" | "running" | "neutral" | "codex" | "claude";

function nodeTone(type: string, provider: string | null): NodeTone {
  if (type === "run.completed" || type === "merge.completed") return "success";
  if (type === "run.failed") return "danger";
  if (type === "run.blocked" || type === "run.cancelled" || type === "warning.raised") return "warning";
  if (provider) return providerTone(provider) === "claude" ? "claude" : providerTone(provider) === "codex" ? "codex" : "neutral";
  const t: Tone = eventMeta(type).tone;
  if (t === "success" || t === "danger" || t === "warning" || t === "running") return t;
  return "neutral";
}

function nodeIcon(type: string): JSX.Element {
  const kind = eventMeta(type).kind;
  if (type === "run.completed") return <IconCheck size={15} />;
  if (type === "run.failed") return <IconX size={15} />;
  if (type === "merge.completed" || type === "merge.skipped") return <IconGitMerge size={15} />;
  switch (kind) {
    case "change":
      return <IconFile size={15} />;
    case "decision":
      return <IconGavel size={15} />;
    case "finding":
      return <IconSearch size={15} />;
    case "tool":
      return <IconTool size={15} />;
    case "warning":
      return <IconAlert size={15} />;
    case "message":
      return <IconMessage size={15} />;
    case "quota":
      return <IconClock size={15} />;
    default:
      return <IconSparkle size={15} />;
  }
}

export function RunTimelineFeed({ events }: { events: TimelineEventView[] }): JSX.Element {
  if (events.length === 0) {
    return <p className="tf-muted">Sin eventos todavía.</p>;
  }
  return (
    <div className="tf-timeline" aria-label="Cronología de la ejecución">
      {events.map((e) => (
        <div className="tf-tl" key={e.sequenceNumber} data-seq={e.sequenceNumber} data-type={e.type}>
          <div className="tf-tl__rail">
            <span className="tf-tl__node" data-tone={nodeTone(e.type, e.provider)}>
              {nodeIcon(e.type)}
            </span>
            <span className="tf-tl__seq">#{e.sequenceNumber}</span>
          </div>
          <div className="tf-tl__card">
            <div className="tf-tl__row">
              <span className="tf-tl__label">{eventLabel(e.type)}</span>
              <span className="tf-tl__type tf-mono">{e.type}</span>
              {e.provider ? (
                <span className={`tf-badge tf-badge--${providerTone(e.provider) === "claude" ? "claude" : "codex"}`}>
                  {providerDisplayName(e.provider)}
                  {e.providerVersion ? ` · ${e.providerVersion}` : ""}
                </span>
              ) : null}
            </div>
            {e.detail ? (
              <div className="tf-tl__detail">
                {e.detail}
                {e.detailTruncated ? " …[truncado]" : ""}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
