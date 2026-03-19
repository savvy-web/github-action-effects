---
"@savvy-web/github-action-effects": minor
---

## Features

Add `./testing` subpath export and platform abstraction for @actions/\* packages.

## Other

**Platform abstraction:** Six new wrapper services (ActionsCore, ActionsGitHub, ActionsCache, ActionsExec, ActionsToolCache, OctokitAuthApp) abstract @actions/\* packages behind Effect DI. All Live layers now consume these wrappers instead of importing @actions/\* directly. ActionsPlatformLive bundles all six for convenience.

**Testing subpath:** `@savvy-web/github-action-effects/testing` provides all service tags, Live layers, test layers, errors, schemas, and utils without triggering any @actions/\* module resolution. Eliminates ~20 lines of vi.mock boilerplate per consumer test file.

## Breaking Changes

`Action.run()` signature changed from `run(program, layer?)` to `run(program, options?)` where options is `{ layer?, platform? }`. Live layer types now include wrapper service requirements (e.g., `Layer.Layer<ActionInputs, never, ActionsCore>`).
