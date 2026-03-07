# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Build GitHub Actions with [Effect](https://effect.website) -- schema-validated
inputs, structured logging with buffered output, type-safe outputs, and
multi-phase state management through composable service layers.

## Features

- **Schema-validated inputs** -- `get`, `getOptional`, `getSecret`, `getJson`,
  `getMultiline`, `getBoolean`, `getBooleanOptional`, plus batch reading with
  `parseAllInputs`
- **Three-tier action logger** (info/verbose/debug) with automatic log buffering
  and buffer-on-failure
- **Typed outputs** -- `set`, `setJson`, `summary`, `exportVariable`, `addPath`,
  `setFailed`, `setSecret`
- **Multi-phase state** -- `ActionState` service for schema-serialized state
  across pre/main/post action phases
- **GitHub Flavored Markdown builders** for step summaries (tables, checklists,
  details, status icons)
- **`runAction` helper** -- eliminates boilerplate for wiring layers and error
  handling
- **Test layers for every service** -- no mocking `@actions/core` required
- **Full TypeScript** with strict mode and ESM

## Installation

```bash
npm install @savvy-web/github-action-effects effect @actions/core
```

## Quick Start

The simplest way to run an action is with `runAction`, which provides all core
service layers, installs the Effect logger, and catches errors automatically:

```typescript
import { Effect, Schema } from "effect";
import {
  runAction,
  ActionInputs,
  ActionOutputs,
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

runAction(program);
```

### Manual layer composition

If you need more control over layers, compose them yourself:

```typescript
import { Effect, Layer } from "effect";
import {
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
  ActionLoggerLayer,
} from "@savvy-web/github-action-effects";

const MainLive = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
);

program.pipe(
  Effect.provide(MainLive),
  Effect.provide(ActionLoggerLayer),
  Effect.runPromise,
);
```

## Batch Input Reading with parseAllInputs

Read and validate all inputs in one call with `parseAllInputs`:

```typescript
import { Effect, Schema } from "effect";
import { parseAllInputs, runAction } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* parseAllInputs({
    "app-id": { schema: Schema.NumberFromString, required: true },
    "branch": { schema: Schema.String, default: "main" },
    "dry-run": { schema: Schema.Boolean, default: false },
    "config": { schema: MyConfigSchema, json: true },
    "packages": { schema: Schema.String, multiline: true },
    "token": { schema: Schema.String, secret: true },
  });

  // inputs is fully typed: { "app-id": number, branch: string, ... }
});

runAction(program);
```

Each entry in the config record specifies how to read the input: `required`,
`default`, `multiline`, `secret`, `json`, and `schema` are all supported. An
optional second argument accepts a cross-validation function.

## Multi-Phase State with ActionState

For actions with pre/main/post phases, `ActionState` provides schema-serialized
state transfer:

```typescript
import { Effect, Layer, Schema } from "effect";
import {
  runAction,
  ActionState,
  ActionStateLive,
} from "@savvy-web/github-action-effects";

const TimingSchema = Schema.Struct({
  startedAt: Schema.Number,
});

// In pre.ts:
const preProgram = Effect.gen(function* () {
  const state = yield* ActionState;
  yield* state.save("timing", { startedAt: Date.now() }, TimingSchema);
});

runAction(preProgram, ActionStateLive);

// In main.ts:
const mainProgram = Effect.gen(function* () {
  const state = yield* ActionState;
  const timing = yield* state.get("timing", TimingSchema);
  // timing.startedAt is typed as number
});

runAction(mainProgram, ActionStateLive);
```

`ActionStateLive` is not included in `runAction`'s core layers because not all
actions need multi-phase state. Pass it as the second argument when needed.

## Documentation

For architecture, API reference, testing guides, and advanced usage, see
[docs](./docs/).

## License

[MIT](LICENSE)
