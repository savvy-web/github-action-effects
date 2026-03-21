---
"@savvy-web/github-action-effects": minor
---

## Features

Replace all `@actions/*` packages with native ESM implementations.

- Add runtime layer: `WorkflowCommand`, `RuntimeFile`,
  `ActionsConfigProvider`, `ActionsLogger`, `ActionsRuntime.Default`
- Inputs via Effect `Config` API backed by custom ConfigProvider
  (replaces `ActionInputs` service)
- Logging via Effect `Logger` emitting GitHub workflow commands
  (replaces `@actions/core` logging)
- Rewrite `ActionOutputsLive`, `ActionStateLive` with `RuntimeFile`
- Rewrite `CommandRunnerLive` with `node:child_process` spawn
- Rewrite `GitHubClientLive` with direct `@octokit/rest`
  (self-contained Layer, no longer a factory function)
- Rewrite `ToolInstallerLive` with low-level primitives
  (find, download, extractTar, extractZip, cacheDir, cacheFile)
- Rewrite `ActionCacheLive` with native cache protocol via `fetch`
- Reduce `ActionLogger` to `group` + `withBuffer`
  (annotations handled by Effect Logger)
- Simplify `Action.run` to use `ActionsRuntime.Default`
- Add `@octokit/rest` and `@octokit/auth-app` as direct dependencies
- Remove all `@actions/*` peer and dev dependencies

## Other

Closes #51
