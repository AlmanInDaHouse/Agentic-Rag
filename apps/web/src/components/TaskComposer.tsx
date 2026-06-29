/**
 * A8.2 Task Composer (mandate §10 A8.2).
 *
 * A controlled form that composes a task and validates it on the frontend against the
 * SAME contracts the backend enforces (`validateTaskComposer`). It surfaces typed
 * per-field errors and only emits a `ComposedTask` when valid. Untrusted text is never
 * rendered as markup (React escapes children; no `dangerouslySetInnerHTML`).
 */

import { useMemo, useState, type FormEvent } from "react";
import {
  validateTaskComposer,
  type ComposedTask,
  type FieldError,
  type TaskComposerInput
} from "../lib/taskComposer.js";

const EMPTY: TaskComposerInput = {
  objective: "",
  scope: "",
  nonGoals: "",
  acceptanceCriteria: "",
  risk: "medium",
  mode: "specialist",
  budgetUnits: "10",
  readPaths: ".",
  writePaths: "src",
  blockedPaths: ".git",
  maxFilesChanged: "10",
  timeoutMs: "120000",
  repairRounds: "3"
};

function errorFor(errors: FieldError[], field: string): string | null {
  return errors.find((e) => e.field === field)?.message ?? null;
}

export function TaskComposer({ onSubmit }: { onSubmit?: (task: ComposedTask) => void }): JSX.Element {
  const [input, setInput] = useState<TaskComposerInput>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const result = useMemo(() => validateTaskComposer(input), [input]);

  const set = (field: keyof TaskComposerInput) => (value: string) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    setShowErrors(true);
    if (result.valid && result.task) {
      onSubmit?.(result.task);
    }
  };

  const fieldError = (field: string): JSX.Element | null =>
    showErrors && errorFor(result.errors, field) ? (
      <span className="field-error" role="alert">
        {errorFor(result.errors, field)}
      </span>
    ) : null;

  return (
    <section aria-label="Task composer" className="task-composer">
      <h2>Compose a task</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Objective
          <input value={input.objective} onChange={(e) => set("objective")(e.target.value)} />
          {fieldError("objective")}
        </label>
        <label>
          Scope (one path per line)
          <textarea value={input.scope} onChange={(e) => set("scope")(e.target.value)} />
        </label>
        <label>
          Acceptance criteria (one per line)
          <textarea value={input.acceptanceCriteria} onChange={(e) => set("acceptanceCriteria")(e.target.value)} />
        </label>
        <label>
          Risk
          <select value={input.risk} onChange={(e) => set("risk")(e.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
          {fieldError("risk")}
        </label>
        <label>
          Collaboration mode
          <select value={input.mode} onChange={(e) => set("mode")(e.target.value)}>
            <option value="specialist">specialist</option>
            <option value="pair">pair</option>
            <option value="debate">debate</option>
          </select>
        </label>
        <label>
          Write paths (one per line)
          <textarea value={input.writePaths} onChange={(e) => set("writePaths")(e.target.value)} />
        </label>
        <label>
          Blocked paths (one per line)
          <textarea value={input.blockedPaths} onChange={(e) => set("blockedPaths")(e.target.value)} />
        </label>
        <label>
          Max files changed
          <input value={input.maxFilesChanged} onChange={(e) => set("maxFilesChanged")(e.target.value)} />
          {fieldError("maxFilesChanged")}
        </label>
        <label>
          Budget (units)
          <input value={input.budgetUnits} onChange={(e) => set("budgetUnits")(e.target.value)} />
          {fieldError("budgetUnits")}
        </label>
        <label>
          Timeout (ms)
          <input value={input.timeoutMs} onChange={(e) => set("timeoutMs")(e.target.value)} />
          {fieldError("timeoutMs")}
        </label>
        <label>
          Repair rounds
          <input value={input.repairRounds} onChange={(e) => set("repairRounds")(e.target.value)} />
          {fieldError("repairRounds")}
        </label>
        <button type="submit" disabled={showErrors && !result.valid}>
          Create run
        </button>
      </form>
    </section>
  );
}
