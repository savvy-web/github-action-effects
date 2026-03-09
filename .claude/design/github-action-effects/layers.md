---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-09
last-synced: 2026-03-09
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

This document describes the layer architecture for all services. Each service
has a `Live` layer backed by real platform calls (e.g., `@actions/core`,
`@actions/github`) and a `Test` layer backed by in-memory state for unit
testing. The document also covers the service dependency graph and layer
composition patterns.

---

## Layer Composition

Each service has a `Live` layer backed by real platform calls and a `Test`
layer backed by in-memory state for unit testing.

```text
Core Action I/O:
  ActionInputsLive       — reads from @actions/core.getInput (deferred via Effect.sync)
  ActionInputsTest       — reads from provided Record<string, string>
    (both share decodeInput/decodeJsonInput from layers/internal/decodeInput.ts)

  ActionLoggerLive       — routes to @actions/core log functions
  ActionLoggerTest       — captures log entries in memory (annotations include type field)

  ActionOutputsLive      — writes to @actions/core outputs
  ActionOutputsTest      — captures outputs in memory

  ActionStateLive        — wraps core.saveState()/core.getState() with Schema encode/decode
  ActionStateTest        — in-memory Map<string, string>, pre-populatable for phase simulation

  ActionEnvironmentLive  — reads from process.env, lazy GitHub/Runner context construction
  ActionEnvironmentTest  — reads from provided Record<string, string>

  ActionCacheLive        — wraps @actions/cache.saveCache()/restoreCache() (deferred via Effect.tryPromise)
  ActionCacheTest        — in-memory Map for cache simulation (always-miss when empty)

Git Operations:
  GitBranchLive          — Layer.effect depending on GitHubClient
  GitBranchTest          — in-memory branch state Map<name, sha>

  GitCommitLive          — Layer.effect depending on GitHubClient
  GitCommitTest          — in-memory tree/commit/ref state

  GitTagLive             — Layer.effect depending on GitHubClient
  GitTagTest             — in-memory tag state Map<tag, sha>

GitHub API:
  GitHubClientLive(token)  — function returning Layer; wraps @actions/github.getOctokit(token)
  GitHubClientTest         — Map-based recorded REST/GraphQL responses; default test repo

  GitHubGraphQLLive      — Layer.effect depending on GitHubClient
  GitHubGraphQLTest      — recorded query/mutation responses

  GitHubReleaseLive      — Layer.effect depending on GitHubClient
  GitHubReleaseTest      — in-memory release state

  GitHubIssueLive        — Layer.effect depending on GitHubClient (+ GitHubGraphQL for linked issues)
  GitHubIssueTest        — in-memory issue state

  GitHubAppLive          — wraps @octokit/auth-app for token generation
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
  CommandRunnerLive      — wraps @actions/exec.exec() with stdout/stderr listeners
  CommandRunnerTest      — Map<string, { exitCode, stdout, stderr }> keyed by command string

  NpmRegistryLive        — depends on CommandRunner; runs npm view --json
  NpmRegistryTest        — in-memory package metadata

  PackagePublishLive     — depends on CommandRunner + NpmRegistry + FileSystem
  PackagePublishTest     — in-memory publish state

  PackageManagerAdapterLive — depends on CommandRunner + FileSystem
  PackageManagerAdapterTest — in-memory PM state

  WorkspaceDetectorLive  — depends on FileSystem + CommandRunner
  WorkspaceDetectorTest  — in-memory workspace state

  ToolInstallerLive      — wraps @actions/tool-cache
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
  OtelTelemetryLive      — bridges Effect tracer to OpenTelemetry (optional peer dep)
  OtelExporterLive       — dynamically imports OTLP exporters based on protocol config

Platform:
  NodeContext.layer      — @effect/platform-node: FileSystem, Path, Terminal,
                           CommandExecutor, WorkerManager (provided by Action.run)

Action Helpers:
  Action.parseInputs     — inlined in Action.ts, reads all inputs from a config record
                           (depends on ActionInputs service, not bundled into Action.run)
```

---

## Live Layer Details

### GitHubClientLive

`GitHubClientLive(token: string)` -- a function (not a constant) returning
`Layer.Layer<GitHubClient>`. Creates an Octokit instance via
`@actions/github.getOctokit(token)`. REST calls use `Effect.tryPromise`,
GraphQL calls use `octokit.graphql()`. Pagination handles page incrementing
and empty-page termination. Error mapping extracts HTTP status and sets the
`retryable` flag accordingly.

### CheckRunLive

`Layer.Layer<CheckRun, never, GitHubClient>`. Created via `Layer.effect`
depending on `GitHubClient`. Annotations capped at 50 per API call.

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

### GitHubAppLive

`Layer.Layer<GitHubApp>`. Wraps `@octokit/auth-app` for JWT-based
installation token generation/revocation.

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

Takes resolved `OtelConfig`, dynamically imports OTLP exporter packages
based on protocol (`grpc`, `http/protobuf`, `http/json`), and creates trace
and metric exporters. Provides them as Effect layers. Falls back gracefully
with installation instructions if packages are missing.

### OtelTelemetryLive

Bridges Effect's `Tracer` to `@effect/opentelemetry`. When provided, replaces
InMemoryTracer with an OTel-backed tracer. Accepts optional
`resourceAttributes` for setting OTel resource attributes (e.g., from
`GitHubOtelAttributes.fromEnvironment()`).

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
Tier 0 — Independent (no service dependencies):
  ActionInputs, ActionLogger, ActionOutputs, ActionState,
  ActionEnvironment, ActionCache, CommandRunner, DryRun, ActionTelemetry,
  GithubMarkdown, SemverResolver, ErrorAccumulator, GitHubOtelAttributes,
  ReportBuilder, TelemetryReport

Tier 1 — Single dependency:
  GitHubClient(token)       <- standalone, wraps @actions/github
  NpmRegistry               <- depends on CommandRunner
  GitHubApp                 <- standalone, wraps @octokit/auth-app
  ChangesetAnalyzer         <- depends on FileSystem
  ConfigLoader              <- depends on FileSystem

Tier 2 — GitHubClient dependents:
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

Tier 2 — Multi-dependency:
  PackageManagerAdapter     <- depends on CommandRunner + FileSystem
  WorkspaceDetector         <- depends on FileSystem + CommandRunner
  ToolInstaller             <- depends on @actions/tool-cache

Tier 3 — Composed dependencies:
  PackagePublish            <- depends on CommandRunner + NpmRegistry + FileSystem
  TokenPermissionChecker    <- depends on GitHubApp
  AutoMerge                 <- depends on GitHubGraphQL
```

---

## Layer Composition Example

Users compose layers as needed:

```typescript
import { ActionInputsLive, ActionLoggerLive, GitHubClientLive, CheckRunLive }
  from "@savvy-web/github-action-effects"

const MyActionLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionLoggerLive,
  CheckRunLive,
).pipe(Layer.provide(GitHubClientLive(token)))
```

---

## Current State

All services have both live and test layer implementations. The three-tier
dependency graph is stable, and layer composition patterns are well-established
with `Action.run()` providing the core layers automatically.

## Rationale

Separating live and test layers allows services to be tested entirely in-memory
without touching real GitHub APIs or `@actions/core`. The namespace object
pattern for test layers (`.empty()` / `.layer(state)`) provides ergonomic setup
while remaining api-extractor compatible.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interface descriptions
- [testing-strategy.md](./testing-strategy.md) -- Testing approach using test layers
