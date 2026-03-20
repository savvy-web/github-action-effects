# Building a GitHub Action with Effect

This tutorial walks through building a complete GitHub Action using
`@savvy-web/github-action-effects`. By the end you will have a working
action with validated inputs, structured logging, a step summary,
and typed outputs.

## Prerequisites

```bash
npm install @savvy-web/github-action-effects effect \
  @effect/platform @effect/platform-node \
  @effect/cluster @effect/rpc @effect/sql
```

If you use `@savvy-web/github-action-builder` for bundling, it compiles
your TypeScript source into the single `dist/index.js` that GitHub Actions
expects.

## The action.yml

Declare inputs, outputs, and the entry point:

```yaml
name: 'Package Checker'
description: 'Check a package and report results'
inputs:
  package-name:
    description: 'Package to check'
    required: true
  threshold:
    description: 'Pass threshold (number)'
    required: false
    default: '80'
  dry-run:
    description: 'Skip writes'
    required: false
    default: 'false'
outputs:
  status:
    description: 'Check result status'
  report:
    description: 'JSON report'
runs:
  using: 'node24'
  main: 'dist/index.js'
```

## The main.ts

Here is the complete action. Each section is explained below.

```typescript
import { Config, Effect, Schema } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  GithubMarkdown,
} from "@savvy-web/github-action-effects"

// -- Schemas for structured outputs --

const ReportSchema = Schema.Struct({
  total: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
})

// -- The program --

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const outputs = yield* ActionOutputs

  // 1. Read inputs via Config API (backed by ActionsConfigProvider)
  const packageName = yield* Config.string("package-name")
  const threshold = yield* Config.integer("threshold").pipe(Config.withDefault(80))
  const dryRun = yield* Config.boolean("dry-run").pipe(Config.withDefault(false))

  yield* Effect.log(`Checking ${packageName} (dry-run: ${dryRun})`)

  // 2. Do work inside a collapsible log group
  const results = yield* logger.group("Run checks", Effect.gen(function* () {
    yield* Effect.log("Resolving dependencies")
    yield* Effect.log("Running validation")
    return [
      { name: packageName, passed: true, version: "1.0.0" },
    ]
  }))

  // 3. Use buffer-on-failure for noisy operations
  yield* logger.withBuffer("detailed-analysis", Effect.gen(function* () {
    for (const r of results) {
      yield* Effect.log(`Analyzing ${r.name}...`)  // buffered
    }
    // If this fails, all buffered lines flush to the log automatically
  }))

  // 4. Set typed outputs
  yield* outputs.set("status", "success")
  yield* outputs.setJson("report", {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
  }, ReportSchema)

  // 5. Write a step summary with GFM builders
  const summaryTable = GithubMarkdown.table(
    ["Package", "Status", "Version"],
    results.map((r) => [
      r.name,
      GithubMarkdown.statusIcon(r.passed ? "pass" : "fail"),
      r.version,
    ])
  )

  yield* outputs.summary([
    GithubMarkdown.heading("Check Results"),
    summaryTable,
  ].join("\n\n"))

  // 6. Emit annotations for PR inline feedback
  yield* logger.annotationWarning("Deprecated API usage", {
    file: "src/helpers.ts",
    startLine: 42,
  })

  yield* Effect.log("Action completed")
})

// 7. Run it -- provides ActionsRuntime.Default and catches errors automatically
Action.run(program)
```

### What each section does

1. **Inputs** -- `Config.string("package-name")` reads `INPUT_PACKAGE-NAME`
   from the environment. `Config.integer` and `Config.boolean` parse and
   validate automatically. `Config.withDefault` provides fallback values.

2. **Groups** -- `logger.group` wraps the effect in a collapsible section in
   the Actions UI. The return value passes through.

3. **Buffer-on-failure** -- `logger.withBuffer` captures verbose output.
   On success the buffer is silently discarded. On failure it flushes before
   the error propagates, giving full context.

4. **Outputs** -- `set` for strings, `setJson` for schema-validated JSON.
   Values appear in `${{ steps.id.outputs.status }}` in downstream workflow
   steps.

5. **Step summary** -- `outputs.summary` writes markdown to the job summary.
   `GithubMarkdown.*` helpers build tables, headings, details blocks, etc.

6. **Annotations** -- `annotationError`, `annotationWarning`, and
   `annotationNotice` appear inline on PR diffs at the specified file and
   line.

7. **Action.run** -- Provides `ActionsRuntime.Default` (ConfigProvider,
   Logger, ActionOutputs, ActionState, ActionLogger, ActionEnvironment,
   and Node.js FileSystem), wraps in `withBuffer`, and catches all errors
   with `::error::` workflow commands.

## Adding Multi-Phase State

Some actions run in multiple phases -- `pre`, `main`, and `post`. The
`ActionState` service transfers typed data between them using Schema
encode/decode under the hood.

### action.yml with phases

```yaml
runs:
  using: 'node24'
  pre: 'dist/pre.js'
  main: 'dist/main.js'
  post: 'dist/post.js'
```

### pre.ts -- save state

```typescript
import { Effect, Schema } from "effect"
import { Action, ActionState } from "@savvy-web/github-action-effects"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

const program = Effect.gen(function* () {
  const state = yield* ActionState
  yield* state.save("timing", { startedAt: Date.now() }, TimingSchema)
})

Action.run(program)
```

### post.ts -- read state

```typescript
import { Effect, Schema } from "effect"
import { Action, ActionState, ActionOutputs } from "@savvy-web/github-action-effects"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

const program = Effect.gen(function* () {
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const timing = yield* state.get("timing", TimingSchema)
  const elapsed = Date.now() - timing.startedAt
  yield* outputs.set("duration-ms", String(elapsed))
})

Action.run(program)
```

`ActionState` is included in `ActionsRuntime.Default` (provided by
`Action.run`), so no additional layers are needed.

## Error Handling

`Action.run` catches all errors and emits `::error::` workflow commands
automatically. For granular control, use `Effect.catchTag`:

```typescript
const result = yield* someEffect.pipe(
  Effect.catchTag("GitHubClientError", (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(`API call failed: ${error.reason}`)
      return yield* Effect.fail(error)
    })
  )
)
```

The error types -- `ActionOutputError`, `ActionStateError`,
`GitHubClientError`, etc. -- are all `Data.TaggedError` instances. See
[architecture.md](./architecture.md#error-types) for their fields.

For custom error handlers that extract a human-readable message from an
Effect `Cause`, use `Action.formatCause(cause)`. It returns a `[Tag] message`
string that is parseable by both humans and AI. See
[error-handling.md](./error-handling.md) for details.

## Testing

Test your action's `program` function using test layers from the `/testing`
subpath. No mocks, no real runner calls -- just in-memory service
implementations.

```typescript
// src/main.test.ts
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionLogger,
  ActionLoggerTest,
  ActionOutputs,
  ActionOutputsTest,
  ActionState,
  ActionStateTest,
} from "@savvy-web/github-action-effects/testing"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  yield* outputs.set("status", "success")
})

describe("package checker action", () => {
  it("sets status output", async () => {
    const outputState = ActionOutputsTest.empty()
    const logState = ActionLoggerTest.empty()
    const stateState = ActionStateTest.empty()

    const layer = Layer.mergeAll(
      ActionOutputsTest.layer(outputState),
      ActionLoggerTest.layer(logState),
      ActionStateTest.layer(stateState),
    )

    await program.pipe(Effect.provide(layer), Effect.runPromise)

    expect(outputState.outputs).toContainEqual({ name: "status", value: "success" })
  })
})
```

See [Testing Guide](./testing.md) for the full API of each test layer and
patterns for testing logging, state, and annotations.

## Next Steps

- [Services Guide](./services.md) -- detailed guide for every service
- [Testing Guide](./testing.md) -- test every service with in-memory layers
- [Architecture](./architecture.md) -- runtime layer, layer composition, and
  logging pipeline
- [Patterns](./patterns.md) -- dry-run mode, error accumulation, permission
  checking, and more
