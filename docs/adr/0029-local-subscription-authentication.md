# ADR 0029: Keep Provider Authentication Inside Official Local CLI Sessions

## Date

2026-06-28

## Status

Accepted

## Context

TriForge needs to verify that a provider can execute, but it must not become a
custodian of provider credentials. The initial flow authenticates each provider
through its official CLI under the user's own subscription, with no API keys
(ADR 0027, ADR 0028). The integration design is recorded in
`docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`.

The installed CLIs were inspected locally on 2026-06-28. Claude Code 2.1.195
documents that its default authentication uses OAuth/keychain and that `--bare`
"is strictly `ANTHROPIC_API_KEY` ... OAuth and keychain are never read"; Codex CLI
0.101.0 exposes `login`/`logout` subcommands that own the credential lifecycle. In
both cases the credentials live inside the provider's own storage, not inside
TriForge.

## Problem

If TriForge stored, copied, refreshed or automated provider credentials, it would
massively expand the secret-handling surface, weaken user consent, and blur the
separation of responsibilities — for no functional gain, since the official CLI
already manages the session.

## Decision

Provider authentication stays inside the official local CLI session.

- The user authenticates each CLI directly.
- The official CLI retains the session and owns the credential lifecycle.
- TriForge detects only the authentication **state**
  (`authenticated | authentication_required | authentication_expired |
  authentication_unknown | provider_unavailable`).
- TriForge does not read credential stores.
- TriForge does not copy tokens.
- TriForge does not renew tokens.
- TriForge does not automate login.
- TriForge does not share sessions.
- TriForge does not fall back to an API key.
- An authentication failure produces an explicit hard stop
  (`PROVIDER_AUTHENTICATION_REQUIRED`), resumed manually after the user
  re-authenticates the local CLI session.

## Alternatives Considered

### Keep authentication inside the official CLI session (selected)

Selected. It minimizes the secret-handling surface, keeps the architecture local
and consent-driven, and cleanly separates responsibilities: the CLI owns
credentials, TriForge observes state.

### Store OAuth tokens

Rejected. Persisting tokens makes TriForge a credential custodian and a breach
target, contradicting the credential boundary.

### Copy the keychain

Rejected. Reading or copying keychain secrets violates the trust boundary and the
non-goals of the vision.

### Ask for API keys

Rejected. API keys contradict the no-API-key initial policy (ADR 0027).

### Automate login

Rejected. Automated login would require handling credentials and interactive
flows TriForge must not own.

### Reuse one account for multiple users

Rejected. Account sharing is an explicit non-goal and a terms-of-service and
security risk.

### Use browser cookies

Rejected. Cookie extraction turns a web session into an unofficial credential
channel and is prohibited (ADR 0028).

## Verification Requirements

Before any real adapter is implemented or frozen:

- verify that the non-secret auth probe reports state without prompting,
- verify exactly what data the probe emits,
- verify that the probe does not leak secrets into stdout, stderr, logs or
  artifacts,
- verify behavior with an expired session (must surface
  `authentication_expired`, not a silent failure),
- verify all of the above against the installed CLI version; record results as
  dated assumptions and mark unverified items
  `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION`.

## Consequences

Positive:

- smaller secret-handling surface,
- a clear local architecture,
- explicit user consent for authentication,
- clean separation of responsibilities.

Negative:

- re-authentication is manual,
- sessions can expire mid-run,
- capability probes may be uncertain,
- there is no transparent remote execution,
- this model does not support multi-user SaaS.

## Pending Risks

- A non-secret auth probe may, in some CLI version, emit more than the
  authentication state; this must be verified per version before reliance.
- Expired-session detection depends on provider behavior that can change between
  versions.
- The auth state model is documented but not yet wired into any code; the
  condition codes are defined in ADR 0027 and deferred to an implementation
  milestone.
