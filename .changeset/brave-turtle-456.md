---
"@savvy-web/github-action-effects": minor
---

## Features

- **GitHubClient.paginate**: Paginated REST API calls with automatic page concatenation, empty-page termination, and configurable maxPages limit.
- **GitHubGraphQL**: Dedicated GraphQL service with operation naming, mutation/query distinction, and structured GraphQL error extraction. Delegates to GitHubClient.graphql with error mapping.
- **DryRun**: Cross-cutting dry-run mode with guard pattern for mutation interception. When enabled, guard() logs the operation and returns a fallback instead of executing.
- **NpmRegistry**: Query npm registry for package metadata (versions, dist-tags, package info, integrity hashes) via CommandRunner using `npm view --json`.
- **ErrorAccumulator**: Utility namespace for "process all, collect failures" patterns with sequential and concurrent variants.
- **WorkspaceDetector**: Detect monorepo workspace structure (pnpm, npm, yarn, bun, single) and list workspace packages via @effect/platform FileSystem.
