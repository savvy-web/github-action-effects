# Architecture

`@savvy-web/github-action-effects` is an Effect-based utility library for
building GitHub Actions. It follows the Effect services and layers pattern:
each capability is defined as an abstract service interface, with separate
live implementations (wrapping `@actions/core`) and test implementations
(capturing calls in memory). This separation makes action logic fully
testable without mocking.

## Source Layout

```text
src/
  services/    - Effect service definitions (interfaces + tags)
  layers/      - Live and Test implementations of each service
  errors/      - Tagged error types
  schemas/     - Effect Schema definitions
  utils/       - Pure utility functions (GFM builders)
```

## Services

Each service is defined as a TypeScript interface paired with a
`Context.GenericTag` for dependency injection. The tag and interface share
the same name via Effect's dual-purpose pattern.

### ActionInputs

Reads GitHub Action inputs with schema validation.

| Method | Signature | Description |
| --- | --- | --- |
| `get` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input, validate against schema |
| `getOptional` | `(name, schema) => Effect<Option<A>, ActionInputError>` | Read an optional input; returns `Option.none()` if empty |
| `getSecret` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input and mask it in logs via `core.setSecret` |
| `getJson` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input, parse as JSON, then validate against schema |

All methods that accept a `schema` parameter use `Schema.decode` to validate
the raw string (or parsed JSON) value. Validation failures are mapped to
`ActionInputError` with the input name, reason, and raw value.

### ActionLogger

Provides GitHub Actions-specific logging operations beyond what the Effect
Logger handles. The core log-level routing is handled separately by
`ActionLoggerLayer` (see Logging System below). This service adds:

| Method | Signature | Description |
| --- | --- | --- |
| `group` | `(name, effect) => Effect<A, E, R>` | Run an effect inside a collapsible log group |
| `withBuffer` | `(label, effect) => Effect<A, E, R>` | Run an effect with buffered logging (buffer-on-failure pattern) |
| `annotationError` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.error` (red, blocks PR checks) |
| `annotationWarning` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.warning` (yellow) |
| `annotationNotice` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.notice` (blue) |

### ActionOutputs

Sets GitHub Action outputs, step summaries, environment variables, and PATH
entries.

| Method | Signature | Description |
| --- | --- | --- |
| `set` | `(name, value) => Effect<void>` | Set a string output value |
| `setJson` | `(name, value, schema) => Effect<void, ActionOutputError>` | Encode via schema, serialize to JSON, set as output |
| `summary` | `(content) => Effect<void, ActionOutputError>` | Write markdown to the step summary |
| `exportVariable` | `(name, value) => Effect<void>` | Export an environment variable for subsequent steps |
| `addPath` | `(path) => Effect<void>` | Add a directory to PATH for subsequent steps |

`setJson` uses `Schema.encode` to validate before serializing, ensuring
the output conforms to the schema.

## Layer Composition

Services use `Context.GenericTag` (not class-based `Tag`) for their
dependency injection tokens. Live layers wrap `@actions/core` functions.
Compose them with `Layer.mergeAll` for a complete runtime:

```typescript
const MainLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
)
```

There is an important distinction between two exports from
`ActionLoggerLive.ts`:

* **`ActionLoggerLive`** is a `Layer<ActionLogger>` that provides the service
  (group, withBuffer, annotationError, annotationWarning, annotationNotice).
* **`ActionLoggerLayer`** is a `Layer<never>` that replaces Effect's default
  `Logger` with a GitHub Actions-aware logger. It does not provide a service
  to the context; it reconfigures how `Effect.log` and friends behave.

Both are typically needed. `ActionLoggerLayer` must be provided separately
because it operates on the logger infrastructure rather than providing a
context service:

```typescript
const program = myAction.pipe(
  Effect.provide(MainLayer),
  Effect.provide(ActionLoggerLayer),
)
```

## Logging System

The logging architecture has two parts: a custom Effect Logger (installed via
`ActionLoggerLayer`) and the `ActionLogger` service for structural operations.

### CurrentLogLevel and setLogLevel

`CurrentLogLevel` is a `FiberRef<ActionLogLevel>` that holds the active log
level for the current fiber. It defaults to `"info"`. Use `setLogLevel` to
change it within a scoped region.

### makeActionLogger

`makeActionLogger()` creates an `Effect.Logger` with two output channels:

1. **Shadow channel** -- every log message is always written to `core.debug()`.
   GitHub only displays these when `ACTIONS_STEP_DEBUG` is enabled, so this
   acts as a full diagnostic trace at zero visible cost.
2. **User-facing channel** -- messages are conditionally emitted based on the
   current `ActionLogLevel` (read from `CurrentLogLevel` via `FiberRefs`).

### shouldEmitUserFacing

The user-facing emission rules for each action log level:

| ActionLogLevel | User-facing threshold |
| --- | --- |
| `debug` | All messages (always emit) |
| `verbose` | `LogLevel.Info` and above |
| `info` | `LogLevel.Warning` and above |

When emitting to user-facing output, `Error`-level and above maps to
`core.error()`, `Warning`-level maps to `core.warning()`, and everything
else maps to `core.info()`.

### withBuffer

The buffer-on-failure pattern optimizes output at `info` level:

1. If the current level is not `"info"`, the effect runs normally with no
   buffering.
2. At `"info"` level, a temporary logger is installed that:
   * Writes everything to `core.debug()` (shadow channel).
   * Emits `Warning` and above immediately.
   * Captures all other messages in an in-memory buffer.
3. On success, the buffer is discarded -- the user sees only warnings and
   errors.
4. On failure (via `tapErrorCause`), the buffer is flushed to `core.info()`
   with labeled delimiters, giving full context for debugging.

### LogLevelInput and resolveLogLevel

`LogLevelInput` is an Effect Schema accepting `"info"`, `"verbose"`,
`"debug"`, or `"auto"`. The `resolveLogLevel` function converts a
`LogLevelInput` to a concrete `ActionLogLevel`:

* `"info"`, `"verbose"`, `"debug"` pass through unchanged.
* `"auto"` resolves to `"debug"` when `RUNNER_DEBUG` is `"1"`, otherwise
  `"info"`.

## Error Types

Both error types use `Data.TaggedError` for structural equality and pattern
matching.

### ActionInputError

* **Tag**: `"ActionInputError"`
* **Fields**: `inputName` (string), `reason` (string), `rawValue` (string
  or undefined)

### ActionOutputError

* **Tag**: `"ActionOutputError"`
* **Fields**: `outputName` (string), `reason` (string)

Each error module exports a `Base` class (e.g., `ActionInputErrorBase`)
created by `Data.TaggedError(tag)`. The actual error class extends this
base. The base is exported separately for compatibility with api-extractor,
which requires the intermediate class to be visible.

## GFM Builders

Pure functions in `src/utils/GithubMarkdown.ts` for building GitHub Flavored
Markdown strings. None of these have side effects or dependencies.

| Function | Description |
| --- | --- |
| `table(headers, rows)` | Build a GFM table from header and row arrays |
| `heading(text, level?)` | Build a markdown heading (default level 2) |
| `details(summary, content)` | Build a collapsible `<details>` block |
| `checklist(items)` | Build a checkbox list from `ChecklistItem` array |
| `statusIcon(status)` | Map a `Status` to its unicode indicator |
| `bold(text)` | Wrap text in `**bold**` |
| `code(text)` | Wrap text in inline backticks |
| `codeBlock(content, language?)` | Build a fenced code block |
| `link(text, url)` | Build an inline markdown link |
| `list(items)` | Build a bulleted list |
| `rule()` | Horizontal rule (`---`) |

### Schemas

Three schemas in `src/schemas/GithubMarkdown.ts` support the builders:

* **`Status`** -- Literal union: `"pass"`, `"fail"`, `"skip"`, `"warn"`
* **`ChecklistItem`** -- Struct with `label` (string) and `checked` (boolean)
* **`CapturedOutput`** -- Struct with `name` (string) and `value` (string),
  used by test layers to record output calls

## Test Layers

Each service has a corresponding test implementation in `src/layers/`:

* `ActionInputsTest(inputs)` -- accepts a `Record<string, string>` and
  returns a layer that reads from it instead of `@actions/core`.
* `ActionLoggerTest` -- namespace with `empty()` and `layer(state)`. Captures
  groups, annotations (with type), and flushed buffers in
  `ActionLoggerTestState`.
* `ActionOutputsTest` -- namespace with `empty()` and `layer(state)`. Captures
  outputs, summaries, exported variables, and paths in
  `ActionOutputsTestState`.

The namespace pattern (`empty()` to create state, `layer(state)` to create
the layer) lets tests inspect captured operations after the effect completes.

See [docs/testing.md](./testing.md) for full usage details.
