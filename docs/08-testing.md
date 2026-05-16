# Testing GitHub Actions

This guide covers how to test GitHub Actions built with `@savvy-web/github-action-effects`. Every service in the library ships with a companion test layer that captures operations in memory, so your tests never need a real GitHub Actions runner environment.

## Overview

Test layers come in two shapes:

- **Namespace objects** (`ActionLoggerTest`, `ActionOutputsTest`, `ActionStateTest`, `GitHubAppTest`, most others) expose an `empty()` function that creates a mutable state container and a `layer()` function that builds an Effect `Layer` backed by that state. After running your effect, you inspect the state to verify what happened.
- **Direct layers** (`ActionEnvironmentTest`) return a `Layer` directly.

One namespace breaks the pattern: `GitHubClientTest.empty()` returns a `Layer`, not a state container — see [Testing GitHubClient consumers](#testing-githubclient-consumers).

## Importing for tests

Use the `/testing` subpath in all test files:

```typescript
import {
  ActionLogger,
  ActionLoggerTest,
  ActionOutputs,
  ActionOutputsTest,
} from "@savvy-web/github-action-effects/testing"
```

The `/testing` entry point exports all service tags, test layers, live layers, errors, schemas and utilities — but **excludes the `Action` namespace**. `Action` statically imports runtime components that emit workflow commands, which is inappropriate in test environments.

In production entry points (`main.ts`, `pre.ts`, `post.ts`), import from the main package:

```typescript
import { Action } from "@savvy-web/github-action-effects"
```

## Test layer APIs

### ActionOutputsTest

`ActionOutputsTest` is a namespace object with `empty()` and `layer()`.

```typescript
import { ActionOutputsTest } from "@savvy-web/github-action-effects/testing"

const state = ActionOutputsTest.empty()
const layer = ActionOutputsTest.layer(state)
```

After running your effect against this layer, inspect `state` to verify which outputs were set.

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
| `flushedBuffers` | `Array<{ label: string, entries: Array<string> }>` | Buffers flushed on failure via `withBuffer` |

### ActionStateTest

`ActionStateTest` is a namespace object with `empty()` and `layer()`.

```typescript
import { ActionStateTest } from "@savvy-web/github-action-effects/testing"

const state = ActionStateTest.empty()
const layer = ActionStateTest.layer(state)
```

The test state uses an in-memory `Map<string, string>`. Pre-populate entries to simulate state from a previous action phase:

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

## Composing test layers

When your action uses multiple services, merge the test layers together with `Layer.mergeAll`:

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

## Testing patterns

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

## Testing GitHubClient consumers

`GitHubClientTest` has two members, but they do not follow the `empty()`/`layer()` split used by the other namespaces. `empty()` returns a `Layer` directly, ready to provide:

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { GitHubClient, GitHubClientTest } from "@savvy-web/github-action-effects/testing"

describe("repo context", () => {
  it("reads the default test repo", async () => {
    const result = await Effect.gen(function* () {
      const client = yield* GitHubClient
      return yield* client.repo
    }).pipe(Effect.provide(GitHubClientTest.empty()), Effect.runPromise)

    expect(result).toEqual({ owner: "test-owner", repo: "test-repo" })
  })
})
```

Because `empty()` is already a layer, do not wrap it — `GitHubClientTest.layer(GitHubClientTest.empty())` is a type error. Use `layer(state)` only when you build a `GitHubClientTestState` yourself.

To stub API responses, build the state and record them. The state has four fields: `restResponses` (a `Map` keyed by the operation string passed to `client.rest`), `graphqlResponses` (keyed by the GraphQL query string), `paginateResponses` (keyed by the operation string, value is an array of pages) and `repo`:

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { GitHubClient, GitHubClientTest } from "@savvy-web/github-action-effects/testing"
import type { GitHubClientTestState } from "@savvy-web/github-action-effects/testing"

describe("rest calls", () => {
  it("returns the recorded response for an operation", async () => {
    const state: GitHubClientTestState = {
      restResponses: new Map([["repos.get", { data: { default_branch: "main" } }]]),
      graphqlResponses: new Map(),
      paginateResponses: new Map(),
      repo: { owner: "acme", repo: "widget" },
    }

    const result = await Effect.gen(function* () {
      const client = yield* GitHubClient
      const { owner, repo } = yield* client.repo
      return yield* client.rest("repos.get", (octokit: any) =>
        octokit.rest.repos.get({ owner, repo }),
      )
    }).pipe(Effect.provide(GitHubClientTest.layer(state)), Effect.runPromise)

    expect(result).toEqual({ default_branch: "main" })
  })
})
```

A `rest`, `graphql` or `paginate` call with no recorded entry fails with a `GitHubClientError`, so a missing stub surfaces as a clear test failure rather than a silent `undefined`.

## Testing GitHub App token lifecycle

Actions that use `GitHubToken` need `GitHubApp` and `ActionState` in context. Provide `GitHubAppTest` and `ActionStateTest` to exercise `provision`, `client` and `dispose` without a real GitHub App.

`GitHubAppTest` follows the `empty()`/`layer()` pattern. Its state has three fields:

| Field | Type | Description |
| --- | --- | --- |
| `generateCalls` | `Array<{ appId, privateKey, installationId? }>` | Recorded `generateToken` calls |
| `revokeCalls` | `Array<string>` | Tokens passed to `revokeToken` |
| `tokenToReturn` | `InstallationToken` | The token every `generateToken` call returns |

`GitHubAppTest.empty()` seeds `tokenToReturn` with a default token (`ghs_test_token_123`, empty `permissions`). Override `tokenToReturn` to test permission verification.

Testing `provision` — supply the App credentials and assert the token was generated and persisted:

```typescript
import { Config, ConfigProvider, Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionStateTest,
  GitHubAppTest,
  GitHubToken,
} from "@savvy-web/github-action-effects/testing"

describe("GitHubToken.provision", () => {
  it("generates a token and persists it", async () => {
    const appState = GitHubAppTest.empty()
    const stateState = ActionStateTest.empty()

    await GitHubToken.provision({ clientId: "client-id", privateKey: "key" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          GitHubAppTest.layer(appState),
          ActionStateTest.layer(stateState),
        ),
      ),
      Effect.runPromise,
    )

    expect(appState.generateCalls).toHaveLength(1)
    expect(stateState.entries.size).toBe(1)
  })
})
```

`provision` defaults its credentials to the `app-client-id` and `app-private-key` action inputs, read through Effect's `Config` API. To exercise that default path instead of passing options, install a `ConfigProvider` that supplies those inputs.

Testing `client` — `GitHubToken.client()` returns a `Layer` and needs `ActionState` pre-populated with the token envelope a prior `provision` would have written. The internal state key is not part of the public API, so the most robust way to set this up is to run `provision` first against a shared `ActionStateTest` state, then provide that same state to `client()`:

```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionStateTest,
  GitHubAppTest,
  GitHubClient,
  GitHubToken,
} from "@savvy-web/github-action-effects/testing"

describe("GitHubToken.client", () => {
  it("builds a client from the provisioned token", async () => {
    const appState = GitHubAppTest.empty()
    const stateState = ActionStateTest.empty()

    // pre phase: provision writes the token envelope into stateState
    await GitHubToken.provision({ clientId: "client-id", privateKey: "key" }).pipe(
      Effect.provide(
        Layer.mergeAll(
          GitHubAppTest.layer(appState),
          ActionStateTest.layer(stateState),
        ),
      ),
      Effect.runPromise,
    )

    // main phase: client() reads that same state back
    const clientLayer = Layer.provide(
      GitHubToken.client(),
      ActionStateTest.layer(stateState),
    )

    const result = await Effect.gen(function* () {
      const client = yield* GitHubClient
      return yield* client.repo
    }).pipe(Effect.provide(clientLayer), Effect.runPromise)

    expect(result.owner).toBeDefined()
  })
})
```

`dispose` works the same way as `provision`: provide `GitHubAppTest` and `ActionStateTest`, then assert the token landed in `appState.revokeCalls`.

### TokenPermissionChecker

`provision` verifies token scopes through `TokenPermissionChecker` when you pass a `permissions` option, building the checker internally from the generated token's `permissions`. To test that path directly — or to test an action that uses `TokenPermissionChecker` on its own — use `TokenPermissionCheckerTest`. Its state has `grantedPermissions` (a `Record<string, string>` you populate with the scopes the token holds) and `checkCalls` (the requirement sets passed to `check`, `assertSufficient` and `assertExact`).

```typescript
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  TokenPermissionChecker,
  TokenPermissionCheckerTest,
} from "@savvy-web/github-action-effects/testing"

describe("permission checks", () => {
  it("passes when the token grants enough", async () => {
    const state = TokenPermissionCheckerTest.empty()
    state.grantedPermissions.contents = "write"

    const result = await Effect.gen(function* () {
      const checker = yield* TokenPermissionChecker
      return yield* checker.assertSufficient({ contents: "write" })
    }).pipe(
      Effect.provide(TokenPermissionCheckerTest.layer(state)),
      Effect.runPromise,
    )

    expect(result.satisfied).toBe(true)
  })
})
```

## Testing GFM builders

The GFM (GitHub Flavored Markdown) builder functions are pure — they take strings in and return strings out. No layers or Effect runtime needed. Access them via the `GithubMarkdown` namespace.

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

## Helper patterns

Reduce boilerplate by extracting a helper that creates all test layers and returns both the merged layer and the state containers:

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
