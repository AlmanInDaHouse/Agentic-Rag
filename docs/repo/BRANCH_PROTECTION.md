# Branch Protection

## Goal

Protect `main` so changes enter through reviewed pull requests with the `Validate` CI check passing.

## Configure In GitHub

Open:

```text
Settings -> Branches -> Branch protection rules -> Add rule
```

Branch name pattern:

```text
main
```

Recommended options:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Required check: `Validate`.
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Do not allow bypassing the above settings.
- Restrict force pushes.
- Restrict deletions.

## Notes

On personal or private repositories, some branch protection options can depend on the GitHub plan. If an option is not available, enable at least:

- pull requests required before merging,
- status checks required before merging,
- required check: `Validate`.

## Recommended Merge Flow

1. Open a pull request targeting `main`.
2. Confirm `Validate` is green.
3. Resolve all review conversations.
4. Squash merge.
5. Delete the source branch after merge.
