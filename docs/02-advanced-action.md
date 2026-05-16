# Advanced action: three-stage app

This tutorial builds a complete three-stage GitHub Action with `pre`, `main` and `post` phases. It demonstrates three key library features:

- **GitHub App authentication** — provision one installation token in `pre`, use it in `main`, revoke it in `post`
- **ActionState** — transfer typed data between phases
- **Buffer-on-failure logging** — capture verbose output, flush only on error

## The action.yml

A three-stage action declares separate entry points for each phase. GitHub runs `pre` before checkout, `main` for the primary logic and `post` for cleanup (always runs, even on failure).

```yaml
name: 'Release Publisher'
description: 'Authenticate as a GitHub App, publish packages, and report timing'

inputs:
  app-client-id:
    description: 'GitHub App client ID'
    required: true
  app-private-key:
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

The `app-client-id` and `app-private-key` input names are the defaults `GitHubToken.provision` reads when you do not pass credentials explicitly.

## Shared types

Define schemas shared across all three phases in a single module. You do not need a schema for the installation token — `GitHubToken` persists it internally under its own `ActionState` key.

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
```

## Phase 1: pre.ts

The `pre` phase runs before the repository is checked out. Use it to authenticate, provision the installation token and record the start time.

`GitHubToken.provision` generates an installation token from App credentials and persists it to `ActionState` so the later phases can use it. Passing `permissions` verifies the generated token actually grants those scopes — if a scope is missing the effect fails with `TokenPermissionError` and the token is revoked before it leaks. `provision` requires a `GitHubApp` layer, composed from `GitHubAppLive` and `OctokitAuthAppLive`.

```typescript
// src/pre.ts
import { Effect, Layer } from "effect"
import {
  Action,
  ActionState,
  GitHubAppLive,
  GitHubToken,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

import { TimingState } from "./shared.js"

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive)

const program = Effect.gen(function* () {
  const state = yield* ActionState

  // -- 1. Record start time --
  yield* state.save("timing", { startedAt: Date.now() }, TimingState)

  // -- 2. Provision and persist the installation token --
  //    `clientId` defaults to the `app-client-id` input and
  //    `privateKey` to `app-private-key`, so neither is passed here.
  const token = yield* GitHubToken.provision({
    permissions: { contents: "write", packages: "write" },
  }).pipe(Effect.provide(appLayer))

  yield* Effect.log(`Provisioned token for installation ${token.installationId}`)
  // Provisioned token for installation 12345

  yield* Effect.log("Pre phase complete")
})

Action.run(program)
```

### What happens in pre.ts

1. **ActionState.save** — persists the start timestamp as a Schema-encoded JSON string. GitHub Actions stores state as key-value string pairs between phases; the Schema encode/decode layer handles serialization transparently.
2. **GitHubToken.provision** — reads the App credentials from the `app-client-id` and `app-private-key` inputs, generates an installation token and saves it to `ActionState` under an internal key. The returned `InstallationToken` carries `token`, `expiresAt`, `installationId` and `permissions`.
3. **Permission verification** — with `permissions` set, `provision` checks the generated token against those required scopes before persisting it. A missing scope fails the action with `TokenPermissionError` and the rejected token is revoked, so configuration errors surface in `pre` instead of mid-publish.

## Phase 2: main.ts

The main phase performs the actual work. It reads timing state saved by `pre`, builds a `GitHubClient` from the persisted token, publishes packages and saves results for `post`.

`GitHubToken.client()` is a `Layer` that reads the token persisted by `provision` and builds a `GitHubClient` from it — no App credentials needed in this phase.

```typescript
// src/main.ts
import { Config, Effect, Layer } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  ActionState,
  DryRun,
  DryRunLive,
  ErrorAccumulator,
  GithubMarkdown,
  GitHubToken,
  NpmRegistry,
  NpmRegistryLive,
  PackagePublish,
  PackagePublishLive,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState } from "./shared.js"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const dryRun = yield* DryRun
  const npm = yield* NpmRegistry
  const publisher = yield* PackagePublish

  // -- 1. Read state from pre phase --
  const timing = yield* state.get("timing", TimingState)
  yield* Effect.log(`Resuming from pre (started ${timing.startedAt})`)

  // -- 2. Read inputs via Config API --
  const packagesRaw = yield* Config.string("packages")
  const packages = packagesRaw.split("\n").map((s) => s.trim()).filter(Boolean)
  const isDry = yield* Config.boolean("dry-run").pipe(Config.withDefault(false))

  yield* Effect.log(`Publishing ${packages.length} packages (dry-run: ${isDry})`)

  // -- 3. Publish each package, accumulating errors --
  const result = yield* logger.group("Publish packages",
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
    GithubMarkdown.heading("Publish results"),
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
      GitHubToken.client(),
    ),
  },
)
```

### What happens in main.ts

1. **State from pre** — `state.get("timing", TimingState)` reads and Schema-decodes the timing data saved by `pre.ts`. If the state is missing or invalid, it fails with an `ActionStateError`.
2. **GitHubToken.client()** — builds a `GitHubClient` from the token `provision` persisted in `pre`. It is merged into the action layer alongside the other Live layers.
3. **ErrorAccumulator** — `forEachAccumulate` processes all packages without short-circuiting. Failed publishes are collected alongside successes, allowing a complete summary.
4. **Buffer-on-failure** — `logger.withBuffer` captures verbose output per package. On success the buffer is discarded; on failure it flushes for debugging context.
5. **DryRun.guard** — when `dry-run` is `"true"`, the `publisher.publish` call is skipped and the fallback value (`undefined`) is returned instead.

## Phase 3: post.ts

The `post` phase always runs, even if `main` fails. Use it for cleanup, timing reports and revoking the installation token.

`GitHubToken.dispose` revokes the token `provision` persisted. It is a no-op if no token was persisted (for example, when `pre` failed before provisioning). Like `provision`, it requires the `GitHubApp` layer.

```typescript
// src/post.ts
import { Effect, Layer, Option } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  ActionState,
  GitHubAppLive,
  GitHubToken,
  GithubMarkdown,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState } from "./shared.js"

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive)

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs

  // -- 1. Revoke the installation token (no-op if none was provisioned) --
  yield* GitHubToken.dispose().pipe(Effect.provide(appLayer))

  // -- 2. Calculate elapsed time --
  const timing = yield* state.get("timing", TimingState)
  const elapsed = Date.now() - timing.startedAt
  yield* outputs.set("duration-ms", String(elapsed))

  // -- 3. Read publish results (may not exist if main failed early) --
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

  // -- 4. Append timing to step summary --
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

1. **GitHubToken.dispose** — revokes the installation token so it cannot be used after the action finishes. If `pre` never persisted a token, it returns without making a request.
2. **state.getOptional** — unlike `state.get` which fails on missing keys, `getOptional` returns `Option.none()` when the key does not exist. This handles the case where `main` failed before saving publish results.
3. **Timing summary** — `outputs.summary` appends markdown to the existing step summary written by `main`. Each call appends rather than replacing.

## Workflow usage

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
          app-client-id: ${{ vars.APP_CLIENT_ID }}
          app-private-key: ${{ secrets.APP_PRIVATE_KEY }}
          packages: |
            @scope/core
            @scope/utils
            @scope/cli
          dry-run: false
```

## Key takeaways

**State is the bridge between phases.** Each phase runs as a separate Node.js process. `ActionState` with Effect Schemas provides type-safe serialization across the process boundary, and `GitHubToken` uses it internally to carry the installation token from `pre` to `main` and `post`.

**Provision once, dispose once.** `GitHubToken.provision` in `pre` and `GitHubToken.dispose` in `post` bracket the token lifecycle across the whole action. The `post` phase always runs, so the token is revoked even when `main` fails.

**Verify permissions in `pre`.** Passing `permissions` to `provision` fails the action before any work happens if the App installation lacks a required scope, with a clear `TokenPermissionError` instead of a mid-publish API failure.

## Testing

Test each phase independently using test layers from the `/testing` subpath. Each phase is a pure Effect program that requires injected services — test layers replace all live dependencies without any mocking framework.

`GitHubAppTest` provides a `GitHubApp` implementation that returns a fixed token and records every `generateToken` and `revokeToken` call. `ActionStateTest` captures saved state in an in-memory `Map`. Provide both to test the `provision` and `dispose` phases.

### Testing the pre phase

Provide `GitHubAppTest` so `provision` resolves without real App credentials, and inspect `ActionStateTest` to confirm the token and timing were persisted.

```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
  GitHubAppTest,
} from "@savvy-web/github-action-effects/testing"

describe("pre phase", () => {
  it("provisions a token and records timing", async () => {
    const stateState = ActionStateTest.empty()
    const appState = GitHubAppTest.empty()

    const layer = Layer.mergeAll(
      ActionLoggerTest.layer(ActionLoggerTest.empty()),
      ActionOutputsTest.layer(ActionOutputsTest.empty()),
      ActionStateTest.layer(stateState),
      GitHubAppTest.layer(appState),
    )

    // Run your pre.ts program (import it from your source)
    // await preProgram.pipe(Effect.provide(layer), Effect.runPromise)

    // GitHubAppTest records each generateToken call
    expect(appState.generateCalls.length).toBe(1)
    // provision saves timing and the token envelope to ActionState
    expect(stateState.entries.has("timing")).toBe(true)
  })
})
```

### Testing the post phase

Pre-populate `ActionStateTest` to simulate the state `pre` wrote, then check that `dispose` revoked the token and `duration-ms` was set.

```typescript
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  ActionLoggerTest,
  ActionOutputsTest,
  ActionStateTest,
  GitHubAppTest,
} from "@savvy-web/github-action-effects/testing"

describe("post phase", () => {
  it("revokes the token and reports duration", async () => {
    const stateState = ActionStateTest.empty()
    const outputState = ActionOutputsTest.empty()
    const appState = GitHubAppTest.empty()

    // Simulate state written by pre.ts
    stateState.entries.set("timing", JSON.stringify({ startedAt: Date.now() - 5000 }))

    const layer = Layer.mergeAll(
      ActionLoggerTest.layer(ActionLoggerTest.empty()),
      ActionOutputsTest.layer(outputState),
      ActionStateTest.layer(stateState),
      GitHubAppTest.layer(appState),
    )

    // Run your post.ts program against the pre-populated state
    // await postProgram.pipe(Effect.provide(layer), Effect.runPromise)

    // duration-ms output was set from the timing state
    expect(outputState.outputs.some((o) => o.name === "duration-ms")).toBe(true)
  })
})
```

See [Testing GitHub Actions](./08-testing.md) for the complete test layer API and more patterns.

## Next steps

- [Services guide](./03-services.md) — detailed usage for each service
- [Testing GitHub Actions](./08-testing.md) — test multi-phase actions with in-memory layers
- [Common patterns](./04-patterns.md) — dry-run, error accumulation and more
- [Peer dependencies](./05-peer-dependencies.md) — which packages to install
