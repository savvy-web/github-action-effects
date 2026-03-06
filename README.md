# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Composable Effect services for building GitHub Actions with schema-validated
inputs, structured logging, typed outputs, and GFM report builders.

## Features

- **Schema-validated inputs** -- decode and validate action inputs (including JSON payloads) with Effect Schema
- **Structured log levels** -- info/verbose/debug with buffer-on-failure: clean logs on success, full context on failure
- **Typed outputs and summaries** -- set action outputs and write step summaries through an Effect service
- **GFM builders** -- pure functions for tables, checklists, collapsible details, and status icons
- **Test layers included** -- every service ships with an in-memory test layer for deterministic unit tests

## Installation

```bash
pnpm add @savvy-web/github-action-effects
```

Peer dependencies (install alongside):

```bash
pnpm add effect @actions/core @actions/exec @actions/github
```

## Quick Start

```typescript
import { Effect, Layer, Schema } from "effect"
import {
  ActionInputs,
  ActionInputsLive,
  ActionOutputs,
  ActionOutputsLive,
  ActionLoggerLive,
  table,
  statusIcon,
} from "@savvy-web/github-action-effects"

const MyAction = Effect.gen(function* () {
  const name = yield* ActionInputs.get("package-name", Schema.String)
  const config = yield* ActionInputs.getJson("config", MyConfigSchema)

  const results = yield* runChecks(config)

  yield* ActionOutputs.set("status", "success")
  yield* ActionOutputs.summary(
    table(
      ["Package", "Status"],
      results.map((r) => [r.name, statusIcon(r.status)]),
    ),
  )
})

const MainLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
)

MyAction.pipe(Effect.provide(MainLayer), Effect.runPromise)
```

## Services

| Export | Purpose |
| --- | --- |
| `ActionInputs` | `get`, `getOptional`, `getSecret`, `getJson` -- schema-validated input reading |
| `ActionLogger` | Effect Logger with `group`, `withBuffer`, `annotation` -- structured logging |
| `ActionOutputs` | `set`, `setJson`, `summary`, `exportVariable`, `addPath` -- typed output setting |
| GFM builders | `table`, `heading`, `details`, `checklist`, `statusIcon`, `bold`, `code`, `link`, `list`, `rule`, `codeBlock` |

Services use the `Context.GenericTag` pattern. Import the service tag and its
live layer as separate exports:

```typescript
import { ActionInputs, ActionInputsLive } from "@savvy-web/github-action-effects"
```

## Log Levels

The `ActionLogger` reads a `log-level` action input with four values:

| Level | Behavior |
| --- | --- |
| `info` | Outcome summaries only. Buffers verbose output; flushes on failure. |
| `verbose` | Start/finish milestone markers. Unbuffered. |
| `debug` | Everything -- full command output, inputs, internal state. |
| `auto` | Resolves to `info`, or `debug` when `RUNNER_DEBUG=1`. |

All levels always write internal details to `core.debug()` (visible only when
GitHub step debug logging is enabled).

## Testing

Every service has a test layer with in-memory backing. No `@actions/core` calls
are made during tests.

```typescript
import { Effect, Layer, Schema } from "effect"
import {
  ActionInputs,
  ActionInputsTest,
  ActionOutputs,
  ActionOutputsTest,
  ActionLoggerTest,
} from "@savvy-web/github-action-effects"

const outputState = ActionOutputsTest.empty()
const logState = ActionLoggerTest.empty()

const TestLayer = Layer.mergeAll(
  ActionInputsTest({ "package-name": "my-pkg" }),
  ActionOutputsTest.layer(outputState),
  ActionLoggerTest.layer(logState),
)

await Effect.gen(function* () {
  const name = yield* ActionInputs.get("package-name", Schema.String)
  yield* ActionOutputs.set("result", name)
}).pipe(Effect.provide(TestLayer), Effect.runPromise)

// Inspect captured state
expect(outputState.outputs).toContainEqual({
  name: "result",
  value: "my-pkg",
})
```

## Companion Package

[`@savvy-web/github-action-builder`](https://github.com/savvy-web/github-action-builder)
provides the build tooling and action runner for Node.js 24 GitHub Actions.
Use it alongside this library to build, bundle, and test complete actions.

## Documentation

For architecture details, API reference, and advanced usage, see
[docs/](./docs/).

## License

MIT
