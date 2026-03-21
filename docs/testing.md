# Testing GitHub Actions

This guide covers how to test GitHub Actions built with
`@savvy-web/github-action-effects`. Every service in the library ships with a
companion test layer that captures operations in memory, so your tests never
need a real GitHub Actions runner environment.

## Overview

Test layers come in two shapes:

- **Namespace objects** (`ActionLoggerTest`, `ActionOutputsTest`,
  `ActionStateTest`) expose an `empty()` function that creates a mutable state
  container and a `layer()` function that builds an Effect `Layer` backed by
  that state. After running your effect, you inspect the state to verify what
  happened.
- **Direct layers** (`ActionEnvironmentTest`) return a `Layer` directly.

## Importing for Tests

Use the `/testing` subpath in all test files:

```typescript
import {
  ActionLogger,
  ActionLoggerTest,
  ActionOutputs,
  ActionOutputsTest,
} from "@savvy-web/github-action-effects/testing"
```

The `/testing` entry point exports all service tags, test layers, live layers,
errors, schemas, and utilities -- but **excludes the `Action` namespace**.
`Action` statically imports runtime components that emit workflow commands,
which is inappropriate in test environments.

In production entry points (`main.ts`, `pre.ts`, `post.ts`), import from the
main package:

```typescript
import { Action } from "@savvy-web/github-action-effects"
```

## Test Layer APIs

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
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
} from "@savvy-web/github-action-effects/testing"

const outputState = ActionOutputsTest.empty()
const logState = ActionLoggerTest.empty()
const stateState = ActionStateTest.empty()

const TestLayer = Layer.mergeAll(
  ActionOutputsTest.layer(outputState),
  ActionLoggerTest.layer(logState),
  ActionStateTest.layer(stateState),
)
```

Then provide the merged layer to any effect that requires those services.

## Testing Patterns

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
})
```

## Helper Patterns

Reduce boilerplate by extracting a helper that creates all test layers and
returns both the merged layer and the state containers:

```typescript
import { Layer } from "effect"
import {
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
    import("@savvy-web/github-action-effects/testing").ActionOutputs
    | import("@savvy-web/github-action-effects/testing").ActionLogger
    | import("@savvy-web/github-action-effects/testing").ActionState
  >
}

const runWithTestLayers = (): TestContext => {
  const outputState = ActionOutputsTest.empty()
  const logState = ActionLoggerTest.empty()
  const stateState = ActionStateTest.empty()
  const layer = Layer.mergeAll(
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
import { ActionOutputs } from "@savvy-web/github-action-effects/testing"

describe("my action", () => {
  it("sets output", async () => {
    const { layer, outputState } = runWithTestLayers()

    await Effect.gen(function* () {
      const outputs = yield* ActionOutputs
      yield* outputs.set("resolved-name", "my-pkg")
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(outputState.outputs).toContainEqual({
      name: "resolved-name",
      value: "my-pkg",
    })
  })
})
```
