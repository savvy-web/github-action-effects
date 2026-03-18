# Advanced Action: Three-Stage App

This tutorial builds a complete three-stage GitHub Action with `pre`, `main`,
and `post` phases. It demonstrates four key library features:

- **Log level helper** -- configure and resolve log levels from action inputs
- **OpenTelemetry** -- auto-configured tracing across all three phases
- **GitHub App authentication** -- generate and revoke installation tokens
- **ActionState** -- transfer typed data between phases

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
  log-level:
    description: 'Log level (info, verbose, debug, auto)'
    required: false
    default: 'auto'
  dry-run:
    description: 'Skip actual publishing'
    required: false
    default: 'false'
  otel-enabled:
    description: 'Enable OpenTelemetry (enabled, disabled, auto)'
    required: false
    default: 'auto'
  otel-endpoint:
    description: 'OTLP endpoint URL'
    required: false
  otel-protocol:
    description: 'OTLP protocol (grpc, http/protobuf, http/json)'
    required: false
    default: 'grpc'
  otel-headers:
    description: 'OTLP headers (comma-separated key=value)'
    required: false

outputs:
  published-count:
    description: 'Number of packages published'
  duration-ms:
    description: 'Total elapsed time in milliseconds'
  token-permissions:
    description: 'JSON of resolved token permissions'

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
import { Effect, Layer, Schema } from "effect"
import {
  Action,
  ActionInputs,
  ActionLogger,
  ActionState,
  ActionStateLive,
  GitHubApp,
  GitHubAppLive,
  LogLevelInput,
  TokenPermissionChecker,
  TokenPermissionCheckerLive,
} from "@savvy-web/github-action-effects"

import { TimingState, TokenState } from "./shared.js"

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const app = yield* GitHubApp
  const checker = yield* TokenPermissionChecker

  // -- 1. Configure log level --
  // Reads the `log-level` input and resolves "auto" based on RUNNER_DEBUG.
  // "auto" becomes "debug" when RUNNER_DEBUG=1, otherwise "info".
  const logLevelInput = yield* inputs.get("log-level", LogLevelInput)
  const resolvedLevel = Action.resolveLogLevel(logLevelInput)
  yield* Action.setLogLevel(resolvedLevel)
  yield* Effect.log(`Log level: ${resolvedLevel}`)

  // -- 2. Record start time --
  yield* state.save("timing", { startedAt: Date.now() }, TimingState)

  // -- 3. Authenticate as GitHub App --
  const appId = yield* inputs.get("app-id", Schema.NumberFromString)
  const privateKey = yield* inputs.getSecret("private-key", Schema.String)

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
}).pipe(Effect.withSpan("pre-phase"))

Action.run(
  program,
  Layer.mergeAll(
    ActionStateLive,
    GitHubAppLive,
    TokenPermissionCheckerLive,
  ),
)
```

### What happens in pre.ts

1. **Log level** -- `LogLevelInput` is a schema that accepts `"info"`,
   `"verbose"`, `"debug"`, or `"auto"`. `Action.resolveLogLevel` converts
   `"auto"` to a concrete level by checking `RUNNER_DEBUG`. Then
   `Action.setLogLevel` configures the fiber so all subsequent `Effect.log`
   calls respect it.

2. **ActionState.save** -- Persists the start timestamp as a Schema-encoded
   JSON string. GitHub Actions stores state as key-value string pairs between
   phases; the Schema encode/decode layer handles serialization transparently.

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
import { Effect, Layer, Schema } from "effect"
import {
  Action,
  ActionInputs,
  ActionLogger,
  ActionOutputs,
  ActionState,
  ActionStateLive,
  DryRun,
  DryRunLive,
  ErrorAccumulator,
  GithubMarkdown,
  LogLevelInput,
  NpmRegistry,
  NpmRegistryLive,
  PackagePublish,
  PackagePublishLive,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState, TokenState } from "./shared.js"

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const dryRun = yield* DryRun
  const npm = yield* NpmRegistry
  const publisher = yield* PackagePublish

  // -- 1. Restore log level (each phase is a separate process) --
  const logLevelInput = yield* inputs.get("log-level", LogLevelInput)
  yield* Action.setLogLevel(Action.resolveLogLevel(logLevelInput))

  // -- 2. Read state from pre phase --
  const timing = yield* state.get("timing", TimingState)
  const tokenInfo = yield* state.get("token", TokenState)
  yield* Effect.log(`Resuming from pre (started ${timing.startedAt})`)
  yield* Effect.log(`Using installation ${tokenInfo.installationId}`)

  // -- 3. Read inputs --
  const packages = yield* inputs.getMultiline("packages", Schema.String)
  const isDry = yield* inputs.getBooleanOptional("dry-run", false)

  yield* Effect.log(`Publishing ${packages.length} packages (dry-run: ${isDry})`)

  // -- 4. Publish each package, accumulating errors --
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

  // -- 5. Save results for post phase --
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

  // -- 6. Set outputs --
  yield* outputs.set("published-count", String(result.successes.length))

  // -- 7. Write step summary --
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
}).pipe(Effect.withSpan("main-phase"))

Action.run(
  program,
  Layer.mergeAll(
    ActionStateLive,
    DryRunLive,
    NpmRegistryLive,
    PackagePublishLive,
  ),
)
```

### What happens in main.ts

1. **Log level restored** -- Each phase runs as a separate Node.js process.
   The log level input is re-read and re-applied because `Action.setLogLevel`
   is scoped to the current fiber.

2. **State from pre** -- `state.get("timing", TimingState)` reads and
   Schema-decodes the timing data saved by `pre.ts`. If the state is missing
   or invalid, it fails with an `ActionStateError`.

3. **ErrorAccumulator** -- `forEachAccumulate` processes all packages without
   short-circuiting. Failed publishes are collected alongside successes,
   allowing a complete summary.

4. **Buffer-on-failure** -- `logger.withBuffer` captures verbose output per
   package. On success the buffer is discarded; on failure it flushes for
   debugging context.

5. **DryRun.guard** -- When `dry-run` is `"true"`, the `publisher.publish`
   call is skipped and the fallback value (`undefined`) is returned instead.

## Phase 3: post.ts

The `post` phase always runs, even if `main` fails. Use it for cleanup,
timing reports, and final telemetry.

```typescript
// src/post.ts
import { Effect, Layer, Option } from "effect"
import {
  Action,
  ActionLogger,
  ActionOutputs,
  ActionState,
  ActionStateLive,
  ActionTelemetry,
  ActionTelemetryLive,
  GithubMarkdown,
  LogLevelInput,
  ActionInputs,
} from "@savvy-web/github-action-effects"

import { PublishState, TimingState } from "./shared.js"

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs
  const logger = yield* ActionLogger
  const state = yield* ActionState
  const outputs = yield* ActionOutputs
  const telemetry = yield* ActionTelemetry

  // -- 1. Restore log level --
  const logLevelInput = yield* inputs.get("log-level", LogLevelInput)
  yield* Action.setLogLevel(Action.resolveLogLevel(logLevelInput))

  // -- 2. Calculate elapsed time --
  const timing = yield* state.get("timing", TimingState)
  const elapsed = Date.now() - timing.startedAt
  yield* outputs.set("duration-ms", String(elapsed))

  // -- 3. Record telemetry metrics --
  yield* telemetry.metric("action.duration", elapsed, "ms")
  yield* telemetry.attribute("action.phase", "post")

  // -- 4. Read publish results (may not exist if main failed early) --
  const publishResult = yield* state.getOptional("publish", PublishState)

  yield* logger.group("Summary", Effect.gen(function* () {
    if (Option.isSome(publishResult)) {
      const pub = publishResult.value
      yield* telemetry.metric("packages.published", pub.publishedCount)
      yield* telemetry.metric("packages.failed", pub.failedCount)
      yield* Effect.log(`Published: ${pub.publishedCount}, Failed: ${pub.failedCount}`)
    } else {
      yield* Effect.log("No publish results (main phase may have failed)")
    }
    yield* Effect.log(`Total duration: ${elapsed}ms`)
  }))

  // -- 5. Append timing to step summary --
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
}).pipe(Effect.withSpan("post-phase"))

Action.run(
  program,
  Layer.mergeAll(
    ActionStateLive,
    ActionTelemetryLive,
  ),
)
```

### What happens in post.ts

1. **state.getOptional** -- Unlike `state.get` which fails on missing keys,
   `getOptional` returns `Option.none()` when the key does not exist. This
   handles the case where `main` failed before saving publish results.

2. **ActionTelemetry** -- Records numeric metrics and string attributes.
   These are captured by the in-memory tracer and included in the step
   summary timing table. With OTel enabled, they are also exported to your
   OTLP endpoint.

3. **Timing summary** -- `outputs.summary` appends markdown to the existing
   step summary written by `main`. Each call appends rather than replacing.

## OpenTelemetry Across Phases

Each phase runs `Action.run` independently, which means each phase gets its
own OTel configuration. The four `otel-*` inputs are read by `Action.run`
at startup in every phase.

When an OTLP endpoint is configured:

- All three phases export traces to the same endpoint
- Spans from `Effect.withSpan` calls (like `"pre-phase"`, `"main-phase"`,
  `"post-phase"`) appear in your tracing backend
- Each phase is a separate trace (they run in separate processes)

When no endpoint is configured:

- The in-memory tracer captures spans per phase
- A timing summary table is appended to the step summary automatically
- You still get basic observability without any external tooling

## Workflow Usage

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: my-org/release-publisher@v1
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
          packages: |
            @scope/core
            @scope/utils
            @scope/cli
          log-level: verbose
          dry-run: false
          otel-endpoint: ${{ secrets.OTEL_ENDPOINT }}
          otel-headers: api-key=${{ secrets.OTEL_API_KEY }}
```

## Key Takeaways

**State is the bridge between phases.** Each phase runs as a separate
Node.js process. `ActionState` with Effect Schemas provides type-safe
serialization across the process boundary.

**Log level must be set in each phase.** `Action.setLogLevel` configures
the current fiber, which does not persist across processes. Re-read the
input and re-apply in every phase.

**Use `getOptional` in post.** The `post` phase always runs, but earlier
phases may have failed before saving their state. Use `state.getOptional`
to handle missing state gracefully.

**OTel is automatic.** `Action.run` reads the `otel-*` inputs and
configures tracing in every phase. No additional setup is needed.

**Bracket patterns clean up automatically.** `GitHubApp.withToken` revokes
the installation token even if the callback fails, preventing token leaks.

## Next Steps

- [Services Guide](./services.md) -- detailed usage for each service
- [OpenTelemetry](./otel.md) -- OTel configuration and tracing details
- [Testing](./testing.md) -- test multi-phase actions with in-memory layers
- [Patterns](./patterns.md) -- dry-run, error accumulation, and more
- [Peer Dependencies](./peer-dependencies.md) -- which packages to install
