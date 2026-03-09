# Error Handling

`@savvy-web/github-action-effects` provides structured error handling at
multiple levels: tagged errors for pattern matching, `Action.formatCause` for
human-readable extraction, and `Action.run` for automatic top-level handling.

## Tagged Errors

All service errors use `Data.TaggedError` with a `_tag` field for pattern
matching via `Effect.catchTag`:

```typescript
import { Effect, Schema } from "effect";
import { ActionInputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs;
  const name = yield* inputs.get("package-name", Schema.String);
}).pipe(
  Effect.catchTag("ActionInputError", (e) =>
    Effect.logError(`Bad input "${e.inputName}": ${e.reason}`),
  ),
);
```

Each error type carries structured fields (e.g., `inputName`, `reason`,
`operation`) that provide context about what went wrong. See
[architecture.md](./architecture.md#error-types) for the full error catalog.

## Action.formatCause

`Action.formatCause` extracts a human-readable error message from an Effect
`Cause` object. It is exported on the `Action` namespace for use in custom
error handlers.

```typescript
import { Effect, Cause } from "effect";
import { Action } from "@savvy-web/github-action-effects";

const program = myEffect.pipe(
  Effect.catchAllCause((cause) => {
    const message = Action.formatCause(cause);
    // => "[ActionInputError] Missing required input: token"
    return Effect.logError(message);
  }),
);
```

### Fallback Chain

`formatCause` always produces a non-empty string. It uses a three-step
fallback chain:

1. **`Cause.squash`** -- Extracts the underlying error from the `Cause`.
   - If the error is a `TaggedError` (has `_tag`), formats as
     `[Tag] reason` (or `[Tag] message` if no `reason` field).
   - If the error is a standard `Error`, formats as `[Error] message`.
   - If the error is an unknown shape, formats as `[UnknownError] <json>`.
2. **`Cause.pretty`** -- Fallback for interrupts, empty causes, and other
   cause types that `squash` cannot handle.
3. **Sentinel** -- `"Unknown error (no diagnostic information available)"`
   as a last resort when both `squash` and `pretty` fail or return empty.

### The `[Tag] message` Format

The output format `[Tag] message` is designed for consistent parseability:

- **Humans** can quickly identify the error type from the bracketed tag.
- **AI systems** (e.g., LLMs analyzing CI logs) can extract the tag for
  classification and the message for context.
- **Log parsers** can use a simple regex like `\[(\w+)\] (.+)` to extract
  structured data from error lines.

Examples:

```text
[ActionInputError] Missing required input: token
[GitHubClientError] 404 Not Found
[CommandRunnerError] Process exited with code 1
[Error] ENOENT: no such file or directory
[UnknownError] {"code":"ETIMEDOUT"}
```

## How Action.run Handles Errors

`Action.run` wraps the user's program with `Effect.catchAllCause` to ensure
no error goes unhandled:

1. **`catchAllCause`** catches all failures, defects, and interrupts.
2. The cause is formatted via `Cause.pretty` and passed to `core.setFailed()`.
3. A last-resort `.catch()` on the promise sets `process.exitCode = 1` if
   even `setFailed` fails.

This means action authors do not need to handle errors at the top level --
`Action.run` ensures the action always exits cleanly with a failure message
visible in the GitHub Actions UI.

For custom error handling, use `Effect.catchTag` or `Effect.catchAllCause`
within your program before `Action.run` catches it:

```typescript
import { Effect, Layer } from "effect";
import {
  Action,
  ActionOutputs,
  GithubMarkdown,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  // ... your logic
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.gen(function* () {
      const outputs = yield* ActionOutputs;
      const message = Action.formatCause(cause);
      yield* outputs.summary(
        GithubMarkdown.codeBlock(message, "text"),
      );
      yield* Effect.fail(cause);
    }),
  ),
);

Action.run(program);
```

## Using formatCause in Custom Error Handlers

`Action.formatCause` is useful beyond `Action.run`. Any consumer code that
catches an Effect `Cause` can use it:

```typescript
import { Effect } from "effect";
import { Action, CheckRun } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const checkRun = yield* CheckRun;

  yield* checkRun.withCheckRun("my-check", headSha, (id) =>
    myAnalysis.pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          const message = Action.formatCause(cause);
          yield* checkRun.complete(id, "failure", {
            title: "Analysis Failed",
            summary: message,
          });
          yield* Effect.failCause(cause);
        }),
      ),
    ),
  );
});
```

## Error Accumulation

For operations that should continue after individual failures, use the
`ErrorAccumulator` namespace. See [patterns.md](./patterns.md#error-accumulation)
for details.
