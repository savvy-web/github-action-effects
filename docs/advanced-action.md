# Advanced Action: Three-Stage App

This tutorial builds a complete three-stage GitHub Action with `pre`, `main`,
and `post` phases. It demonstrates three key library features:

- **GitHub App authentication** -- generate and revoke installation tokens
- **ActionState** -- transfer typed data between phases
- **Buffer-on-failure logging** -- capture verbose output, flush only on error

## The action.yml

A three-stage action declares separate entry points for each phase. GitHub
runs `pre` before checkout, `main` for the primary logic, and `post` for
cleanup (always runs, even on failure).

```yaml
name: 'Release Publisher'
description: 'Authenticate as a GitHub App, publish packages, and report timing'

inputs:
  app-id:
    description: 'GitHub App ID'
    required: true
  private-key:
    description: 'GitHub App private key (PEM)'
    required: true
  packages:
    description: 'Newline-separated list of packages to publish'
    required: true
  dry-run:
    description: 'Skip actual publishing'
    required: false
    default: 'false'
outputs:
  published-count:
    description: 'Number of packages published'
  duration-ms:
    description: 'Total elapsed time in milliseconds'

runs:
  using: 'node24'
  pre: 'dist/pre.js'
  main: 'dist/main.js'
  post: 'dist/post.js'
```

## Shared Types

Define schemas and types shared across all three phases in a single module.

```typescript
// src/shared.ts
import { Schema } from "effect"

/** Schema for timing state passed from pre -> post. */
export const TimingState = Schema.Struct({
  startedAt: Schema.Number,
})

/** Schema for publish results passed from main -> post. */
export const PublishState = Schema.Struct({
  publishedCount: Schema.Number,
  failedCount: Schema.Number,
  packages: Schema.Array(Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    status: Schema.Literal("published", "failed", "skipped"),
  })),
})

/** Schema for token info passed from pre -> main -> post. */
export const TokenState = Schema.Struct({
  installationId: Schema.Number,
  permissions: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
})
```

## Phase 1: pre.ts

The `pre` phase runs before the repository is checked out. Use it to
authenticate, validate permissions, and record the start time.

```typescript
// src/pre.ts
import { Config, Effect, Layer, Schema } from "effect"
import {
  Action,
  ActionLogger,
  ActionState,
  GitHubApp,
  GitHubAppLive,
  TokenPermissionChecker,
  TokenPermissionCheckerLive,
} from "@savvy-web/github-action-effects"

import { TimingState, TokenState } from "./shared.js"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const app = yield* GitHubApp
  const checker = yield* TokenPermissionChecker

  // -- 1. Record start time --
  yield* state.save("timing", { startedAt: Date.now() }, TimingState)

  // -- 2. Read inputs via Config API --
  const appId = yield* Config.integer("app-id")
  const privateKey = yield* Config.secret("private-key")

  // -- 3. Authenticate as GitHub App --
  yield* logger.group("GitHub App Authentication", Effect.gen(function* () {
    yield* app.withToken(appId, privateKey, (token) =>
      Effect.gen(function* () {
        yield* Effect.log(`Authenticated as installation ${token.installationId}`)

        // Save token info for main phase
        yield* state.save("token", {
          installationId: token.installationId,
          permissions: token.permissions ?? {},
        }, TokenState)

        // -- 4. Verify permissions early --
        yield* checker.assertSufficient({
          contents: "write",
          packages: "write",
        })
        yield* Effect.log("Required permissions verified")
      })
    )
  }))

  yield* Effect.log("Pre phase complete")
})

Action.run(
  program,
  {
    layer: Layer.mergeAll(
      GitHubAppLive,
      TokenPermissionCheckerLive,
    ),
  },
)
```

### What happens in pre.ts

1. **ActionState.save** -- Persists the start timestamp as a Schema-encoded
   JSON string. GitHub Actions stores state as key-value string pairs between
   phases; the Schema encode/decode layer handles serialization transparently.

2. **Config API** -- `Config.integer("app-id")` reads `INPUT_APP-ID` from
   the environment. `Config.secret("private-key")` reads `INPUT_PRIVATE-KEY`
   and wraps it in a `Secret` type.

3. **GitHubApp.withToken** -- Bracket pattern that generates an installation
   token and automatically revokes it when the callback completes (or fails).
   The token object includes `installationId` and `permissions`.

4. **TokenPermissionChecker.assertSufficient** -- Fails the action
   immediately if the token lacks the required permission scopes. This
   catches configuration errors before the main phase runs.

## Phase 2: main.ts

The main phase performs the actual work. It reads state saved by `pre`,
publishes packages, and saves results for `post`.

```typescript
// src/main.ts
import { Config, Effect, Layer, Schema } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  ActionState,
  DryRun,
  DryRunLive,
  ErrorAccumulator,
  GithubMarkdown,
  NpmRegistry,
  NpmRegistryLive,
  PackagePublish,
  PackagePublishLive,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState, TokenState } from "./shared.js"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const dryRun = yield* DryRun
  const npm = yield* NpmRegistry
  const publisher = yield* PackagePublish

  // -- 1. Read state from pre phase --
  const timing = yield* state.get("timing", TimingState)
  const tokenInfo = yield* state.get("token", TokenState)
  yield* Effect.log(`Resuming from pre (started ${timing.startedAt})`)
  yield* Effect.log(`Using installation ${tokenInfo.installationId}`)

  // -- 2. Read inputs via Config API --
  const packagesRaw = yield* Config.string("packages")
  const packages = packagesRaw.split("\n").map(s => s.trim()).filter(Boolean)
  const isDry = yield* Config.boolean("dry-run").pipe(Config.withDefault(false))

  yield* Effect.log(`Publishing ${packages.length} packages (dry-run: ${isDry})`)

  // -- 3. Publish each package, accumulating errors --
  const result = yield* logger.group("Publish Packages",
    ErrorAccumulator.forEachAccumulate(packages, (pkg) =>
      logger.withBuffer(`publish-${pkg}`, Effect.gen(function* () {
        yield* Effect.log(`Checking registry for ${pkg}`)
        const latest = yield* npm.getLatestVersion(pkg)
        yield* Effect.log(`Current latest: ${latest}`)

        yield* dryRun.guard(
          `publish-${pkg}`,
          publisher.publish(`./packages/${pkg}/dist`, {
            registry: "https://registry.npmjs.org/",
            tag: "latest",
            access: "public",
            provenance: true,
          }),
          undefined,
        )

        return { name: pkg, version: latest, status: "published" as const }
      }))
    )
  )

  // -- 4. Save results for post phase --
  const publishResults = {
    publishedCount: result.successes.length,
    failedCount: result.failures.length,
    packages: [
      ...result.successes.map((s) => s.value),
      ...result.failures.map((f) => ({
        name: f.item,
        version: "unknown",
        status: "failed" as const,
      })),
    ],
  }
  yield* state.save("publish", publishResults, PublishState)

  // -- 5. Set outputs --
  yield* outputs.set("published-count", String(result.successes.length))

  // -- 6. Write step summary --
  yield* outputs.summary([
    GithubMarkdown.heading("Publish Results"),
    GithubMarkdown.table(
      ["Package", "Version", "Status"],
      publishResults.packages.map((p) => [
        p.name,
        p.version,
        GithubMarkdown.statusIcon(p.status === "published" ? "pass" : "fail"),
      ]),
    ),
    "",
    `Published: ${result.successes.length} | Failed: ${result.failures.length}`,
  ].join("\n\n"))

  if (result.failures.length > 0) {
    yield* outputs.setFailed(
      `${result.failures.length} package(s) failed to publish`
    )
  }
})

Action.run(
  program,
  {
    layer: Layer.mergeAll(
      DryRunLive,
      NpmRegistryLive,
      PackagePublishLive,
    ),
  },
)
```

### What happens in main.ts

1. **State from pre** -- `state.get("timing", TimingState)` reads and
   Schema-decodes the timing data saved by `pre.ts`. If the state is missing
   or invalid, it fails with an `ActionStateError`.

2. **ErrorAccumulator** -- `forEachAccumulate` processes all packages without
   short-circuiting. Failed publishes are collected alongside successes,
   allowing a complete summary.

3. **Buffer-on-failure** -- `logger.withBuffer` captures verbose output per
   package. On success the buffer is discarded; on failure it flushes for
   debugging context.

4. **DryRun.guard** -- When `dry-run` is `"true"`, the `publisher.publish`
   call is skipped and the fallback value (`undefined`) is returned instead.

## Phase 3: post.ts

The `post` phase always runs, even if `main` fails. Use it for cleanup,
timing reports, and final telemetry.

```typescript
// src/post.ts
import { Config, Effect, Option } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  ActionState,
  GithubMarkdown,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState } from "./shared.js"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs

  // -- 1. Calculate elapsed time --
  const timing = yield* state.get("timing", TimingState)
  const elapsed = Date.now() - timing.startedAt
  yield* outputs.set("duration-ms", String(elapsed))

  // -- 2. Read publish results (may not exist if main failed early) --
  const publishResult = yield* state.getOptional("publish", PublishState)

  yield* logger.group("Summary", Effect.gen(function* () {
    if (Option.isSome(publishResult)) {
      const pub = publishResult.value
      yield* Effect.log(`Published: ${pub.publishedCount}, Failed: ${pub.failedCount}`)
    } else {
      yield* Effect.log("No publish results (main phase may have failed)")
    }
    yield* Effect.log(`Total duration: ${elapsed}ms`)
  }))

  // -- 3. Append timing to step summary --
  yield* outputs.summary([
    "",
    GithubMarkdown.rule(),
    GithubMarkdown.details("Timing", [
      `Total duration: ${GithubMarkdown.bold(`${elapsed}ms`)}`,
      `Started at: ${new Date(timing.startedAt).toISOString()}`,
      `Completed at: ${new Date().toISOString()}`,
    ].join("\n\n")),
  ].join("\n\n"))

  yield* Effect.log("Post phase complete")
})

Action.run(program)
```

### What happens in post.ts

1. **state.getOptional** -- Unlike `state.get` which fails on missing keys,
   `getOptional` returns `Option.none()` when the key does not exist. This
   handles the case where `main` failed before saving publish results.

2. **Timing summary** -- `outputs.summary` appends markdown to the existing
   step summary written by `main`. Each call appends rather than replacing.

## Workflow Usage

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v6

      - uses: my-org/release-publisher@v1
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          packages: |
            @scope/core
            @scope/utils
            @scope/cli
          dry-run: false
```

## Key Takeaways

**State is the bridge between phases.** Each phase runs as a separate
Node.js process. `ActionState` with Effect Schemas provides type-safe
serialization across the process boundary.

**Use `getOptional` in post.** The `post` phase always runs, but earlier
phases may have failed before saving their state. Use `state.getOptional`
to handle missing state gracefully.

**Bracket patterns clean up automatically.** `GitHubApp.withToken` revokes
the installation token even if the callback fails, preventing token leaks.

## Testing

Test each phase independently using test layers from the `/testing` subpath.
Each phase is a pure Effect program that requires injected services -- test
layers replace all live dependencies without any mocking framework.

### Testing a single phase

Test `pre.ts` logic by providing test layers for every required service:

```typescript
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
  GitHubAppTest,
  TokenPermissionCheckerTest,
} from "@savvy-web/github-action-effects/testing"

describe("pre phase", () => {
  it("saves timing state on startup", async () => {
    const stateState = ActionStateTest.empty()

    const layer = Layer.mergeAll(
      ActionLoggerTest.layer(ActionLoggerTest.empty()),
      ActionOutputsTest.layer(ActionOutputsTest.empty()),
      ActionStateTest.layer(stateState),
      GitHubAppTest.layer(GitHubAppTest.empty()),
      TokenPermissionCheckerTest.layer(TokenPermissionCheckerTest.empty()),
    )

    // Run your pre.ts program (import it from your source)
    // await preProgram.pipe(Effect.provide(layer), Effect.runPromise)

    // Verify timing state was saved
    expect(stateState.entries.has("timing")).toBe(true)
    const timing = JSON.parse(stateState.entries.get("timing") ?? "{}")
    expect(typeof timing.startedAt).toBe("number")
  })
})
```

### Testing cross-phase state with pre-populated ActionStateTest

Simulate state written by `pre.ts` when testing `main.ts` or `post.ts`.
Pre-populate the `ActionStateTest` entries directly:

```typescript
import { Effect, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
} from "@savvy-web/github-action-effects/testing"

describe("post phase", () => {
  it("reads timing from pre phase state", async () => {
    const stateState = ActionStateTest.empty()
    const outputState = ActionOutputsTest.empty()

    // Simulate state written by pre.ts
    stateState.entries.set("timing", JSON.stringify({ startedAt: Date.now() - 5000 }))
    stateState.entries.set("token", JSON.stringify({
      installationId: 42,
      permissions: { contents: "write" },
    }))

    const layer = Layer.mergeAll(
      ActionLoggerTest.layer(ActionLoggerTest.empty()),
      ActionOutputsTest.layer(outputState),
      ActionStateTest.layer(stateState),
    )

    // Run your post.ts program against the pre-populated state
    // await postProgram.pipe(Effect.provide(layer), Effect.runPromise)

    // Verify duration-ms output was set
    expect(outputState.outputs.some((o) => o.name === "duration-ms")).toBe(true)
  })
})
```

See [Testing Guide](./testing.md) for the complete test layer API and more
patterns.

## Next Steps

- [Services Guide](./services.md) -- detailed usage for each service
- [Testing](./testing.md) -- test multi-phase actions with in-memory layers
- [Patterns](./patterns.md) -- dry-run, error accumulation, and more
- [Peer Dependencies](./peer-dependencies.md) -- which packages to install
