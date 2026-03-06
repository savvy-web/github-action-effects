# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Build GitHub Actions with [Effect](https://effect.website) -- schema-validated
inputs, structured logging with buffered output, and type-safe outputs through
composable service layers.

## Features

- **Schema-validated inputs and outputs** using Effect Schema
- **Three-tier action logger** (info/verbose/debug) with automatic log buffering
- **GitHub Flavored Markdown builders** for step summaries
- **Test layers for every service** -- no mocking `@actions/core` required
- **Full TypeScript** with strict mode and ESM

## Installation

```bash
npm install @savvy-web/github-action-effects effect @actions/core
```

## Quick Start

```typescript
import { Effect, Layer, Schema } from "effect";
import {
  ActionInputs,
  ActionInputsLive,
  ActionOutputs,
  ActionOutputsLive,
  ActionLoggerLive,
  ActionLoggerLayer,
  LogLevelInput,
  resolveLogLevel,
  setLogLevel,
  table,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs;
  const outputs = yield* ActionOutputs;

  const level = yield* inputs.get("log-level", LogLevelInput);
  yield* setLogLevel(resolveLogLevel(level));

  const name = yield* inputs.get("name", Schema.String);
  yield* outputs.set("greeting", `Hello, ${name}!`);
  yield* outputs.summary(table(["Input", "Value"], [["name", name]]));
});

const MainLive = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
);

program.pipe(
  Effect.provide(ActionLoggerLayer),
  Effect.provide(MainLive),
  Effect.runPromise,
);
```

## Documentation

For architecture, API reference, testing guides, and advanced usage, see
[docs](./docs/).

## License

[MIT](LICENSE)
