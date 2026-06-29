# ADR 0052: Product Interface — view-model + sanitizer architecture; A8.1 (A8)

## Date

2026-06-29

## Status

Accepted

First decision of Milestone A8 (Product Interface). Establishes the UI architecture and
delivers A8.1 Provider Status. Mandate §10. Component spec:
`PRODUCT_INTERFACE_SPEC.md`.

## Context

The A8 UI must let a user understand a full run without console logs and must never
invent a state the backend does not know, while rendering untrusted captured content
(provider output, diffs, filenames) safely. The runtime (A5–A7) is currently
pure/in-memory and not yet wired to HTTP/Socket.IO, so the UI is built against the stable
A1 contracts. The frontend also needs executable test evidence for its security and
honesty invariants.

## Decision

1. **Pure view-models + presentational components.** Each panel's logic lives in a PURE,
   deterministic view-model / sanitization function (testable with no DOM); the React
   component only renders it. The TriForge UI grows in a `TriforgeDashboard` separate from
   the legacy `App.tsx`.

2. **A vitest (node) suite in `apps/web`.** Added so CI runs the view-model + sanitizer
   tests (`pnpm --filter @triforge/web test`). This reinforces the gate (the mandate
   permits CI changes that strengthen validation); React components stay validated by
   `tsc` + `vite build`.

3. **Honest states.** `deriveProviderStatusView` maps absent fields to explicit
   `unknown` / `never verified` (never a fabricated default), and never presents an
   unknown-capacity quota as guaranteed availability.

4. **Safe rendering for all panels.** `src/lib/sanitize.ts` strips terminal-escape/ANSI
   and C0/C1 control characters, masks secrets, cleans hostile filenames and truncates
   oversized text with an explicit flag; no `dangerouslySetInnerHTML` is ever used.

## Alternatives

1. **Put UI logic inline in components and test with jsdom/@testing-library.** Rejected
   for now: it adds heavier deps; the security/honesty invariants live in pure functions
   that are cheaper and clearer to test directly.
2. **Render captured output raw (trust React's HTML escaping alone).** Rejected: React
   does not strip terminal-escape/ANSI or mask secrets — captured provider output needs
   the sanitizer.
3. **Wire the runtime into HTTP/Socket.IO first.** Deferred: the panels are built against
   the stable contracts; live wiring is a later A8 step.

## Consequences

### Positive

- A8 panels are honest (no invented state), safe (sanitized untrusted content) and
  testable (pure view-models with CI coverage).

### Negative

- Until the runtime is wired to a transport, the dashboard renders against contract data
  rather than live runs; that wiring is a later A8 step.

## Risks

- **A8 security (XSS / terminal escape / secret rendering / hostile filenames)** —
  mitigated by the sanitizer + React's escaping; covered by tests.

## Conditions to Revisit

- The A5–A7 runtime is wired into HTTP/Socket.IO, enabling live data.
- Component-level (DOM) tests are added if interactive behaviour grows.

## References

- `docs/specs/PRODUCT_INTERFACE_SPEC.md` §A8 + §A8.1
- `apps/web/src/lib/{sanitize,providerStatus}.ts`,
  `apps/web/src/components/{ProviderStatus,TriforgeDashboard}.tsx`
