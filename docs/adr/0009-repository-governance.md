# ADR 0009: Repository Governance

## Date

2026-06-01

## Context

TriForge Agentic Lab now has a GitHub repository, a main branch, CI validation and an external harness. The repository needs clear entry rules before more complex runtime work begins.

## Problem

Without pull request policy and branch protection, changes can land on `main` without CI, spec updates, ADRs or dependency review. That would weaken reproducibility and make future agentic runtime work harder to govern.

## Decision

Document repository governance and configure GitHub-facing templates:

- branch protection guidance for `main`,
- pull request policy,
- pull request template,
- basic CODEOWNERS file,
- CI policy references to the required `Validate` check.

## Alternatives Considered

- Work directly on `main`: rejected because it bypasses CI and review.
- CI without branch protection: useful but insufficient because failing checks could still be ignored.
- PR + CI + branch protection: selected because it creates a clear and enforceable quality gate.

## Final Decision

All changes should enter through pull requests targeting `main`, with `Validate` passing before merge. Squash merge is preferred, and architecture, behavior or dependency changes must update specs, ADRs or security docs as appropriate.

## Consequences

- Contributors have a clear checklist.
- `main` is protected by documented process and GitHub settings.
- CI becomes a required gate rather than advisory feedback.
- Branch protection must still be enabled manually in GitHub repository settings.

## Pending Risks

- Some branch protection options may depend on the repository plan.
- CODEOWNERS effectiveness depends on the GitHub username and repository permissions.
- The documented policy only becomes enforceable after branch protection is configured.
