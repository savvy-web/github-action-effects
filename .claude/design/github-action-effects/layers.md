---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-19
last-synced: 2026-03-19
completeness: 90
related:
  - ./index.md
  - ./services.md
  - ./testing-strategy.md
dependencies: []
---

# Layers

Layer patterns, live vs test implementations, and service dependency graph for
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [services.md](./services.md) for service interface descriptions.

---

## Overview

This document describes the layer architecture for all services. Each domain
service has a `Live` layer backed by real platform calls via the wrapper
services and a `Test` layer backed by in-memory state for unit testing.
The 6 platform wrapper services have `Live` layers that directly import
`@actions/*` packages and no `Test` layers (consumers mock them directly).
The document also covers the service dependency graph and layer composition
patterns.

---

## Layer Composition

Each service has a `Live` layer backed by real platform calls and a `Test`
layer backed by in-memory state for unit testing.

```text
Platform Wrapper Layers (new — the ONLY files that import @actions/* directly):
  ActionsCoreLive        — Layer.succeed; wraps @actions/core module object
  ActionsGitHubLive      — Layer.succeed; wraps @actions/github.getOctokit()
  ActionsCacheLive       — Layer.succeed; wraps @actions/cache functions
  ActionsExecLive        — Layer.succeed; wraps @actions/exec.exec()
  ActionsToolCacheLive   — Layer.succeed; wraps @actions/tool-cache functions
  OctokitAuthAppLive     — Layer.succeed; wraps @octokit/auth-app createAppAuth()
  ActionsPlatformLive    — Layer.mergeAll of all 6 above; type alias ActionsPlatform

Core Action I/O:
  ActionInputsLive       — Layer.effect depending on ActionsCore (getInput via DI)
  ActionInputsTest       — reads from provided Record<string, string>
    (both share decodeInput/decodeJsonInput from layers/internal/decodeInput.ts)

  ActionLoggerLive       — Layer.effect depending on ActionsCore; closure captures core
                           at construction time, routes to core.info/debug/warning/error
  ActionLoggerTest       — captures log entries in memory (annotations include type field)

  ActionLoggerLayer      — Layer.unwrapEffect depending on ActionsCore; installs logger
                           as the Effect default logger. Requires ActionsCore in context.

  ActionOutputsLive      — Layer.effect depending on ActionsCore
  ActionOutputsTest      — captures outputs in memory

  ActionStateLive        — Layer.effect depending on ActionsCore; Schema encode/decode
  ActionStateTest        — in-memory Map<string, string>, pre-populatable for phase simulation

  ActionEnvironmentLive  — Layer.succeed; reads from process.env, lazy context construction
  ActionEnvironmentTest  — reads from provided Record<string, string>

  ActionCacheLive        — Layer.effect depending on ActionsCache (via DI, not direct import)
  ActionCacheTest        — in-memory Map for cache simulation (always-miss when empty)

Git Operations:
  GitBranchLive          — Layer.effect depending on GitHubClient
  GitBranchTest          — in-memory branch state Map<name, sha>

  GitCommitLive          — Layer.effect depending on GitHubClient
  GitCommitTest          — in-memory tree/commit/ref state

  GitTagLive             — Layer.effect depending on GitHubClient
  GitTagTest             — in-memory tag state Map<tag, sha>

GitHub API:
  GitHubClientLive(token) — function returning Layer; Layer.effect depending on ActionsGitHub
                            (calls gh.getOctokit(token) via DI, not @actions/github directly)
  GitHubClientTest        — Map-based recorded REST/GraphQL responses; default test repo

  GitHubGraphQLLive      — Layer.effect depending on GitHubClient
  GitHubGraphQLTest      — recorded query/mutation responses

  GitHubReleaseLive      — Layer.effect depending on GitHubClient
  GitHubReleaseTest      — in-memory release state

  GitHubIssueLive        — Layer.effect depending on GitHubClient (+ GitHubGraphQL for linked issues)
  GitHubIssueTest        — in-memory issue state

  GitHubAppLive          — Layer.effect depending on OctokitAuthApp (via DI)
  GitHubAppTest          — in-memory token state

  CheckRunLive           — Layer.effect depending on GitHubClient; caps annotations at 50
  CheckRunTest           — in-memory CheckRunRecord array; resets ID counter on .empty()

  PullRequestCommentLive — Layer.effect depending on GitHubClient; uses Issues API
  PullRequestCommentTest — in-memory Map<prNumber, comments[]>; instance-scoped nextId

  RateLimiterLive        — Layer.effect depending on GitHubClient
  RateLimiterTest        — configurable rate limit state

  WorkflowDispatchLive   — Layer.effect depending on GitHubClient
  WorkflowDispatchTest   — in-memory dispatch records

Build Tooling:
  CommandRunnerLive      — Layer.effect depending on ActionsExec (via DI); stdout/stderr listeners
  CommandRunnerTest      — Map<string, { exitCode, stdout, stderr }> keyed by command string

  NpmRegistryLive        — depends on CommandRunner; runs npm view --json
  NpmRegistryTest        — in-memory package metadata

  PackagePublishLive     — depends on CommandRunner + NpmRegistry + FileSystem
  PackagePublishTest     — in-memory publish state

  PackageManagerAdapterLive — depends on CommandRunner + FileSystem
  PackageManagerAdapterTest — in-memory PM state

  WorkspaceDetectorLive  — depends on FileSystem + CommandRunner
  WorkspaceDetectorTest  — in-memory workspace state

  ToolInstallerLive      — Layer.effect depending on ActionsCore + ActionsToolCache (via DI)
  ToolInstallerTest      — in-memory tool cache state

  ChangesetAnalyzerLive  — depends on FileSystem
  ChangesetAnalyzerTest  — in-memory changeset state

  ConfigLoaderLive       — depends on FileSystem
  ConfigLoaderTest       — in-memory config file state

  DryRunLive             — reads enabled flag from constructor param
  DryRunTest             — always dry, records guarded labels in state

Observability:
  ActionTelemetryLive    — in-memory metrics + Effect.annotateCurrentSpan
  ActionTelemetryTest    — in-memory metrics + attributes

  InMemoryTracer.layer   — captures Effect.withSpan spans in memory for reporting
  OtelTelemetryLive      — bridges Effect tracer to OpenTelemetry (static import, regular dep)
  OtelExporterLive       — configures OTel exporter via static @effect/opentelemetry import

Platform:
  NodeContext.layer      — @effect/platform-node: FileSystem, Path, Terminal,
                           CommandExecutor, WorkerManager (provided by Action.run)

Action Helpers:
  Action.parseInputs     — inlined in Action.ts, reads all inputs from a config record
                           (depends on ActionInputs service, not bundled into Action.run)
```

---

## Import Pattern

All Live layers use static imports for their dependencies, including optional
peer dependencies. No Live layer uses dynamic `import()`. This is required
because `@vercel/ncc` (used by `@savvy-web/github-action-builder`) cannot
follow dynamic imports at bundle time.

### Platform Wrapper Live Layers (direct @actions/* imports)

Only the 6 platform wrapper Live layers import `@actions/*` packages directly:

- `ActionsCoreLive` -- `import * as core from "@actions/core"`
- `ActionsGitHubLive` -- `import * as github from "@actions/github"`
- `ActionsCacheLive` -- `import * as cache from "@actions/cache"`
- `ActionsExecLive` -- `import * as actionsExec from "@actions/exec"`
- `ActionsToolCacheLive` -- `import * as tc from "@actions/tool-cache"`
- `OctokitAuthAppLive` -- `import { createAppAuth } from "@octokit/auth-app"`

### Domain Live Layers (DI via wrapper services)

All other Live layers that previously imported `@actions/*` directly now use
DI via `Layer.effect` and `yield*`:

- `ActionInputsLive` -- `yield* ActionsCore` (no direct @actions/core import)
- `ActionLoggerLive` -- `yield* ActionsCore` (closure captures `core`)
- `ActionOutputsLive` -- `yield* ActionsCore`
- `ActionStateLive` -- `yield* ActionsCore`
- `ActionCacheLive` -- `yield* ActionsCache`
- `CommandRunnerLive` -- `yield* ActionsExec`
- `GitHubClientLive` -- `yield* ActionsGitHub`
- `GitHubAppLive` -- `yield* OctokitAuthApp`
- `ToolInstallerLive` -- `yield* ActionsCore` + `yield* ActionsToolCache`

### OTel Layers

- `OtelExporterLive` / `OtelTelemetryLive` -- static `@effect/opentelemetry`
  and `@opentelemetry/*` imports (these are regular dependencies, not optional
  peers)

Consumers do not need bare `import` hints (e.g., `import "@actions/tool-cache"`)
in their entry points. ncc resolves all imports statically from the library's
wrapper Live layer files.

---

## Live Layer Details

### Platform Wrapper Live Layers

Six thin `Layer.succeed` layers that wrap the `@actions/*` packages. Each one
imports the package at the module level (static import) and wraps the relevant
functions as a service value. They have no service dependencies.

- `ActionsCoreLive` -- `Layer.succeed(ActionsCore, core)` where `core` is the
  entire `@actions/core` module import
- `ActionsGitHubLive` -- `Layer.succeed(ActionsGitHub, { getOctokit })`
- `ActionsCacheLive` -- `Layer.succeed(ActionsCache, { saveCache, restoreCache })`
- `ActionsExecLive` -- `Layer.succeed(ActionsExec, { exec })`
- `ActionsToolCacheLive` -- `Layer.succeed(ActionsToolCache, { find, downloadTool,
  extractTar, extractZip, cacheDir })`
- `OctokitAuthAppLive` -- `Layer.succeed(OctokitAuthApp, { createAppAuth })`

### ActionLoggerLive

`Layer.Layer<ActionLogger, never, ActionsCore>`. Uses `Layer.effect` and
yields `ActionsCore`. The `core` reference is closed over during layer
construction; all log routing (`core.info`, `core.debug`, `core.warning`,
`core.error`) uses this closed-over reference. Buffer management is also
closed over `core`.

### ActionLoggerLayer

`Layer.Layer<never, never, ActionsCore>`. Uses `Layer.unwrapEffect` to read
`ActionsCore` from context, then wraps `Logger.replace(Logger.defaultLogger,
makeActionLogger(core))`. This is the Effect Logger integration (not the
ActionLogger service). Requires `ActionsCore` in context.

### GitHubClientLive

`GitHubClientLive(token: string)` -- a function (not a constant) returning
`Layer.Layer<GitHubClient, GitHubClientError, ActionsGitHub>`. Uses
`Layer.effect` to yield `ActionsGitHub`, then calls `gh.getOctokit(token)`.
REST calls use `Effect.tryPromise`, GraphQL calls use `octokit.graphql()`.
Pagination handles page incrementing and empty-page termination. Error mapping
extracts HTTP status and sets the `retryable` flag accordingly.

### GitHubAppLive

`Layer.Layer<GitHubApp, never, OctokitAuthApp>`. Uses `Layer.effect` to yield
`OctokitAuthApp`, then uses `authApp.createAppAuth(...)` for JWT-based
installation token generation/revocation.

### CommandRunnerLive

`Layer.Layer<CommandRunner, never, ActionsExec>`. Uses `Layer.effect` to
yield `ActionsExec`. Adds stdout/stderr buffer listeners to capture output.

### ToolInstallerLive

`Layer.Layer<ToolInstaller, never, ActionsCore | ActionsToolCache>`. Uses
`Layer.effect` to yield both `ActionsCore` (for `addPath`) and
`ActionsToolCache` (for `find`, `downloadTool`, `extractTar`, etc.).

### ActionCacheLive

`Layer.Layer<ActionCache, never, ActionsCache>`. Uses `Layer.effect` to yield
`ActionsCache`. Wraps `saveCache`/`restoreCache` in `Effect.tryPromise`.

### CheckRunLive

`Layer.Layer<CheckRun, never, GitHubClient>`. Annotations capped at 50 per
API call.

### PullRequestCommentLive

`Layer.Layer<PullRequestComment, never, GitHubClient>`. Uses the GitHub
Issues API. Marker pattern uses `<!-- savvy-web:KEY -->` HTML comments.

### GitHubGraphQLLive

`Layer.Layer<GitHubGraphQL, never, GitHubClient>`. Delegates to
`GitHubClient.graphql()` with structured error mapping to
`GitHubGraphQLError`.

### GitHubReleaseLive

`Layer.Layer<GitHubRelease, never, GitHubClient>`. Uses REST API for CRUD
operations and `paginate` for listing.

### GitHubIssueLive

`Layer.Layer<GitHubIssue, never, GitHubClient>`. Uses REST for list/close/
comment and depends on `GitHubGraphQL` for `getLinkedIssues`.

### GitTagLive

`Layer.Layer<GitTag, never, GitHubClient>`. Uses Git refs API for tag CRUD.

### GitBranchLive

`Layer.Layer<GitBranch, never, GitHubClient>`. Uses Git refs API for branch
management.

### GitCommitLive

`Layer.Layer<GitCommit, never, GitHubClient>`. Uses Git Data API for tree/
commit creation and ref updates.

### RateLimiterLive

`Layer.Layer<RateLimiter, never, GitHubClient>`. Checks rate limit endpoints
and provides guard/retry patterns.

### WorkflowDispatchLive

`Layer.Layer<WorkflowDispatch, never, GitHubClient>`. Uses Actions API for
workflow dispatch and run status polling.

### PackagePublishLive

`Layer.Layer<PackagePublish, never, CommandRunner | NpmRegistry | FileSystem>`.
Orchestrates `.npmrc` writing, `npm pack`, `npm publish`, and integrity
verification across multiple registries.

### TokenPermissionCheckerLive

`Layer.Layer<TokenPermissionChecker, never, GitHubApp>`. Reads granted
permissions from the `InstallationToken.permissions` field and compares
against requirements using hierarchical level comparison.

### OtelExporterLive

Takes resolved `ResolvedOtelConfig`. When `enabled=false`, returns
`InMemoryTracer.layer`. When `enabled=true`, uses a static import of
`@effect/opentelemetry` to configure `EffectOtel.Tracer.layerGlobal` with
GitHub-aware resource attributes from `GitHubOtelAttributes.fromEnvironment()`.
OTel packages are regular dependencies (not optional peers), so static
imports work reliably in ncc bundles.

### OtelTelemetryLive

Bridges Effect's `Tracer` to `@effect/opentelemetry` via a static import.
When provided, replaces InMemoryTracer with an OTel-backed tracer. Accepts
optional `OtelConfig` with `serviceName`, `serviceVersion`, and
`resourceAttributes`.

### InMemoryTracer

`InMemoryTracer.layer` -- captures all `Effect.withSpan` spans in memory.
`InMemoryTracer.getSpans()` retrieves completed spans for rendering via
`TelemetryReport`. Each `provide(InMemoryTracer.layer)` creates an isolated
store.

---

## Test Layer Details

Test layers use the namespace object pattern for ergonomic test setup:

**Core:**

- `ActionInputsTest` -- constructed from `Record<string, string>`
- `ActionLoggerTest.empty()` / `ActionLoggerTest.layer(state)`
- `ActionOutputsTest.empty()` / `ActionOutputsTest.layer(state)`
- `ActionStateTest.empty()` / `ActionStateTest.layer(state)`
- `ActionEnvironmentTest.layer(env)` -- reads from provided record
- `ActionCacheTest.empty()` / `ActionCacheTest.layer(cache)`

**Git:**

- `GitBranchTest.empty()` / `GitBranchTest.layer(state)`
- `GitCommitTest.empty()` / `GitCommitTest.layer(state)`
- `GitTagTest.empty()` / `GitTagTest.layer(state)`

**GitHub API:**

- `GitHubClientTest.empty()` / `GitHubClientTest.layer(state)` -- default
  test repo `{ owner: "test-owner", repo: "test-repo" }`
- `GitHubGraphQLTest.empty()` / `GitHubGraphQLTest.layer(state)`
- `GitHubReleaseLive` / `GitHubReleaseTest.empty()` / `GitHubReleaseTest.layer(state)`
- `GitHubIssueTest.empty()` / `GitHubIssueTest.layer(state)`
- `GitHubAppTest.empty()` / `GitHubAppTest.layer(state)`
- `CheckRunTest.empty()` / `CheckRunTest.layer(state)` -- resets ID counter
- `PullRequestCommentTest.empty()` / `PullRequestCommentTest.layer(state)`
- `RateLimiterTest.empty()` / `RateLimiterTest.layer(state)`
- `WorkflowDispatchTest.empty()` / `WorkflowDispatchTest.layer(state)`

**Build Tooling:**

- `CommandRunnerTest.empty()` / `CommandRunnerTest.layer(responses)`
- `NpmRegistryTest.empty()` / `NpmRegistryTest.layer(state)`
- `PackagePublishTest.empty()` / `PackagePublishTest.layer(state)`
- `PackageManagerAdapterTest.empty()` / `PackageManagerAdapterTest.layer(state)`
- `WorkspaceDetectorTest.empty()` / `WorkspaceDetectorTest.layer(state)`
- `ToolInstallerTest.empty()` / `ToolInstallerTest.layer(state)`
- `ChangesetAnalyzerTest.empty()` / `ChangesetAnalyzerTest.layer(state)`
- `ConfigLoaderTest.empty()` / `ConfigLoaderTest.layer(state)`
- `DryRunTest.empty()` / `DryRunTest.layer(state)` -- always dry, records guarded labels

**Observability:**

- `ActionTelemetryTest.empty()` / `ActionTelemetryTest.layer(state)`

Test layers for services like CheckRun, PullRequestComment, GitBranch, etc.
do NOT depend on GitHubClient -- they operate entirely in-memory.

---

## Service Dependency Graph

```text
Tier 0 — Platform wrappers (no service dependencies, import @actions/* directly):
  ActionsCore, ActionsGitHub, ActionsCache, ActionsExec,
  ActionsToolCache, OctokitAuthApp

Tier 1 — Depends on platform wrappers:
  ActionInputs              <- depends on ActionsCore
  ActionLogger              <- depends on ActionsCore
  ActionOutputs             <- depends on ActionsCore
  ActionState               <- depends on ActionsCore
  ActionCache               <- depends on ActionsCache
  CommandRunner             <- depends on ActionsExec
  GitHubClient(token)       <- depends on ActionsGitHub
  GitHubApp                 <- depends on OctokitAuthApp
  ToolInstaller             <- depends on ActionsCore + ActionsToolCache

Tier 1 — Independent (no service or platform dependencies):
  ActionEnvironment, DryRun, ActionTelemetry,
  GithubMarkdown, SemverResolver, ErrorAccumulator, GitHubOtelAttributes,
  ReportBuilder, TelemetryReport

Tier 2 — Single service dependency:
  NpmRegistry               <- depends on CommandRunner
  ChangesetAnalyzer         <- depends on FileSystem
  ConfigLoader              <- depends on FileSystem
  TokenPermissionChecker    <- depends on GitHubApp

Tier 3 — GitHubClient dependents:
  GitHubGraphQL             <- depends on GitHubClient
  GitBranch                 <- depends on GitHubClient
  GitCommit                 <- depends on GitHubClient
  GitTag                    <- depends on GitHubClient
  GitHubRelease             <- depends on GitHubClient
  CheckRun                  <- depends on GitHubClient
  PullRequestComment        <- depends on GitHubClient
  RateLimiter               <- depends on GitHubClient
  WorkflowDispatch          <- depends on GitHubClient
  GitHubIssue               <- depends on GitHubClient + GitHubGraphQL
  PackageManagerAdapter     <- depends on CommandRunner + FileSystem
  WorkspaceDetector         <- depends on FileSystem + CommandRunner

Tier 4 — Composed dependencies:
  PackagePublish            <- depends on CommandRunner + NpmRegistry + FileSystem
  AutoMerge (utility)       <- depends on GitHubGraphQL
```

---

## Layer Composition Example

Users compose layers as needed. `Action.run()` handles providing the core
layers (ActionInputsLive, ActionLoggerLive, ActionOutputsLive,
NodeContext.layer) backed by the platform layer. Extra layers are passed via
the `layer` option:

```typescript
import {
  Action,
  ActionsPlatformLive,
  GitHubClientLive,
  CheckRunLive,
} from "@savvy-web/github-action-effects"

// Action.run() provides ActionsCoreLive by default.
// Pass ActionsPlatformLive to also provide ActionsGitHub (needed by GitHubClientLive).
Action.run(program, {
  platform: ActionsPlatformLive,
  layer: Layer.mergeAll(
    CheckRunLive,
    GitHubClientLive(token),
  ),
})
```

For manual layer composition outside `Action.run()`:

```typescript
import { ActionInputsLive, ActionLoggerLive, GitHubClientLive, CheckRunLive,
  ActionsCoreLive, ActionsGitHubLive }
  from "@savvy-web/github-action-effects"

const PlatformLayer = Layer.mergeAll(ActionsCoreLive, ActionsGitHubLive)

const MyActionLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionLoggerLive,
  CheckRunLive,
  GitHubClientLive(token),
).pipe(Layer.provide(PlatformLayer))
```

---

## Current State

All 30 domain services have both live and test layer implementations. The 6
platform wrapper services have only live layers. The four-tier dependency graph
is stable, and layer composition patterns are well-established with `Action.run()`
providing the core layers automatically. All `@actions/*` package imports are
isolated in the 6 platform wrapper Live layers.

## Rationale

Separating live and test layers allows services to be tested entirely in-memory
without touching real GitHub APIs or `@actions/core`. The namespace object
pattern for test layers (`.empty()` / `.layer(state)`) provides ergonomic setup
while remaining api-extractor compatible.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interface descriptions
- [testing-strategy.md](./testing-strategy.md) -- Testing approach using test layers
