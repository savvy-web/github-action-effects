# Building a GitHub Action with Effect

This tutorial walks through building a complete GitHub Action using
`@savvy-web/github-action-effects`. By the end you will have a working
action with schema-validated inputs, structured logging, a step summary,
and typed outputs.

## Prerequisites

```bash
npm install @savvy-web/github-action-effects effect @actions/core @effect/platform @effect/platform-node @effect/cluster @effect/rpc @effect/sql
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
  config:
    description: 'JSON configuration'
    required: false
  log-level:
    description: 'Log level (info, verbose, debug, auto)'
    required: false
    default: 'auto'
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
import { Effect, Schema } from "effect"
import {
  Action,
  ActionInputs,
  ActionLogger,
  ActionOutputs,
  GithubMarkdown,
  LogLevelInput,
} from "@savvy-web/github-action-effects"

// -- Schemas for structured inputs and outputs --

const ConfigSchema = Schema.Struct({
  threshold: Schema.Number,
  packages: Schema.Array(Schema.String),
})

const ReportSchema = Schema.Struct({
  total: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
})

// -- The program --

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const logger = yield* ActionLogger
  const outputs = yield* ActionOutputs

  // 1. Configure log level from the standardized input
  const logLevelInput = yield* inputs.get("log-level", LogLevelInput)
  yield* Action.setLogLevel(Action.resolveLogLevel(logLevelInput))

  // 2. Read inputs — individually or in batch
  const packageName = yield* inputs.get("package-name", Schema.String)
  const dryRun = yield* inputs.getBooleanOptional("dry-run", false)
  const config = yield* inputs.getJson("config", ConfigSchema)

  yield* Effect.log(`Checking ${packageName} (dry-run: ${dryRun})`)

  // 3. Do work inside a collapsible log group
  const results = yield* logger.group("Run checks", Effect.gen(function* () {
    yield* Effect.log("Resolving dependencies")
    yield* Effect.log("Running validation")
    return config.packages.map((pkg) => ({
      name: pkg,
      passed: true,
      version: "1.0.0",
    }))
  }))

  // 4. Use buffer-on-failure for noisy operations
  yield* logger.withBuffer("detailed-analysis", Effect.gen(function* () {
    for (const r of results) {
      yield* Effect.log(`Analyzing ${r.name}...`)  // buffered at info level
    }
    // If this fails, all buffered lines flush to the log automatically
  }))

  // 5. Set typed outputs
  yield* outputs.set("status", "success")
  yield* outputs.setJson("report", {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
  }, ReportSchema)

  // 6. Write a step summary with GFM builders
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
    "",
    GithubMarkdown.details("Configuration", GithubMarkdown.codeBlock(
      JSON.stringify(config, null, 2), "json"
    )),
  ].join("\n\n"))

  // 7. Emit annotations for PR inline feedback
  yield* logger.annotationWarning("Deprecated API usage", {
    file: "src/helpers.ts",
    startLine: 42,
  })

  yield* Effect.log("Action completed")
})

// 8. Run it — provides all core layers and catches errors automatically
Action.run(program)
```

### What each section does

1. **Log level** — Reads the `log-level` input, resolves `"auto"` based on
   `RUNNER_DEBUG`, and sets the level for this fiber. All subsequent
   `Effect.log` calls respect it.

2. **Inputs** — `get` for required strings, `getBooleanOptional` for
   optional booleans with defaults, `getJson` for parsed+validated JSON.
   See [architecture.md](./architecture.md#actioninputs) for all methods.

3. **Groups** — `logger.group` wraps the effect in a collapsible section in
   the Actions UI. The return value passes through.

4. **Buffer-on-failure** — `logger.withBuffer` captures verbose output at
   `info` level. On success the buffer is silently discarded. On failure
   it flushes before the error propagates, giving full context.

5. **Outputs** — `set` for strings, `setJson` for schema-validated JSON.
   Values appear in `${{ steps.id.outputs.status }}` in downstream workflow
   steps.

6. **Step summary** — `outputs.summary` writes markdown to the job summary.
   `GithubMarkdown.*` helpers build tables, headings, details blocks, etc.

7. **Annotations** — `annotationError`, `annotationWarning`, and
   `annotationNotice` appear inline on PR diffs at the specified file and
   line.

8. **Action.run** — Provides `ActionInputsLive`, `ActionLoggerLive`,
   `ActionOutputsLive`, and `NodeContext.layer` (for `FileSystem`, `Path`,
   `Terminal`, `CommandExecutor`, `WorkerManager` from `@effect/platform`),
   installs the Effect logger, and catches all errors with `core.setFailed`.

## Using Action.parseInputs

For actions with many inputs, batch reading is cleaner than individual
calls:

```typescript
const program = Effect.gen(function* () {
  const { packageName, config, dryRun } = yield* Action.parseInputs({
    packageName: { schema: Schema.String, required: true },
    config: { schema: ConfigSchema, json: true },
    dryRun: { schema: Schema.Boolean, default: false },
  })
  // ...
})
```

An optional second argument accepts a cross-validation function. See
[architecture.md](./architecture.md#actionparseinputs) for details.

## Adding Multi-Phase State

Some actions run in multiple phases — `pre`, `main`, and `post`. The
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

### pre.ts — save state

```typescript
import { Effect, Schema } from "effect"
import { Action, ActionState, ActionStateLive } from "@savvy-web/github-action-effects"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

const program = Effect.gen(function* () {
  const state = yield* ActionState
  yield* state.save("timing", { startedAt: Date.now() }, TimingSchema)
})

Action.run(program, ActionStateLive)
```

### post.ts — read state

```typescript
import { Effect, Schema } from "effect"
import { Action, ActionState, ActionStateLive, ActionOutputs } from "@savvy-web/github-action-effects"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

const program = Effect.gen(function* () {
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const timing = yield* state.get("timing", TimingSchema)
  const elapsed = Date.now() - timing.startedAt
  yield* outputs.set("duration-ms", String(elapsed))
})

Action.run(program, ActionStateLive)
```

`ActionStateLive` is not included in `Action.run`'s core layers because
not all actions need it. Pass it as the second argument when you do.

## Error Handling

`Action.run` catches all errors and calls `core.setFailed` automatically.
For granular control, use `Effect.catchTag`:

```typescript
const packageName = yield* inputs.get("package-name", Schema.String).pipe(
  Effect.catchTag("ActionInputError", (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(`Invalid input "${error.inputName}": ${error.reason}`)
      return yield* Effect.fail(error)
    })
  )
)
```

The three error types -- `ActionInputError`, `ActionOutputError`, and
`ActionStateError` -- are all `Data.TaggedError` instances. See
[architecture.md](./architecture.md#error-types) for their fields.

For custom error handlers that extract a human-readable message from an
Effect `Cause`, use `Action.formatCause(cause)`. It returns a `[Tag] message`
string that is parseable by both humans and AI. See
[patterns.md](./patterns.md#actionformatcause) for details.

## Next Steps

* [Services Guide](./services.md) -- detailed guide for every service
* [Testing Guide](./testing.md) -- test every service with in-memory layers
* [Architecture](./architecture.md) -- API reference, layer composition, and
  logging pipeline
* [OpenTelemetry](./otel.md) -- OTel configuration and tracing guide
* [Patterns](./patterns.md) -- dry-run mode, error accumulation, permission
  checking, and more
