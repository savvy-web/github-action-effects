# Building a GitHub Action with Effect

This tutorial walks through building a complete GitHub Action using
`@savvy-web/github-action-effects` for Effect-based services and
`@savvy-web/github-action-builder` for bundling. By the end you will have
a working action that reads inputs with schema validation, logs structured
output, writes a step summary, and sets outputs -- all composed as an
Effect program.

## Prerequisites

Install the following packages:

* `@savvy-web/github-action-builder` -- build tooling that bundles your
  action into a single `dist/index.js` file
* `@savvy-web/github-action-effects` -- Effect services for inputs, outputs,
  and logging
* `effect`, `@effect/platform`, `@effect/platform-node` -- the Effect runtime
  and Node.js platform layer
* `@actions/core`, `@actions/exec`, `@actions/github` -- official GitHub
  Actions toolkit packages

```bash
npm install @savvy-web/github-action-builder @savvy-web/github-action-effects \
  effect @effect/platform @effect/platform-node \
  @actions/core @actions/exec @actions/github
```

## Project Setup

Create an `action.yml` at the repository root that declares your inputs,
outputs, and entry point:

```yaml
name: 'My Effect Action'
description: 'An example action built with Effect'
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
outputs:
  status:
    description: 'Check result status'
  report:
    description: 'JSON report'
runs:
  using: 'node24'
  main: 'dist/index.js'
```

Your TypeScript source lives in `src/main.ts`. The builder compiles and
bundles it into `dist/index.js`.

## Reading Inputs

The `ActionInputs` service reads values from `action.yml` inputs and
validates them against Effect `Schema` definitions. Every method returns an
`Effect` that fails with `ActionInputError` when validation fails.

### Required inputs

Use `get` when the input must be present and must match the schema:

```typescript
import { Schema } from "effect"
import { ActionInputs } from "@savvy-web/github-action-effects"

const packageName = yield* ActionInputs.get("package-name", Schema.String)
```

### Optional inputs

Use `getOptional` for inputs that may be empty. It returns
`Option.Option<A>` -- `Option.none()` when the input is missing or blank,
`Option.some(value)` when present and valid:

```typescript
import { Option } from "effect"
import { ActionInputs } from "@savvy-web/github-action-effects"

const maybeConfig = yield* ActionInputs.getOptional("config", Schema.String)
const configValue = Option.getOrElse(maybeConfig, () => "{}")
```

### JSON inputs

Use `getJson` to read an input as a JSON string, parse it, and validate the
parsed value against a schema in one step:

```typescript
import { Schema } from "effect"
import { ActionInputs } from "@savvy-web/github-action-effects"

const MyConfig = Schema.Struct({
  threshold: Schema.Number,
  packages: Schema.Array(Schema.String),
})

const config = yield* ActionInputs.getJson("config", MyConfig)
// config is typed as { threshold: number; packages: string[] }
```

### Secret inputs

Use `getSecret` to read an input and automatically mask it in logs via
`core.setSecret`:

```typescript
const token = yield* ActionInputs.getSecret("token", Schema.String)
```

### Validation errors

When validation fails, the effect fails with an `ActionInputError`:

```typescript
import { ActionInputError } from "@savvy-web/github-action-effects"

// ActionInputError has three fields:
// - inputName: string   -- the input key from action.yml
// - reason: string      -- human-readable description
// - rawValue: string | undefined -- the raw value received
```

## Configuring Log Level

The library provides a standard pattern for a `log-level` input that
supports `"info"`, `"verbose"`, `"debug"`, and `"auto"`. The `auto` value
resolves to `"debug"` when the `RUNNER_DEBUG` secret is set, and `"info"`
otherwise.

```typescript
import { ActionInputs, LogLevelInput, resolveLogLevel, setLogLevel } from "@savvy-web/github-action-effects"

const logLevelInput = yield* ActionInputs.get("log-level", LogLevelInput)
const resolvedLevel = resolveLogLevel(logLevelInput)
yield* setLogLevel(resolvedLevel)
```

The three concrete levels control what appears in the Actions log:

| Level | Behavior |
| --------- | ---------------------------------------------------------------- |
| `info` | Buffered. Only outcome summaries. Verbose output flushed on fail |
| `verbose` | Unbuffered milestones. Start/finish markers for operations |
| `debug` | Everything. Full command output, internal state, input values |

All messages are always written to `core.debug()` regardless of level, so
they are visible when `ACTIONS_STEP_DEBUG` is enabled in the repository.

## Structured Logging

### Standard Effect logging

Use the regular Effect log functions. The `ActionLoggerLayer` routes them to
GitHub Actions log functions:

```typescript
import { Effect } from "effect"

yield* Effect.log("Processing package")        // core.debug always; user-facing based on level
yield* Effect.logWarning("Deprecated config")  // always user-facing as core.warning
yield* Effect.logError("Check failed")         // always user-facing as core.error
```

### Collapsible groups

Wrap an effect in a collapsible log group using the `ActionLogger` service:

```typescript
import { ActionLogger } from "@savvy-web/github-action-effects"

const logger = yield* ActionLogger

yield* logger.group("Step 1: Validate inputs", Effect.gen(function* () {
  yield* Effect.log("Checking package-name")
  yield* Effect.log("Checking config")
}))
```

### Buffer-on-failure

The `withBuffer` method captures verbose output in memory at `info` level.
On success the buffer is silently discarded. On failure it is flushed to
the log before the error propagates:

```typescript
yield* logger.withBuffer("dependency-check", Effect.gen(function* () {
  yield* Effect.log("Resolving dependencies...")   // buffered at info level
  yield* Effect.log("Checking version ranges...")  // buffered at info level
  // If this effect fails, all buffered lines are flushed
}))
```

At `verbose` or `debug` level, `withBuffer` is a no-op passthrough.

### Annotations

Emit file-level annotations that appear inline on PRs. Three methods map to
the three annotation severity levels in GitHub Actions:

```typescript
// Error annotation (red) -- blocks PR checks
yield* logger.annotationError("Outdated dependency found", {
  file: "src/index.ts",
  startLine: 10,
})

// Warning annotation (yellow)
yield* logger.annotationWarning("Deprecated API usage", {
  file: "src/helpers.ts",
  startLine: 42,
})

// Notice annotation (blue)
yield* logger.annotationNotice("Consider upgrading to v2", {
  file: "src/config.ts",
  startLine: 5,
})
```

## Setting Outputs

The `ActionOutputs` service sets action outputs, writes step summaries,
exports environment variables, and modifies `PATH`.

### String outputs

```typescript
import { ActionOutputs } from "@savvy-web/github-action-effects"

const outputs = yield* ActionOutputs

yield* outputs.set("status", "success")
```

### JSON outputs

Validate and serialize a value as JSON before setting it as an output:

```typescript
import { Schema } from "effect"

const ReportSchema = Schema.Struct({
  total: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
})

yield* outputs.setJson("report", { total: 10, passed: 9, failed: 1 }, ReportSchema)
```

### Step summary

Write markdown content to the job step summary:

```typescript
yield* outputs.summary("## Check Results\n\nAll checks passed.")
```

### Environment variables and PATH

```typescript
yield* outputs.exportVariable("MY_VAR", "value")
yield* outputs.addPath("/usr/local/bin")
```

## Building Reports with GFM

The library exports pure functions for composing GitHub Flavored Markdown.
These are especially useful for step summaries.

```typescript
import {
  table,
  statusIcon,
  heading,
  details,
  checklist,
  bold,
  list,
} from "@savvy-web/github-action-effects"
```

### Tables

```typescript
const reportTable = table(
  ["Package", "Status", "Version"],
  results.map((r) => [
    r.name,
    statusIcon(r.passed ? "pass" : "fail"),
    r.version,
  ])
)
```

The `statusIcon` function maps a `Status` value to its corresponding
indicator: `"pass"`, `"fail"`, `"skip"`, or `"warn"`.

### Composing a summary

```typescript
const checklistItems = [
  { label: "Dependencies resolved", checked: true },
  { label: "Version constraints satisfied", checked: true },
  { label: "No security advisories", checked: false },
]

const summaryContent = [
  heading("Check Results", 2),
  reportTable,
  "",
  heading("Checklist", 3),
  checklist(checklistItems),
  "",
  details("Full Details", detailedOutput),
].join("\n\n")

yield* outputs.summary(summaryContent)
```

### Other GFM helpers

```typescript
bold("important text")              // **important text**
list(["item one", "item two"])      // - item one\n- item two
details("Click to expand", content) // <details> block
heading("Section", 3)              // ### Section
```

## Composing the Layer and Running

Here is a complete `src/main.ts` that ties everything together:

```typescript
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import {
  ActionInputs,
  ActionInputsLive,
  ActionLogger,
  ActionLoggerLive,
  ActionLoggerLayer,
  ActionOutputs,
  ActionOutputsLive,
  LogLevelInput,
  resolveLogLevel,
  setLogLevel,
  heading,
  table,
  statusIcon,
} from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const logger = yield* ActionLogger
  const outputs = yield* ActionOutputs

  // Configure log level
  const logLevelInput = yield* inputs.get("log-level", LogLevelInput)
  yield* setLogLevel(resolveLogLevel(logLevelInput))

  // Read inputs
  const packageName = yield* inputs.get("package-name", Schema.String)
  yield* Effect.log(`Checking package: ${packageName}`)

  // Do work inside a log group
  const result = yield* logger.group("Run checks", Effect.gen(function* () {
    yield* Effect.log("Resolving dependencies")
    yield* Effect.log("Running validation")
    return { passed: true, version: "1.2.3" }
  }))

  // Set outputs
  yield* outputs.set("status", result.passed ? "success" : "failure")

  // Write step summary
  const summaryTable = table(
    ["Package", "Status", "Version"],
    [[packageName, statusIcon(result.passed ? "pass" : "fail"), result.version]]
  )

  yield* outputs.summary([heading("Check Results", 2), summaryTable].join("\n\n"))

  yield* Effect.log("Action completed")
})

const MainLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
)

const runnable = program.pipe(
  Effect.provide(MainLayer),
  Effect.provide(ActionLoggerLayer),
)

NodeRuntime.runMain(runnable)
```

### Why ActionLoggerLayer is provided separately

`ActionLoggerLayer` is a `Layer<never>` -- it does not provide a service tag.
Instead, it replaces the default Effect logger with one that routes to GitHub
Actions log functions (`core.info`, `core.warning`, `core.error`,
`core.debug`). Because it modifies the fiber's logger rather than providing a
service, it must be applied with a separate `Effect.provide` call after the
service layer.

`ActionLoggerLive` is a separate `Layer<ActionLogger>` that provides the
`ActionLogger` service (groups, buffering, annotation methods). Both are
needed:

* `ActionLoggerLive` -- provides the `ActionLogger` service for
  `yield* ActionLogger`
* `ActionLoggerLayer` -- installs the custom logger so `Effect.log` routes
  to GitHub Actions

## Error Handling

### Error types

The library defines two tagged error classes:

* `ActionInputError` -- raised by `ActionInputs` methods when an input is
  missing or fails schema validation. Fields: `inputName`, `reason`,
  `rawValue`.
* `ActionOutputError` -- raised by `ActionOutputs.setJson` and
  `ActionOutputs.summary` on serialization or write failures. Fields:
  `outputName`, `reason`.

### Catching specific errors

Use `Effect.catchTag` to handle specific error types:

```typescript
const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const outputs = yield* ActionOutputs

  const packageName = yield* inputs.get("package-name", Schema.String).pipe(
    Effect.catchTag("ActionInputError", (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`Invalid input "${error.inputName}": ${error.reason}`)
        yield* outputs.set("status", "failure")
        return yield* Effect.fail(error)
      })
    )
  )
})
```

### Top-level error handling

For a production action, catch all errors at the top level and call
`core.setFailed` so the workflow step fails with a clear message:

```typescript
import * as core from "@actions/core"

const runnable = program.pipe(
  Effect.provide(MainLayer),
  Effect.provide(ActionLoggerLayer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      const message = "_tag" in error ? `${error._tag}: ${error.reason}` : String(error)
      core.setFailed(message)
    })
  ),
)

NodeRuntime.runMain(runnable)
```

## Next Steps

* [Testing Guide](./testing.md) -- how to test your action with the provided
  test layers (`ActionInputsTest`, `ActionOutputsTest`, `ActionLoggerTest`)
* [Architecture](./architecture.md) -- deeper look at the service design,
  layer composition, and logging pipeline
