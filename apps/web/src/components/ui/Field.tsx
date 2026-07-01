/**
 * Form field primitives (A11 redesign): labelled Input / Textarea / Select and a
 * Segment (segmented control). All in Spanish-friendly, presentational, and forward the
 * native props (incl. `data-testid`, which the documented browser E2E relies on).
 */

import React from "react";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}): JSX.Element {
  // Programmatically associate the label with its control (WCAG 1.3.1 / 4.1.2): generate
  // a stable id, put it on the label's htmlFor and inject it into the single child control
  // if the caller didn't pass one explicitly. Keeps every existing data-testid intact.
  const autoId = React.useId();
  const controlId = htmlFor ?? autoId;
  const control =
    React.isValidElement(children) && (children.props as { id?: string }).id === undefined
      ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: controlId })
      : children;
  return (
    <div className="tf-field">
      {label ? (
        <label className="tf-field__label" htmlFor={controlId}>
          {label}
        </label>
      ) : null}
      {control}
      {error ? <span className="tf-field__error">{error}</span> : hint ? <span className="tf-field__hint">{hint}</span> : null}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function TextInput({ mono, className = "", ...rest }, ref) {
    return <input ref={ref} className={`tf-input ${mono ? "tf-input--mono" : ""} ${className}`} {...rest} />;
  }
);

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className = "", ...rest }, ref) {
    return <textarea ref={ref} className={`tf-textarea ${className}`} {...rest} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", children, ...rest }, ref) {
    return (
      <select ref={ref} className={`tf-select ${className}`} {...rest}>
        {children}
      </select>
    );
  }
);

export function Segment<T extends string>({
  value,
  onChange,
  options,
  name
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; variant?: "mock" | "real" }[];
  name?: string;
}): JSX.Element {
  return (
    <div className="tf-segment" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-active={o.value === value}
          className={`tf-segment__btn ${o.variant ? `tf-segment__btn--${o.variant}` : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
