# Building a robust action

This guide collects the decisions that keep an action working on a flaky runner instead of failing the first time a 503 comes back. It is principles and pointers, not a second copy of each service's reference — every section links to the guide that goes deep. Read it once before you wire your first action, then come back when something behaves oddly in CI.

## Wiring: ActionsRuntime.Default vs hand-composed layers

`Action.run(program)` is the path you want for almost every action. It provides `ActionsRuntime.Default` (the ConfigProvider, the Effect Logger, the core services, a Node.js `FileSystem` and a fetch-backed `HttpClient`), wraps the program in buffered logging, catches every cause, emits an `::error::` workflow command and sets `process.exitCode = 1` on failure. The clean exit behaviour comes for free; you write none of it.

```typescript
import { Effect } from "effect"
import { Action } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  yield* Effect.log("starting")
  // ... your logic
})

Action.run(program)
```

Reach for hand-composed layers only when the default stack is not enough — an extra service, a non-default credential source, a memoized App client shared across sub-programs. Even then, layer your additions on top of the default rather than rebuilding it:

```typescript
import { Layer } from "effect"
import { Action, GitHubClientLive, GitHubReleaseLive, DryRunLive } from "@savvy-web/github-action-effects"

Action.run(program, {
  layer: Layer.mergeAll(GitHubClientLive.fromEnv(), GitHubReleaseLive, DryRunLive),
})
```

For the runtime internals behind `ActionsRuntime.Default` and the `Action.run` type-erasure boundary, see [architecture](./14-architecture.md#actionsruntimedefault). For composing additional layers, see [common patterns](./04-patterns.md#composing-additional-layers).

## Structure long actions as pre / main / post

A single-phase action runs once and exits. An action that needs setup before the job and teardown after it — provisioning a token, then revoking it — should split into three phases backed by `ActionState`. State crosses phases through the `GITHUB_STATE` file, schema-encoded so the `post` phase reads back the same shape the `pre` phase wrote.

The canonical case is App-token authentication: `pre` provisions, `main` builds a client from the persisted token, `post` revokes it. `GitHubToken` coordinates all three. The full three-phase walkthrough — including the `action.yml` `pre`/`post` wiring — is [the advanced action guide](./02-advanced-action.md).

## Guard mutations with DryRun

Any action that creates releases, opens PRs or publishes packages should support a dry-run mode so a maintainer can preview what it would do. The `DryRun` service intercepts a mutation effect and returns a fallback value instead of running it when dry-run is enabled, so the surrounding code stays identical between real and rehearsal runs.

```typescript
import { Effect } from "effect"
import { DryRun, GitHubRelease } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const dryRun = yield* DryRun
  const releases = yield* GitHubRelease

  // In dry-run mode the create call is skipped and the fallback is returned.
  const release = yield* dryRun.guard(
    "create-release",
    releases.create({ tag: "v1.0.0", name: "v1.0.0", body: "Release notes" }),
    { id: 0, tag: "v1.0.0", name: "v1.0.0", body: "", draft: false, prerelease: false, uploadUrl: "" },
  )
  yield* Effect.log(`release id: ${release.id}`)
  // release id: 0   (in dry-run; the real id on a live run)
})
```

The full pattern is in [common patterns](./04-patterns.md#dry-run-mode).

## Check token permissions before you use them

A token that lacks a scope fails deep inside an API call with a cryptic 403. Check the scopes up front instead, so the action stops with a message that names the missing permission. `TokenPermissionCheckerLive` takes the granted permissions record and returns a layer; `assertSufficient` fails fast on a gap, `assertExact` enforces least-privilege, `warnOverPermissioned` flags excess without failing.

```typescript
import { Effect } from "effect"
import { TokenPermissionChecker, TokenPermissionCheckerLive } from "@savvy-web/github-action-effects"

const granted = { contents: "write", "pull-requests": "write" }

const program = Effect.gen(function* () {
  const checker = yield* TokenPermissionChecker
  yield* checker.assertSufficient({ contents: "write", "pull-requests": "write" })
}).pipe(Effect.provide(TokenPermissionCheckerLive(granted)))
```

When you provision an App token with `GitHubToken.provision({ permissions })`, the check runs for you and the rejected token is revoked on a gap — you do not wire the checker by hand. See [permission checking](./04-patterns.md#permission-checking) and [App token provisioning](./04-patterns.md#app-token-provisioning).

## Make re-runs idempotent

A workflow re-run should not write a release twice, publish the same tarball twice or attest the same digest twice. Design every mutation so that running it again on an already-done artifact is a no-op. Two library patterns make this concrete:

- **Probe then publish.** Pack the package once, compare its integrity digest against what the registry already has and upload only when they differ. See [publishing packages](./11-publishing.md#probe-then-publish).
- **List before you attest.** `Attest.listForSubject(sha256Hex)` returns the attestations already written for a digest, so the orchestrator reuses an existing attestation URL instead of writing a fresh one. See [generating SLSA attestations](./10-slsa-attestations.md#idempotent-recovery).

Both come down to the same idea: read the current state, then act only on the delta. That is what lets a partially-failed run recover cleanly on a retry.

## Handle secrets as Redacted, mask generated ones

Tokens and private keys are `Redacted<string>` throughout the secret-bearing API surface — `GitHubClientLive.fromToken`, `fromApp`'s `privateKey`, `GitHubApp.generateToken`, `PackagePublish.setupAuth` and the rest. Wrap a raw string with `Redacted.make(...)` at the call site and unwrap with `Redacted.value(...)` only at the single wire boundary that needs the plain text. A `Redacted` value prints as `<redacted>` if it lands in a log line, so an accidental `Effect.log(token)` cannot leak it.

```typescript
import { Effect, Redacted } from "effect"
import { GitHubClientLive } from "@savvy-web/github-action-effects"

const layer = GitHubClientLive.fromToken(Redacted.make(process.env.MY_TOKEN ?? ""))
```

Values your action generates at runtime — an installation token, a derived password — are not read through an input, so GitHub does not mask them automatically. Register them with `ActionOutputs.setSecret(value)` so the runner scrubs them from every subsequent log line.

```typescript
import { Effect } from "effect"
import { ActionOutputs } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  yield* outputs.setSecret(generatedToken)
  yield* Effect.log(`token: ${generatedToken}`)
  // token: ***   (the runner masks the registered value)
})
```

Secret masking in logs is covered alongside the rest of the logging story in [logging and error handling](./07-logging-and-error-handling.md#mask-secrets-in-logs).

## Accumulate errors when a batch should not stop on the first failure

Processing a list of packages, repos or files often should not abort the moment one item fails — you want every result and a report of what broke. `ErrorAccumulator.forEachAccumulate` runs the whole batch, collects successes and failures into one result and never short-circuits. Its error channel is `never`; every failure lands in `result.failures`.

```typescript
import { Effect } from "effect"
import { ErrorAccumulator } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const result = yield* ErrorAccumulator.forEachAccumulate(
    ["pkg-a", "pkg-b", "pkg-c"],
    (pkg) => publishPackage(pkg),
  )
  yield* Effect.log(`published ${result.successes.length}, failed ${result.failures.length}`)
  // published 2, failed 1   (counts depend on which items failed)
})
```

For bounded concurrency, `forEachAccumulateConcurrent(items, fn, n)` runs at most `n` at once. See [error accumulation](./04-patterns.md#error-accumulation).

## Which service for which job

A quick map from "I need to ..." to the service that does it. Each links to its reference.

| You need to | Reach for | Guide |
| --- | --- | --- |
| Read an input | `Config.string` / `ActionInput.boolean` | [toolkit parity](./06-toolkit-parity.md#actionscore) |
| Set an output or write a step summary | `ActionOutputs` | [services](./03-services.md#actionoutputs) |
| Pass state between phases | `ActionState` | [advanced action](./02-advanced-action.md) |
| Read the event payload / repo / issue | `ActionEnvironment` | [toolkit parity](./06-toolkit-parity.md#actionsgithub-context-and-api) |
| Call the GitHub REST or GraphQL API | `GitHubClient` | [resilient GitHub API calls](./08-resilient-github-api.md) |
| Run a shell command | `CommandRunner` | [toolkit parity](./06-toolkit-parity.md#actionsexec) |
| Resolve globs or hash files | `Glob` | [toolkit parity](./06-toolkit-parity.md#actionsglob) |
| Save / restore a cache | `ActionCache` | [toolkit parity](./06-toolkit-parity.md#actionscache) |
| Upload / download an artifact | `Artifact` | [toolkit parity](./06-toolkit-parity.md#actionsartifact) |
| Install a tool binary | `ToolInstaller` | [toolkit parity](./06-toolkit-parity.md#actionstool-cache) |
| Publish a package | `PackagePublish` | [publishing](./11-publishing.md) |
| Sign provenance or an SBOM | `Attest` | [SLSA attestations](./10-slsa-attestations.md) |
| Keep logs quiet on success | `Step` | [step-buffered logging](./09-step-logging.md) |

For the full per-service catalog, see the [services guide](./03-services.md).
