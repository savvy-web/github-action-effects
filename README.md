# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

Composable [Effect](https://effect.website) services for building Node.js 24 GitHub Actions with schema-validated inputs, structured logging, typed outputs and multi-phase state management without the boilerplate.

## Features

- **Schema-validated inputs** — read, parse, and validate action inputs with Effect Schema
- **Structured logging** — three-tier logger (info/verbose/debug) with buffer-on-failure
- **Typed outputs** — set outputs, export variables, and write GFM job summaries
- **Multi-phase state** — transfer schema-serialized state across pre/main/post phases
- **In-memory test layers** — test every service without mocking `@actions/core`

## Installation

```bash
npm install @savvy-web/github-action-effects effect @actions/core
```

## Quick Start

```typescript
import { Effect, Schema } from "effect";
import { Action, ActionInputs, ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs;
  const outputs = yield* ActionOutputs;
  const name = yield* inputs.get("package-name", Schema.String);
  yield* outputs.set("result", `checked ${name}`);
});

Action.run(program);
```

`Action.run` provides all core service layers, installs the Effect logger, and catches errors with `core.setFailed` automatically.

See the [full walkthrough](./docs/example-action.md) for log level configuration, batch input reading, GFM summaries, multi-phase state, and error handling.

## Documentation

- [Example Action](./docs/example-action.md) — end-to-end tutorial
- [Architecture](./docs/architecture.md) — API reference and layer composition
- [Testing](./docs/testing.md) — testing with in-memory layers

## License

[MIT](LICENSE)
