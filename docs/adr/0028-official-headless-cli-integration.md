# ADR 0028: Use Official Headless CLIs as the Initial Provider Integration Boundary

## Date

2026-06-28

## Status

Accepted

## Context

TriForge Agentic Lab is being reoriented to coordinate two providers — OpenAI
Codex CLI and Anthropic Claude Code — without API keys in the initial flow
(`docs/context/TRIFORGE_PROJECT_VISION.md`, ADR 0027). Before a `ProviderAdapter`
contract is written (deferred by ADR 0027), the integration boundary itself must
be decided: how does TriForge reach a provider at all?

The candidate integration mechanisms are:

- direct API integration,
- browser automation of the provider's web app,
- scraping provider web pages or dashboards,
- official CLIs running locally,
- unofficial, reverse-engineered wrappers.

The runtime today is mock-only and executes no real provider; no `ProviderAdapter`
exists in code (it appears only in docs). The installed CLIs were inspected
locally on 2026-06-28 (`codex-cli 0.101.0`, `claude 2.1.195`) and both expose
officially supported headless modes (`codex exec`, `claude --print`) with
structured output options. The detailed integration design is recorded in
`docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`.

## Problem

Choosing the wrong boundary would either violate the no-API-key, no-scraping,
no-credential-handling policy, or couple TriForge to brittle, unofficial surfaces
that can break or be disallowed at any time.

## Decision

TriForge uses **official CLIs installed locally and their officially supported
headless modes** as the initial provider integration boundary.

TriForge:

- launches the official CLI as a controlled child process,
- consumes only supported outputs (stdout, stderr, structured streams when
  available, exit code),
- normalizes provider-specific events into internal contracts,
- does not manage provider credentials,
- does not automate web interfaces,
- does not use an unofficial wrapper as a canonical dependency.

Capability detection is mandatory and version-specific: a capability is trusted
only after it is observed against the installed CLI version, and a CLI update
invalidates or degrades the cached capability snapshot. The execution runtime
remains mock-only until adapters are specified and built in a later milestone.

## Alternatives Considered

### Official headless CLIs (selected)

Selected. Official CLIs run under the user's own local session, expose supported
headless modes and structured output, keep credentials inside the provider's own
storage, and decouple TriForge from the provider via an adapter boundary.

### Direct API integration in the initial path

Rejected. It requires API keys, contradicting the no-API-key, no-extra-spend
policy of ADR 0027.

### Browser automation

Rejected. Automating the provider web app turns a web subscription into an
unofficial API and is explicitly a non-goal of the vision.

### Cookie / token extraction

Rejected. Extracting cookies or OAuth tokens violates the credential boundary
(ADR 0029) and the security boundaries of the vision and ADR 0027.

### Unofficial, reverse-engineered endpoints

Rejected. Unsupported endpoints have no stability guarantee and can be disallowed;
they must not be a canonical dependency.

### A single generic shell adapter without provider contracts

Rejected. One untyped shell wrapper would lose capability detection, event
normalization and per-provider assumptions, making behavior unauditable and
unsafe.

## Verification Requirements

- Provider capabilities are recorded as dated assumptions verified against the
  installed CLI version; unknown capabilities remain `unknown`
  (`OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`, Sections 8 and 20).
- A `--help` observation establishes only that a flag exists in the installed
  version; runtime behavior (event payloads, usage/quota signals, cancellation
  semantics) is `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` before any
  adapter is frozen.
- The structured event and final-output schemas of each CLI must be verified
  against the installed version before an adapter consumes them.

## Consequences

Positive:

- respects official local sessions and the no-API-key policy,
- reduces secret exposure by keeping credentials inside the CLI,
- enables local, single-user use,
- enables structured event streams when available,
- decouples TriForge from providers through adapters.

Negative:

- couples TriForge to CLI versions and flag stability,
- exposes TriForge to opaque provider quotas,
- makes local process control (timeout, cancellation, process-tree termination)
  a first-class concern,
- introduces platform differences (Windows vs WSL2, deferred to A0.4),
- makes capability detection mandatory before every integration.

## Pending Risks

- CLI flags and output formats can change between versions and break adapters.
- Headless behavior observed in `--help` may differ from runtime behavior.
- Process-tree termination differs across the eventual execution substrate (A0.4).
- The `ProviderAdapter`, mock adapters and real adapters are still future work and
  are not built in this milestone.
