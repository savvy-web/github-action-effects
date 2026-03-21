---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 95
related:
  - ./index.md
  - ./services.md
  - ./layers.md
dependencies: []
---

# Integration Points

## Overview

Dependencies, external integrations, and how services compose in
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [layers.md](./layers.md) for layer dependency graph.

---

## Dependencies

### Required Peers

**effect** -- Core dependency. Services use `Context.Tag`, `Layer`,
`Schema`, `Data.TaggedError`, `FiberRef`, `Logger`, `Config`, and
`ConfigProvider`.

**@effect/platform and @effect/platform-node** -- `ActionsRuntime.Default`
provides `NodeFileSystem.layer` from `@effect/platform-node`, giving
programs access to `FileSystem`. Several services (ActionOutputs,
ActionState, ConfigLoader, ChangesetAnalyzer, WorkspaceDetector,
PackagePublish) depend on `FileSystem` from `@effect/platform`.

### Direct Dependencies

| Package | Purpose | Used By |
| --- | --- | --- |
| `@octokit/rest` | GitHub REST + GraphQL API client | `GitHubClientLive` |
| `@octokit/auth-app` | GitHub App JWT authentication | `OctokitAuthAppLive` |
| `@azure/storage-blob` | Azure Blob Storage upload/download for cache | `ActionCacheLive` |
| `jsonc-effect` | JSONC parsing with Effect | `ConfigLoaderLive` |
| `semver-effect` | Semver operations with Effect | `SemverResolver` |
| `yaml-effect` | YAML parsing with Effect | `ConfigLoaderLive` |

These are direct dependencies (not peers), bundled with the library.

### No @actions/* Dependencies

All `@actions/*` packages have been removed. The library implements the
GitHub Actions runtime protocol natively:

| Previously | Now |
| --- | --- |
| `@actions/core` getInput | `ActionsConfigProvider` reading `INPUT_*` env vars |
| `@actions/core` setOutput | `RuntimeFile.append("GITHUB_OUTPUT", ...)` |
| `@actions/core` saveState | `RuntimeFile.append("GITHUB_STATE", ...)` |
| `@actions/core` exportVariable | `RuntimeFile.append("GITHUB_ENV", ...)` |
| `@actions/core` addPath | Append to `GITHUB_PATH` file |
| `@actions/core` debug/warning/error | `WorkflowCommand.issue("debug"/"warning"/"error", ...)` |
| `@actions/core` group/endgroup | `WorkflowCommand.issue("group"/"endgroup", ...)` |
| `@actions/core` setSecret | `WorkflowCommand.issue("add-mask", ...)` |
| `@actions/core` setFailed | `WorkflowCommand.issue("error", ...) + process.exitCode = 1` |
| `@actions/core` summary | Direct write to `$GITHUB_STEP_SUMMARY` file |
| `@actions/exec` | `node:child_process` spawn |
| `@actions/github` getOctokit | Direct `@octokit/rest` instantiation |
| `@actions/cache` | V2 Twirp RPC protocol + `@azure/storage-blob` at ACTIONS_RESULTS_URL |
| `@actions/tool-cache` | Native `fetch` + `node:child_process` + `node:fs/promises` |

---

## GitHub Actions Runtime Protocol

The library interacts with the GitHub Actions runtime through:

### Workflow Commands (stdout)

Format: `::command key=value,key=value::message`

Used for: debug, warning, error, group/endgroup, add-mask, and other
workflow commands. Implemented in `src/runtime/WorkflowCommand.ts`.

### Environment Files

Append key-value pairs to files specified by environment variables:

| Env Var | Purpose |
| --- | --- |
| `GITHUB_OUTPUT` | Set step outputs |
| `GITHUB_ENV` | Export environment variables |
| `GITHUB_STATE` | Save state across phases |
| `GITHUB_PATH` | Add to PATH |
| `GITHUB_STEP_SUMMARY` | Write step summary markdown |

Implemented in `src/runtime/RuntimeFile.ts`. Supports multiline values
via the delimiter protocol (`key<<delimiter\nvalue\ndelimiter`).

### Input Variables

Action inputs are available as `INPUT_*` environment variables with the
name uppercased and spaces replaced by underscores. Hyphens are preserved.

Implemented in `src/runtime/ActionsConfigProvider.ts` as an Effect
`ConfigProvider`.

### Cache Protocol (V2 Twirp)

The V2 cache API at `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`
authentication. Uses the Twirp RPC service at
`/twirp/github.actions.results.api.v1.CacheService/`. Three-step save
(`CreateCacheEntry`, Azure Blob upload, `FinalizeCacheEntryUpload`) and
`GetCacheEntryDownloadURL`-based restore via Azure Blob download.

Implemented in `src/layers/ActionCacheLive.ts` using native `fetch` for
Twirp RPC calls and `@azure/storage-blob` for Azure Blob Storage transfers.

---

## Service Dependency Graph

```text
Tier 0 — No service dependencies:
  ActionLogger              (uses WorkflowCommand, Effect Logger)
  ActionEnvironment         (reads process.env)
  ActionCache               (V2 Twirp RPC + @azure/storage-blob + tar)
  CommandRunner             (node:child_process spawn)
  ToolInstaller             (native fetch + spawn + fs)
  DryRun                    (pure logic)
  OctokitAuthApp            (imports @octokit/auth-app)
  GitHubClient              (imports @octokit/rest, reads GITHUB_TOKEN)

Tier 0.5 — Depends on FileSystem:
  ActionOutputs             -> FileSystem
  ActionState               -> FileSystem

Tier 1 — Single service dependency:
  GitHubApp                 -> OctokitAuthApp
  NpmRegistry               -> CommandRunner
  ChangesetAnalyzer         -> FileSystem
  ConfigLoader              -> FileSystem
  TokenPermissionChecker    -> GitHubApp

Tier 2 — GitHubClient dependents:
  GitHubGraphQL             -> GitHubClient
  GitBranch                 -> GitHubClient
  GitCommit                 -> GitHubClient
  GitTag                    -> GitHubClient
  GitHubRelease             -> GitHubClient
  CheckRun                  -> GitHubClient
  PullRequestComment        -> GitHubClient
  RateLimiter               -> GitHubClient
  WorkflowDispatch          -> GitHubClient
  GitHubIssue               -> GitHubClient + GitHubGraphQL
  PullRequest               -> GitHubClient + GitHubGraphQL

Tier 2 — Multi-service (non-GitHubClient):
  PackageManagerAdapter     -> CommandRunner + FileSystem
  WorkspaceDetector         -> FileSystem + CommandRunner

Tier 3 — Composed dependencies:
  PackagePublish            -> CommandRunner + NpmRegistry + FileSystem
  AutoMerge (utility)       -> GitHubGraphQL
```

### ActionsRuntime.Default as the Integration Point

`ActionsRuntime.Default` is the single integration point for wiring the
runtime layer into user programs. It provides everything needed for basic
action I/O:

```text
ActionsRuntime.Default
  ├── ConfigProvider        (ActionsConfigProvider → INPUT_* env vars)
  ├── Logger                (ActionsLogger → workflow commands)
  ├── ActionLoggerLive      (group + withBuffer)
  ├── ActionOutputsLive     (outputs, summaries, env vars, PATH, secrets)
  ├── ActionStateLive       (state persistence across phases)
  ├── ActionEnvironmentLive (GitHub/runner context)
  └── NodeFileSystem.layer  (FileSystem for ActionOutputs + ActionState)
```

### Layer Provision for Tier 2+

```text
GitHubClientLive           (reads GITHUB_TOKEN from env)
  -> CheckRunLive              (requires GitHubClient in context)
  -> PullRequestLive           (requires GitHubClient + GitHubGraphQL)
  -> PullRequestCommentLive    (requires GitHubClient in context)
  -> GitHubGraphQLLive         (requires GitHubClient in context)
  -> GitBranchLive             (requires GitHubClient in context)
  -> GitCommitLive             (requires GitHubClient in context)
  -> GitTagLive                (requires GitHubClient in context)
  -> GitHubReleaseLive         (requires GitHubClient in context)
  -> GitHubIssueLive           (requires GitHubClient + GitHubGraphQL)
  -> RateLimiterLive           (requires GitHubClient in context)
  -> WorkflowDispatchLive      (requires GitHubClient in context)

Test layers for all Tier 2 services do NOT depend on GitHubClient --
they operate entirely in-memory.
```

---

## Consumer Patterns

### Basic Action (inputs + outputs)

```typescript
import { Effect, Config } from "effect"
import { Action } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const name = yield* Config.string("name")
  yield* Effect.log(`Hello, ${name}!`)
})

Action.run(program)
```

### Action with GitHub API

```typescript
import { Effect, Config, Layer } from "effect"
import { Action, GitHubClientLive, CheckRunLive }
  from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  // ...
})

Action.run(program, {
  layer: Layer.mergeAll(CheckRunLive).pipe(
    Layer.provideMerge(GitHubClientLive),
  ),
})
```

### Manual Layer Composition

```typescript
import { Effect, Layer } from "effect"
import { ActionsRuntime, GitHubClientLive, CheckRunLive }
  from "@savvy-web/github-action-effects"

const MyLayer = Layer.mergeAll(
  ActionsRuntime.Default,
  CheckRunLive,
).pipe(Layer.provideMerge(GitHubClientLive))

Effect.runPromise(program.pipe(Effect.provide(MyLayer)))
```

---

## Optional Integrations

### @savvy-web/github-action-builder

Actions built with the builder benefit from this library but it is not
required. Any Node.js 24 action can use these services. The builder bundles
with `@vercel/ncc`, which requires static imports (no dynamic `import()`).

## Current State

All dependencies and service tiers are documented with a complete dependency
graph. The `@actions/*` packages have been fully replaced with native
implementations. `ActionsRuntime.Default` is the single integration point
for wiring the runtime layer. `@octokit/rest`, `@octokit/auth-app`, and
`@azure/storage-blob` are the only external runtime dependencies (besides
Effect peers).

## Rationale

Removing `@actions/*` packages eliminates CJS dependencies, simplifies the
layer graph (no platform wrapper tier), and gives the library full control
over the runtime protocol implementation. The tiered dependency graph makes
layer composition predictable and testable at each level.

## Related Documentation

- [Architecture Index](./index.md) -- overall architecture and design overview
- [Services](./services.md) -- service interface definitions
- [Layers](./layers.md) -- layer dependency graph and composition
