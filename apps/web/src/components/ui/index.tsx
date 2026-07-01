/**
 * TriForge UI primitives (A11 redesign). Thin, typed, presentational building blocks
 * over the `tf-*` design-system classes. No external UI dependency.
 */

import React from "react";

type Div = React.HTMLAttributes<HTMLDivElement>;

/* ------------------------------------------------------------------ Card */
export type CardAccent = "none" | "cyan" | "primary" | "amber" | "purple";

export function Card({
  accent = "none",
  glow = false,
  className = "",
  children,
  ...rest
}: Div & { accent?: CardAccent; glow?: boolean }): JSX.Element {
  const cls = [
    "tf-card",
    accent !== "none" ? `tf-card--accent-${accent}` : "",
    glow ? "tf-card--glow" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}

export function CardHead({
  title,
  icon,
  action,
  className = ""
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`tf-card__head ${className}`}>
      <span className="tf-card__title">
        {icon ? <span className="tf-ico">{icon}</span> : null}
        {title}
      </span>
      {action}
    </div>
  );
}

export function CardBody({ className = "", children, ...rest }: Div): JSX.Element {
  return (
    <div className={`tf-card__body ${className}`} {...rest}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Button */
export type ButtonVariant = "default" | "primary" | "ghost" | "subtle" | "danger";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: React.ReactNode;
}
export function Button({
  variant = "default",
  size = "md",
  block = false,
  icon,
  className = "",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const cls = [
    "tf-btn",
    variant !== "default" ? `tf-btn--${variant}` : "",
    size === "sm" ? "tf-btn--sm" : size === "lg" ? "tf-btn--lg" : "",
    block ? "tf-btn--block" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Badge */
export type BadgeTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "running"
  | "neutral"
  | "codex"
  | "claude"
  | "outline";

export function Badge({
  tone = "neutral",
  dot = false,
  live = false,
  className = "",
  children,
  ...rest
}: {
  tone?: BadgeTone;
  dot?: boolean;
  live?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  // Spread native attributes (data-testid, aria-*, title…) so passthrough props reach
  // the DOM — the run-status/run-mode/collaboration-mode E2E selectors ride on Badge.
  return (
    <span className={`tf-badge tf-badge--${tone} ${live ? "tf-badge--live" : ""} ${className}`} {...rest}>
      {dot ? <span className="tf-badge__dot" /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "running" | "neutral" | "muted" }): JSX.Element {
  return <span className={`tf-dot tf-dot--${tone}`} aria-hidden />;
}

/* ---------------------------------------------------------------- Alert */
export function Alert({
  tone = "info",
  icon,
  className = "",
  children,
  ...rest
}: Div & { tone?: "danger" | "warning" | "info"; icon?: React.ReactNode }): JSX.Element {
  return (
    <div className={`tf-alert tf-alert--${tone} ${className}`} {...rest}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      <div className="tf-grow">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- States */
export function EmptyState({
  icon,
  title,
  children
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="tf-empty">
      {icon ? <div className="tf-empty__icon">{icon}</div> : null}
      <div className="tf-empty__title">{title}</div>
      {children ? <div style={{ maxWidth: "42ch" }}>{children}</div> : null}
    </div>
  );
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number | string; width?: number | string; radius?: number }): JSX.Element {
  return <div className="tf-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden />;
}

export function Spinner(): JSX.Element {
  return <span className="tf-spinner" aria-hidden />;
}

/* ------------------------------------------------------------- Progress */
export function ProgressBar({
  value,
  live = false,
  tone
}: {
  value: number;
  live?: boolean;
  tone?: "danger" | "blocked" | "success";
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="tf-progress__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="tf-progress__fill"
        style={{ width: `${pct}%` }}
        data-live={live && !tone ? "true" : undefined}
        data-tone={tone}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */
export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 860
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}): JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="tf-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="tf-modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tf-modal__head">
          <span className="tf-card__title">
            {icon ? <span className="tf-ico">{icon}</span> : null}
            {title}
          </span>
          <button className="tf-iconbtn" type="button" aria-label="Cerrar" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="tf-modal__body">{children}</div>
        {footer ? <div className="tf-modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
}): JSX.Element {
  return (
    <div className="tf-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          className="tf-tab"
          data-active={t.key === active}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {typeof t.count === "number" ? <span className="tf-tab__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
