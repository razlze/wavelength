# Branch Protection Checklist (`main`)

Configure these settings in GitHub repository settings for the `main` branch:

## Required status checks

Require these checks to pass before merging:

- `Lint, Typecheck, Build, Prisma Validate`
- `Dependency Review`

Recommended additional required checks:

- `CodeQL`
- `Secret Scan`

## Pull request requirements

- Require a pull request before merging
- Require approvals: at least 1
- Dismiss stale pull request approvals when new commits are pushed
- Require review from Code Owners (optional, if you add `CODEOWNERS`)
- Require branches to be up to date before merging
- Restrict who can push directly to matching branches

## History and merge safety

- Include administrators (recommended)
- Allow auto-merge if all checks pass
- Disallow force pushes to `main`
- Disallow branch deletion for `main`

