# Error handling

Error handling in `@savvy-web/github-action-effects` works at three layers. Tagged errors let you match on a specific failure with `Effect.catchTag`. `Action.formatCause` pulls a readable message out of an Effect `Cause`. `Action.run` catches whatever reaches the top of your program so the action still exits cleanly.

## Tagged errors

All service errors use `Data.TaggedError` with a `_tag` field for pattern matching via `Effect.catchTag`:

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  yield* outputs.set("status", "success")
}).pipe(
  Effect.catchTag("ActionOutputError", (e) =>
    Effect.logError(`Output error "${e.outputName}": ${e.reason}`),
  ),
)
```

Each error type carries structured fields — `outputName`, `reason`, `operation` and so on — so the handler knows exactly what failed. See [architecture](./07-architecture.md#error-types) for the full error catalog.

## Action.formatCause

`Action.formatCause` takes an Effect `Cause` and returns a readable error message. It lives on the `Action` namespace, so you can call it from your own error handlers.

```typescript
import { Effect, Cause } from "effect"
import { Action } from "@savvy-web/github-action-effects"

const program = myEffect.pipe(
  Effect.catchAllCause((cause) => {
    const message = Action.formatCause(cause)
    // => "[ActionOutputError] Failed to write summary"
    return Effect.logError(message)
  }),
)
```

### Fallback chain

`formatCause` always returns a non-empty string. It tries three things in turn:

1. **`Cause.squash`** — Extracts the underlying error from the `Cause`. If the error is a `TaggedError` (has `_tag`), formats as `[Tag] reason` (or `[Tag] message` if no `reason` field). If the error is a standard `Error`, formats as `[Error] message`. If the error is an unknown shape, formats as `[UnknownError] <json>`.
2. **`Cause.pretty`** — Fallback for interrupts, empty causes and other cause types that `squash` cannot handle.
3. **Sentinel** — `"Unknown error (no diagnostic information available)"` as a last resort when both `squash` and `pretty` fail or return empty.

### The `[Tag] message` format

The `[Tag] message` shape stays the same for every error, which makes the line easy to scan and easy to parse. A reader spots the error type at a glance from the bracketed tag. A log parser pulls the same two fields out with a regex like `\[(\w+)\] (.+)` — tag first, message second.

Examples:

```text
[ActionOutputError] Failed to write step summary
[GitHubClientError] 404 Not Found
[CommandRunnerError] Process exited with code 1
[Error] ENOENT: no such file or directory
[UnknownError] {"code":"ETIMEDOUT"}
```

## How Action.run handles errors

`Action.run` wraps the user's program with `Effect.catchAllCause` to ensure no error goes unhandled:

1. **`catchAllCause`** catches all failures, defects and interrupts.
2. The cause is formatted via `Action.formatCause` and emitted as an `::error::` workflow command.
3. A JS stack trace is included if available.
4. The Effect span trace is emitted via `::debug::` (visible with `RUNNER_DEBUG=1`).
5. `process.exitCode` is set to `1`.
6. A last-resort `.catch()` on the promise sets `process.exitCode = 1` if even the error handler fails.

So you do not have to handle errors at the top level yourself. Whatever goes wrong, the action exits cleanly and the failure message shows up in the GitHub Actions UI.

For custom error handling, use `Effect.catchTag` or `Effect.catchAllCause` within your program before `Action.run` catches it:

```typescript
import { Effect, Layer } from "effect"
import {
  Action,
  ActionOutputs,
  GithubMarkdown,
} from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  // ... your logic
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.gen(function* () {
      const outputs = yield* ActionOutputs
      const message = Action.formatCause(cause)
      yield* outputs.summary(
        GithubMarkdown.codeBlock(message, "text"),
      )
      yield* Effect.fail(cause)
    }),
  ),
)

Action.run(program)
```

## Using formatCause in custom error handlers

`Action.formatCause` is not tied to `Action.run`. Anywhere you catch an Effect `Cause`, you can format it the same way:

```typescript
import { Effect } from "effect"
import { Action, CheckRun } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const checkRun = yield* CheckRun

  yield* checkRun.withCheckRun("my-check", headSha, (id) =>
    myAnalysis.pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          const message = Action.formatCause(cause)
          yield* checkRun.complete(id, "failure", {
            title: "Analysis Failed",
            summary: message,
          })
          yield* Effect.failCause(cause)
        }),
      ),
    ),
  )
})
```

## Error accumulation

For operations that should continue after individual failures, use the `ErrorAccumulator` namespace. See [common patterns](./04-patterns.md#error-accumulation) for details.
