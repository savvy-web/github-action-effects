---
"@savvy-web/github-action-effects": minor
---

## Features

- **GitHubRelease**: Service for GitHub Releases API — create releases, upload assets, get by tag, list with pagination.
- **GitHubIssue**: Service for Issues API — list with filters, close, comment, and get linked issues via GraphQL.
- **GitTag**: Service for Git tag refs — create, delete, list with prefix filter, resolve tag to SHA.
- **SemverResolver**: Utility namespace for semver operations — compare, satisfies, latestInRange, increment, parse.
- **AutoMerge**: Utility namespace for PR auto-merge — enable/disable via GraphQL mutations.
- **PackagePublish**: Service for npm publishing workflow — registry auth setup, pack with digest, publish, integrity verification, multi-registry support.
- **TokenPermissionChecker**: Service for GitHub App token permission validation with three enforcement modes (assertSufficient, assertExact, warnOverPermissioned) and structured result reporting.
- **GitHubOtelAttributes**: Utility to map GitHub Actions environment variables to OpenTelemetry semantic convention resource attributes (cicd.*, vcs.*).
- **OtelConfig.resourceAttributes**: Extended OTel configuration to accept custom resource attributes.
