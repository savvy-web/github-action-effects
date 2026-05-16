---
"@savvy-web/github-action-effects": patch
---

## Breaking Changes

- `GitHubApp.botIdentity` now takes `{ appSlug?, appUserId? }` instead of a bare slug string. Call sites passing a string must pass an object; it produces verified identities when both fields are present.

## Features

- `GitHubToken` now resolves and persists the GitHub App identity during the `pre` phase — best-effort, so a lookup failure degrades gracefully instead of failing the action.
- New `GitHubToken.read()` exposes the persisted installation token, and `GitHubToken.botIdentity()` derives a verified commit identity (numeric-ID-prefixed email) from it.
- New `GitHubApp.resolveAppIdentity` method performs the App slug and bot-user-ID lookup.
