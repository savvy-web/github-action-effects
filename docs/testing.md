# Testing GitHub Actions

This guide covers how to test GitHub Actions built with
`@savvy-web/github-action-effects`. Every service in the library ships with a
companion test layer that captures operations in memory, so your tests never
call `@actions/core` and never require a real GitHub Actions runner environment.

## Overview

Test layers come in two shapes:

* **Namespace objects** (`ActionLoggerTest`, `ActionOutputsTest`,
  `ActionStateTest`) expose an `empty()` function that creates a mutable state
  container and a `layer()` function that builds an Effect `Layer` backed by
  that state. After running your effect, you inspect the state to verify what
  happened.
* **Simple function** (`ActionInputsTest`) takes a `Record<string, string>` of
  input name/value pairs and returns a `Layer` directly. There is no mutable
  state because inputs are read-only.

## Importing for Tests

Use the `/testing` subpath in all test files:

```typescript
import {
  ActionInputs,
  ActionInputsTest,
  ActionLogger,
  ActionLoggerTest,
} from "@savvy-web/github-action-effects/testing"
```

**When to use `@savvy-web/github-action-effects/testing`** (test files):

* Provides all service tags, test layers, errors, schemas, and utils
* Does **not** import `@actions/core`, `@actions/github`, or any other
  `@actions/*` package — those are only loaded by the platform wrapper Live
  layers
* All 32 Live layers (`ActionInputsLive`, `ActionOutputsLive`, etc.) are also
  exported from `/testing` — they no longer import `@actions/*` directly
* The platform wrapper service tags (`ActionsCore`, `ActionsGitHub`,
  `ActionsExec`, `ActionsCache`, `ActionsToolCache`, `OctokitAuthApp`) are
  exported so you can construct mock platform layers

**When to use `@savvy-web/github-action-effects`** (production code):

* Includes everything from `/testing` plus the platform wrapper Live layers
  (`ActionsCoreLive`, `ActionsGitHubLive`, etc.), `ActionsPlatformLive`, and
  the `Action` namespace

**Important:** The `Action` namespace is **not** available from `/testing`.
`Action` statically imports `ActionsCoreLive` (the live platform wrapper that
calls `@actions/core` directly), which would defeat the purpose of isolating
tests from `@actions/*` imports. In production entry points (`main.ts`,
`pre.ts`, `post.ts`), import from the main package.

## Test Layer APIs

### ActionInputsTest

`ActionInputsTest` is a function that accepts a record mapping input names to
their string values and returns a `Layer<ActionInputs>`.

```typescript
import { ActionInputsTest } from "@savvy-web/github-action-effects/testing"

const layer = ActionInputsTest({
  "package-name": "my-pkg",
  "token": "ghp_abc",
})
```

The returned layer supports all service methods (`get`, `getOptional`,
`getSecret`, `getJson`, `getMultiline`, `getBoolean`, `getBooleanOptional`).
Missing keys cause the effect to fail with an `ActionInputError`, and values
are validated against the provided `Schema` just like the live layer.

### ActionOutputsTest

`ActionOutputsTest` is a namespace object with `empty()` and `layer()`.

```typescript
import { ActionOutputsTest } from "@savvy-web/github-action-effects/testing"

const state = ActionOutputsTest.empty()
const layer = ActionOutputsTest.layer(state)
```

After running your effect against this layer, inspect `state` to verify which
outputs were set.

**State shape (`ActionOutputsTestState`):**

| Field | Type | Description |
| --- | --- | --- |
| `outputs` | `Array<{ name: string, value: string }>` | Values set via `set` or `setJson` |
| `variables` | `Array<{ name: string, value: string }>` | Values set via `exportVariable` |
| `paths` | `Array<string>` | Paths added via `addPath` |
| `summaries` | `Array<string>` | Markdown written via `summary` |
| `failed` | `Array<string>` | Messages passed to `setFailed` |
| `secrets` | `Array<string>` | Values registered via `setSecret` |

### ActionLoggerTest

`ActionLoggerTest` is a namespace object with `empty()` and `layer()`.

```typescript
import { ActionLoggerTest } from "@savvy-web/github-action-effects/testing"

const state = ActionLoggerTest.empty()
const layer = ActionLoggerTest.layer(state)
```

After running your effect against this layer, inspect `state` to verify
logging behavior.

**State shape (`ActionLoggerTestState`):**

| Field | Type | Description |
| --- | --- | --- |
| `entries` | `Array<{ level: string, message: string }>` | Individual log entries |
| `groups` | `Array<{ name: string, entries: Array<{ level, message }> }>` | Log groups opened via `group` |
| `annotations` | `Array<{ type: string, message: string, properties?: AnnotationProperties }>` | File/line annotations (type is `"error"`, `"warning"`, or `"notice"`) |
| `flushedBuffers` | `Array<{ label: string, entries: Array<string> }>` | Buffers flushed on failure via `withBuffer` |

### ActionStateTest

`ActionStateTest` is a namespace object with `empty()` and `layer()`.

```typescript
import { ActionStateTest } from "@savvy-web/github-action-effects/testing"

const state = ActionStateTest.empty()
const layer = ActionStateTest.layer(state)
```

The test state uses an in-memory `Map<string, string>`. Pre-populate entries
to simulate state from a previous action phase:

```typescript
const state = ActionStateTest.empty()
// Simulate state saved by pre.ts
state.entries.set("timing", JSON.stringify({ startedAt: 1000 }))
const layer = ActionStateTest.layer(state)
```

**State shape (`ActionStateTestState`):**

| Field | Type | Description |
| --- | --- | --- |
| `entries` | `Map<string, string>` | Stored state entries (key to JSON string) |

## Composing Test Layers

When your action uses multiple services, merge the test layers together with
`Layer.mergeAll`:

```typescript
import { Effect, Layer } from "effect"
import {
  ActionInputsTest,
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
} from "@savvy-web/github-action-effects/testing"

const outputState = ActionOutputsTest.empty()
const logState = ActionLoggerTest.empty()
const stateState = ActionStateTest.empty()

const TestLayer = Layer.mergeAll(
  ActionInputsTest({ "package-name": "my-pkg" }),
  ActionOutputsTest.layer(outputState),
  ActionLoggerTest.layer(logState),
  ActionStateTest.layer(stateState),
)
```

Then provide the merged layer to any effect that requires those services.

## Testing Patterns

### Testing input validation

Verify that missing or invalid inputs produce failures:

```typescript
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ActionInputs, ActionInputsTest } from "@savvy-web/github-action-effects/testing"

describe("input validation", () => {
  it("fails on missing required input", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.provide(
          Effect.flatMap(ActionInputs, (svc) => svc.get("missing", Schema.String)),
          ActionInputsTest({}),
        ),
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("reads a valid input", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(ActionInputs, (svc) => svc.get("name", Schema.String)),
        ActionInputsTest({ name: "hello" }),
      ),
    )
    expect(result).toBe("hello")
  })
})
```

### Testing multiline and boolean inputs

```typescript
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ActionInputs, ActionInputsTest } from "@savvy-web/github-action-effects/testing"

describe("extended input methods", () => {
  it("reads multiline input", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(ActionInputs, (svc) =>
          svc.getMultiline("packages", Schema.String)
        ),
        ActionInputsTest({ packages: "pkg-a\npkg-b\n# comment\n\npkg-c" }),
      ),
    )
    expect(result).toEqual(["pkg-a", "pkg-b", "pkg-c"])
  })

  it("reads boolean input", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(ActionInputs, (svc) => svc.getBoolean("dry-run")),
        ActionInputsTest({ "dry-run": "true" }),
      ),
    )
    expect(result).toBe(true)
  })

  it("reads optional boolean with default", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(ActionInputs, (svc) =>
          svc.getBooleanOptional("verbose", false)
        ),
        ActionInputsTest({}),
      ),
    )
    expect(result).toBe(false)
  })
})
```

### Testing Action.parseInputs

`Action.parseInputs` is only available from the main package entry point
(not from `/testing`). Test it by importing `Action` from the main package in
tests that specifically test production-entry logic, or refactor the parsing
into a standalone function that accepts injected services.

```typescript
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { Action } from "@savvy-web/github-action-effects"
import { ActionInputsTest } from "@savvy-web/github-action-effects/testing"

describe("Action.parseInputs", () => {
  it("reads all inputs from config", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        Action.parseInputs({
          name: { schema: Schema.String, required: true },
          count: { schema: Schema.NumberFromString, default: 1 },
        }),
        ActionInputsTest({ name: "test" }),
      ),
    )
    expect(result).toEqual({ name: "test", count: 1 })
  })
})
```

### Testing outputs

Capture outputs in the test state and assert against them:

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionOutputs, ActionOutputsTest } from "@savvy-web/github-action-effects/testing"

describe("outputs", () => {
  it("sets output correctly", async () => {
    const state = ActionOutputsTest.empty()
    await Effect.gen(function* () {
      const svc = yield* ActionOutputs
      yield* svc.set("result", "success")
    }).pipe(Effect.provide(ActionOutputsTest.layer(state)), Effect.runPromise)

    expect(state.outputs).toContainEqual({ name: "result", value: "success" })
  })

  it("captures exported variables", async () => {
    const state = ActionOutputsTest.empty()
    await Effect.gen(function* () {
      const svc = yield* ActionOutputs
      yield* svc.exportVariable("MY_VAR", "value")
    }).pipe(Effect.provide(ActionOutputsTest.layer(state)), Effect.runPromise)

    expect(state.variables).toEqual([{ name: "MY_VAR", value: "value" }])
  })
})
```

### Testing setFailed and setSecret

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionOutputs, ActionOutputsTest } from "@savvy-web/github-action-effects/testing"

describe("setFailed and setSecret", () => {
  it("captures setFailed calls", async () => {
    const state = ActionOutputsTest.empty()
    await Effect.gen(function* () {
      const svc = yield* ActionOutputs
      yield* svc.setFailed("Something went wrong")
    }).pipe(Effect.provide(ActionOutputsTest.layer(state)), Effect.runPromise)

    expect(state.failed).toEqual(["Something went wrong"])
  })

  it("captures setSecret calls", async () => {
    const state = ActionOutputsTest.empty()
    await Effect.gen(function* () {
      const svc = yield* ActionOutputs
      yield* svc.setSecret("super-secret-token")
    }).pipe(Effect.provide(ActionOutputsTest.layer(state)), Effect.runPromise)

    expect(state.secrets).toEqual(["super-secret-token"])
  })
})
```

### Testing ActionState

```typescript
import { Effect, Schema, Option } from "effect"
import { describe, expect, it } from "vitest"
import { ActionState, ActionStateTest } from "@savvy-web/github-action-effects/testing"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

describe("ActionState", () => {
  it("saves and retrieves state", async () => {
    const state = ActionStateTest.empty()
    const result = await Effect.gen(function* () {
      const svc = yield* ActionState
      yield* svc.save("timing", { startedAt: 1000 }, TimingSchema)
      return yield* svc.get("timing", TimingSchema)
    }).pipe(Effect.provide(ActionStateTest.layer(state)), Effect.runPromise)

    expect(result).toEqual({ startedAt: 1000 })
  })

  it("returns Option.none for missing state", async () => {
    const state = ActionStateTest.empty()
    const result = await Effect.gen(function* () {
      const svc = yield* ActionState
      return yield* svc.getOptional("missing", TimingSchema)
    }).pipe(Effect.provide(ActionStateTest.layer(state)), Effect.runPromise)

    expect(Option.isNone(result)).toBe(true)
  })

  it("simulates phase ordering with pre-populated state", async () => {
    const state = ActionStateTest.empty()
    // Simulate pre.ts saving state
    state.entries.set("timing", JSON.stringify({ startedAt: 1000 }))

    // Test main.ts reading that state
    const result = await Effect.gen(function* () {
      const svc = yield* ActionState
      return yield* svc.get("timing", TimingSchema)
    }).pipe(Effect.provide(ActionStateTest.layer(state)), Effect.runPromise)

    expect(result).toEqual({ startedAt: 1000 })
  })
})
```

### Testing logging groups

Verify that your action organizes output into collapsible groups:

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionLogger, ActionLoggerTest } from "@savvy-web/github-action-effects/testing"

describe("log groups", () => {
  it("records group name and returns result", async () => {
    const state = ActionLoggerTest.empty()
    const result = await Effect.gen(function* () {
      const logger = yield* ActionLogger
      return yield* logger.group("Build", Effect.succeed("done"))
    }).pipe(Effect.provide(ActionLoggerTest.layer(state)), Effect.runPromise)

    expect(result).toBe("done")
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0]?.name).toBe("Build")
  })
})
```

### Testing buffer-on-failure

The `withBuffer` method captures verbose output and only flushes it when the
wrapped effect fails. At the default `info` log level, successful runs discard
the buffer silently.

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionLogger, ActionLoggerTest } from "@savvy-web/github-action-effects/testing"

describe("withBuffer", () => {
  it("flushes buffer on failure", async () => {
    const state = ActionLoggerTest.empty()
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.provide(
          Effect.gen(function* () {
            const logger = yield* ActionLogger
            yield* logger.withBuffer("operation", Effect.fail("boom"))
          }),
          ActionLoggerTest.layer(state),
        ),
      ),
    )
    expect(exit._tag).toBe("Failure")
    expect(state.flushedBuffers).toHaveLength(1)
    expect(state.flushedBuffers[0]?.label).toBe("operation")
  })

  it("discards buffer on success", async () => {
    const state = ActionLoggerTest.empty()
    await Effect.gen(function* () {
      const logger = yield* ActionLogger
      yield* logger.withBuffer("ok-op", Effect.succeed("done"))
    }).pipe(Effect.provide(ActionLoggerTest.layer(state)), Effect.runPromise)

    expect(state.flushedBuffers).toHaveLength(0)
  })
})
```

### Testing annotations

Annotations attach messages to specific files and lines in the GitHub Actions
UI. The three methods (`annotationError`, `annotationWarning`,
`annotationNotice`) each record a `type` field in the captured state.

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionLogger, ActionLoggerTest } from "@savvy-web/github-action-effects/testing"

describe("annotations", () => {
  it("records error annotation with properties", async () => {
    const state = ActionLoggerTest.empty()
    await Effect.gen(function* () {
      const logger = yield* ActionLogger
      yield* logger.annotationError("Check failed", {
        file: "src/index.ts",
        startLine: 10,
      })
    }).pipe(Effect.provide(ActionLoggerTest.layer(state)), Effect.runPromise)

    expect(state.annotations).toEqual([
      {
        type: "error",
        message: "Check failed",
        properties: { file: "src/index.ts", startLine: 10 },
      },
    ])
  })

  it("records warning annotation", async () => {
    const state = ActionLoggerTest.empty()
    await Effect.gen(function* () {
      const logger = yield* ActionLogger
      yield* logger.annotationWarning("Deprecated usage", {
        file: "src/helpers.ts",
        startLine: 42,
      })
    }).pipe(Effect.provide(ActionLoggerTest.layer(state)), Effect.runPromise)

    expect(state.annotations).toEqual([
      {
        type: "warning",
        message: "Deprecated usage",
        properties: { file: "src/helpers.ts", startLine: 42 },
      },
    ])
  })

  it("records notice annotation without properties", async () => {
    const state = ActionLoggerTest.empty()
    await Effect.gen(function* () {
      const logger = yield* ActionLogger
      yield* logger.annotationNotice("Something happened")
    }).pipe(Effect.provide(ActionLoggerTest.layer(state)), Effect.runPromise)

    expect(state.annotations).toEqual([
      { type: "notice", message: "Something happened" },
    ])
  })
})
```

## Testing GFM Builders

The GFM (GitHub Flavored Markdown) builder functions are pure -- they take
strings in and return strings out. No layers or Effect runtime needed. Access
them via the `GithubMarkdown` namespace.

```typescript
import { describe, expect, it } from "vitest"
import { GithubMarkdown } from "@savvy-web/github-action-effects/testing"

describe("GFM builders", () => {
  it("builds a markdown table", () => {
    const result = GithubMarkdown.table(
      ["Name", "Status"],
      [["pkg-a", GithubMarkdown.statusIcon("pass")]],
    )
    expect(result).toContain("| Name | Status |")
    expect(result).toContain("pkg-a")
  })

  it("builds a heading", () => {
    expect(GithubMarkdown.heading("Results", 2)).toBe("## Results")
  })

  it("builds a bulleted list", () => {
    const result = GithubMarkdown.list(["first", "second"])
    expect(result).toBe("- first\n- second")
  })

  it("bolds text", () => {
    expect(GithubMarkdown.bold("important")).toBe("**important**")
  })
})
```

## Integration Testing with Live Layers

In most cases, the in-memory test layers are the right choice. However, you
may occasionally want to test the behavior of a Live layer itself -- for
example, verifying that `ActionInputsLive` reads inputs correctly through the
`ActionsCore` wrapper.

The platform abstraction makes this straightforward: inject a mock `ActionsCore`
layer instead of the real `ActionsCoreLive`, then use the actual `Live` layer
logic without touching `@actions/core` at all.

```typescript
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  ActionInputsLive,
  ActionsCore,
} from "@savvy-web/github-action-effects/testing"

// Mock only the platform wrapper -- test the real Live layer logic
const mockPlatform = Layer.succeed(ActionsCore, {
  getInput: vi.fn().mockReturnValue("test-value"),
  getBooleanInput: vi.fn().mockReturnValue(false),
  getMultilineInput: vi.fn().mockReturnValue([]),
  setOutput: vi.fn(),
  exportVariable: vi.fn(),
  addPath: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  notice: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  saveState: vi.fn(),
  getState: vi.fn().mockReturnValue(""),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
})

// ActionInputsLive depends on ActionsCore; mockPlatform satisfies that dependency
const layer = ActionInputsLive.pipe(Layer.provide(mockPlatform))
```

This pattern lets you verify that the Live layer wires the platform calls
correctly without standing up a real GitHub Actions runner.

See `src/layers/ActionLoggerLive.test.ts` for a complete example of this
pattern.

## Helper Patterns

Reduce boilerplate by extracting a helper that creates all test layers and
returns both the merged layer and the state containers:

```typescript
import { Layer } from "effect"
import {
  ActionInputsTest,
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
} from "@savvy-web/github-action-effects/testing"
import type {
  ActionLoggerTestState,
  ActionOutputsTestState,
  ActionStateTestState,
} from "@savvy-web/github-action-effects/testing"

interface TestContext {
  readonly outputState: ActionOutputsTestState
  readonly logState: ActionLoggerTestState
  readonly stateState: ActionStateTestState
  readonly layer: Layer.Layer<
    import("@savvy-web/github-action-effects/testing").ActionInputs
    | import("@savvy-web/github-action-effects/testing").ActionOutputs
    | import("@savvy-web/github-action-effects/testing").ActionLogger
    | import("@savvy-web/github-action-effects/testing").ActionState
  >
}

const runWithTestLayers = (inputs: Record<string, string>): TestContext => {
  const outputState = ActionOutputsTest.empty()
  const logState = ActionLoggerTest.empty()
  const stateState = ActionStateTest.empty()
  const layer = Layer.mergeAll(
    ActionInputsTest(inputs),
    ActionOutputsTest.layer(outputState),
    ActionLoggerTest.layer(logState),
    ActionStateTest.layer(stateState),
  )
  return { outputState, logState, stateState, layer }
}
```

Usage in tests:

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { ActionInputs, ActionOutputs } from "@savvy-web/github-action-effects/testing"

describe("my action", () => {
  it("reads input and sets output", async () => {
    const { layer, outputState } = runWithTestLayers({
      "package-name": "my-pkg",
    })

    await Effect.gen(function* () {
      const inputs = yield* ActionInputs
      const outputs = yield* ActionOutputs
      const name = yield* inputs.get("package-name", Schema.String)
      yield* outputs.set("resolved-name", name)
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(outputState.outputs).toContainEqual({
      name: "resolved-name",
      value: "my-pkg",
    })
  })
})
```
