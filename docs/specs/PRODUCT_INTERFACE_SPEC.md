# Product Interface Spec (A8)

**Status:** Active — grows across A8.1–A8.8.
**Authority:** Owner mandate `docs/instrucciones-a5-a9.md` §10; ADR 0052. Built on the
stable A1 contracts (`@triforge/shared`) and the A5–A7 runtime types.

A8 is the product UI for the writable-execution runtime in `apps/web` (React 18 + Vite +
Tailwind). It lets a user create, observe, audit, cancel, recover and understand a full
run WITHOUT console logs — and it MUST NOT invent any state the backend does not know.

## Architecture & testing

The legacy `App.tsx` is the 1.x context/debate dashboard; the TriForge UI grows in a
separate `TriforgeDashboard` composed of small presentational panels. The TESTABLE core
of each panel is a PURE view-model / sanitization function (no DOM); React components are
validated by `tsc` (typecheck) and `vite build`. A `vitest` (node env) suite was added to
`apps/web` (`pnpm --filter @triforge/web test`) so CI runs the view-model tests — a gate
reinforcement, not a weakening.

### A8 security (mandate §10 "A8 Security") — `src/lib/sanitize.ts`

React escapes HTML text children (no `dangerouslySetInnerHTML` is used), so injection via
markup is inherently prevented. The sanitizer adds, for ALL panels:

- **terminal-escape / ANSI** sequences stripped (so captured provider output cannot drive
  a terminal); the ESC byte itself is removed so any residual is inert;
- **C0/C1 control characters** (incl. NUL) stripped, keeping tab/newline;
- **hostile filenames** cleaned + length-capped (`safeFilename`);
- **accidental secret rendering** masked (`redactSecrets`);
- **diff/output truncation** with an explicit `truncated` flag (`safeText`).

## A8.1 Provider Status

### Design (`src/lib/providerStatus.ts` + `src/components/ProviderStatus.tsx`; ADR 0052)

`deriveProviderStatusView(snapshot)` maps a backend provider snapshot to a display
view-model with HONEST states: an absent field becomes an explicit `unknown` /
`never verified`, never a fabricated default; an UNKNOWN-capacity quota is NEVER presented
as guaranteed availability (it is at best `estimated`, at worst `unknown`); version,
capabilities and warnings are control/ANSI-stripped. The `ProviderStatusPanel` renders
installed / version (+ unsupported badge) / auth / capabilities / quota (with its
confidence) / last-verified, plus sanitized warnings. Pure + deterministic.

### Verification

`src/lib/sanitize.test.ts` (6) + `src/lib/providerStatus.test.ts` (6): ANSI/control/NUL
stripping (keeps tab/newline), secret redaction, truncation flag, safe filename; honest
unknown states, unknown-quota-not-available, label mapping, warning/version sanitization.

## A8.2 Task Composer

### Design (`src/lib/taskComposer.ts` + `src/components/TaskComposer.tsx`; ADR 0052 arch)

`validateTaskComposer(input)` validates the composed task on the frontend against the
SAME contracts the backend enforces — the A1 `TaskSpecificationSchema` and a Zod
`AllowedPathPolicySchema` mirroring the A5.2 shape (`readPaths`/`writePaths`/
`blockedPaths`/`maxFilesChanged`) — plus risk (`RiskLevelSchema`), collaboration mode,
budget, timeout and repair-rounds. It surfaces typed per-field errors, rejects an empty
objective / negative budget / `maxFilesChanged < 1` / out-of-enum risk-or-mode /
non-integer numerics, and normalizes path/list textareas (trim, drop empties). The
frontend never applies a looser rule than the backend, which re-validates
authoritatively. The `TaskComposer` form emits a `ComposedTask` only when valid.

### Verification

`src/lib/taskComposer.test.ts` (6): a valid task validates + paths normalized; empty
objective rejected (A1 rule); negative budget rejected; `maxFilesChanged < 1` rejected
(A5.2 shape); out-of-enum risk/mode rejected; non-integer numerics rejected.

## A8.3 Run Timeline

### Design (`src/lib/runTimeline.ts` + `src/components/RunTimeline.tsx`; ADR 0052 arch)

`buildTimeline(events)` renders run events ORDERED BY SEQUENCE NUMBER (the A1
`ProviderEvent` carries a monotonic `sequenceNumber`; timestamps can tie/skew), DEDUPES a
repeated sequence number (keeps the first), FLAGS a sequence GAP (a possible dropped
event), and sanitizes the event type + detail via `safeText` (no terminal-escape /
control / secret leak). Input is a minimal `RunEvent` the caller maps from a
`ProviderEvent`, so the view-model is decoupled from the payload union. Pure +
deterministic.

### Verification

`src/lib/runTimeline.test.ts` (5): out-of-order events sorted by sequence (not
timestamp); duplicate sequence deduped + recorded; gap flagged; contiguous → no gaps;
type/detail sanitized (ANSI/secret stripped).

## Open follow-ups

- A8.4 artifact explorer (12 A1 artifacts + ledger + raw evidence refs); A8.5 diff/review
  (never hide changed files; diff-hash vs reviewed-hash); A8.6 governance dashboard; A8.7
  budget/quota; A8.8 recovery UI.
- A later A8 step mounts `TriforgeDashboard` as the TriForge view (a backend wiring of the
  A5–A7 runtime into HTTP/Socket.IO is a prerequisite for live data; the panels are built
  against the contracts now).