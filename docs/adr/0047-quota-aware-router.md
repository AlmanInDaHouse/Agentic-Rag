# ADR 0047: Quota-Aware Router (A6.3)

## Date

2026-06-29

## Status

Accepted

Third sub-decision of Milestone A6. Composes A6.1 (profile), A6.2 (capability) and the
A4 owner-selection (`orchestration/routing.ts`) with the A2.3 quota manager into the
end-to-end routing decision. Mandate §A6.3; ADR 0027 (quota-aware orchestration).
Component spec: `ROUTING_LEARNING_SPEC.md` §A6.3.

## Context

A4's `selectOwner` already combines capability + risk-gated quota degradation and reads
usability from the quota manager (scoring unknown capacity ≤0.5, never fabricated). A6.3
must close the loop — feed it the honest A6.2 capability scores and add the two factors
A4 did not model: the authentication state and an explicit terminal classification
(routed / paused / hard-stop), without weakening "no paid fallback" or treating unknown
quota as available.

## Decision

1. **Compose, don't duplicate.** `routeQuotaAware` runs A6.2 → capability scores, then
   calls A4 `selectOwner`, reusing its risk-gated degradation and quota reads.

2. **Authentication gate via an additive A4 input.** An unauthenticated provider is
   ineligible: its capability is zeroed AND it is passed to `selectOwner` via a new,
   backward-compatible `ineligibleProviders` input, so degradation never routes to it.
   This keeps the degradation logic in ONE place.

3. **Explicit terminal classification.** `routed` when an owner is assigned; `paused`
   when no provider is usable but the cause is recoverable (auth/quota); `hard_stop`
   when ALL providers are hard-stopped/quota-exhausted — await a quota reset, with NO
   paid fallback. Unknown quota is never presented as guaranteed availability.

## Alternatives

1. **Re-implement degradation in A6.3.** Rejected: it would duplicate and risk diverging
   from A4's risk-gated logic. The additive `ineligibleProviders` injects auth cleanly.
2. **Fold auth into the quota manager.** Rejected: auth is an orthogonal concern from
   budget; modelling it as quota would conflate two recovery paths (re-auth vs reset).
3. **Treat unknown quota as available.** Rejected by ADR 0027 / quota spec — unknown is
   never fabricated as availability.

## Consequences

### Positive

- One honest, end-to-end routing decision: capability (no stereotype) + quota + auth +
  risk, with a clear terminal status the runtime can act on (route / pause / hard-stop).
- The auth gate reuses A4's degradation; the additive input keeps A4 backward-compatible
  (existing routing tests unchanged).

### Negative

- Historical performance + confidence are passed through but not yet learned (A6.4/A6.5);
  routing is capability/quota/auth-driven until metrics exist.

## Risks

- **R-PRV-2** (opaque/partial quota; expired auth mid-run) — mitigated: unknown is not
  fabricated, exhaustion hard-stops, expired auth gates the provider; no paid fallback.

## Conditions to Revisit

- A6.4/A6.5 supply learned rules + repository performance; A6.6 adds the adaptive layer.
- An authenticated actor channel (R-SEC-9) firms up the auth state's provenance.

## References

- `docs/specs/ROUTING_LEARNING_SPEC.md` §A6.3
- `docs/adr/0027-quota-aware-provider-orchestration.md`, `0045-..`, `0046-static-capability-router.md`
- `apps/api/src/orchestration/{quotaAwareRouter,routing,staticRouter,taskProfiler}.ts`
