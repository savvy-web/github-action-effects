# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org/)

Composable [Effect](https://effect.website) services for building GitHub Actions with schema-validated inputs, structured logging, and GitHub API operations -- zero `@actions/*` dependencies.

## Features

- **Zero CJS dependencies** -- native ESM implementations of the GitHub Actions runtime protocol replace all `@actions/*` packages
- **29 composable services** -- action I/O, GitHub API, git operations, package publishing, and more
- **Schema-validated inputs** -- read action inputs via Effect's `Config` API with built-in parsing and defaults
- **Structured logging** -- Effect Logger maps to workflow commands with collapsible groups and buffer-on-failure
- **In-memory test layers** -- every service ships a test layer for fast, deterministic unit tests

## Installation

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
```

## Quick Start

```typescript
import { Config, Effect } from "effect";
import { Action, ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const name = yield* Config.string("package-name");
  const outputs = yield* ActionOutputs;
  yield* outputs.set("result", `checked ${name}`);
});

Action.run(program);
```

`Action.run` provides `ActionsRuntime.Default` (ConfigProvider, Logger, core services, and Node.js platform layers), catches errors, and sets the workflow exit status automatically.

## Documentation

For service reference, architecture, testing guides, and advanced usage, see [docs/](./docs/).

## License

[MIT](LICENSE)
