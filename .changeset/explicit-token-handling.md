---
"@savvy-web/github-action-effects": major
---

## Features

- Explicit GitHub token construction, an App-token lifecycle convenience, and per-group log flushing.
- **BREAKING:** `GitHubClientLive` is now a namespace object. Replace `GitHubClientLive` with `GitHubClientLive.fromEnv`. New `GitHubClientLive.fromToken(token)` builds a client from an explicit token (string or `Redacted`); `GitHubClientLive.fromApp({ clientId, privateKey, installationId? })` builds one from GitHub App credentials. Resolves #108 and #109.
- New `GitHubToken` namespace — `provision` (pre), `client` (main), `dispose` (post) — for the GitHub App installation-token lifecycle, with optional post-generation permission verification.

## Bug Fixes

- `ActionLogger` now flushes buffered output inside a failing `group` before `::endgroup::`, instead of only at the outer `withBuffer` boundary. Resolves #86.
