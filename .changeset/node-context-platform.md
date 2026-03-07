---
"@savvy-web/github-action-effects": patch
---

## Features

Provide Node.js platform services automatically in `Action.run()`.

`Action.run()` now merges `NodeContext.layer` from `@effect/platform-node` into its core layers. Programs run via `Action.run()` automatically have access to `FileSystem`, `Path`, `Terminal`, `CommandExecutor`, and `WorkerManager` without manually providing them.

## Breaking Changes

`@effect/platform` and `@effect/platform-node` are now required peer dependencies.
