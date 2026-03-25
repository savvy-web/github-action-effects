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
service has a `Live` layer and a `Test` layer backed by in-memory state for
unit testing. All `@actions/*` packages have been removed. The runtime layer
(`src/runtime/`) provides native implementations of the GitHub Actions
protocol. Three Live layers import external packages directly:
`GitHubClientLive` imports `@octokit/rest`, `OctokitAuthAppLive` imports
`@octokit/auth-app`, and `ActionCacheLive` imports `@azure/storage-blob`.

---

## Layer Composition

```text
Runtime Layer (src/runtime/ — replaces @actions/*):
  ActionsConfigProvider    — ConfigProvider reading INPUT_* env vars
  ActionsLogger            — Effect Logger emitting workflow commands
  WorkflowCommand          — ::command:: protocol formatter (pure functions)
  RuntimeFile              — env file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
  ActionsRuntime.Default   — Layer.mergeAll of ConfigProvider, Logger,
                             ActionLoggerLive, ActionOutputsLive, ActionStateLive,
                             ActionEnvironmentLive, NodeFileSystem.layer

Core Action I/O:
  ActionLoggerLive         — Layer.succeed; uses WorkflowCommand for group markers,
                             Effect Logger API for buffering. No service dependencies.
  ActionLoggerTest         — captures log entries in memory

  ActionOutputsLive        — Layer.effect depending on FileSystem; uses RuntimeFile
                             for GITHUB_OUTPUT/GITHUB_ENV/GITHUB_PATH and
                             WorkflowCommand for setFailed/setSecret
  ActionOutputsTest        — captures outputs in memory

  ActionStateLive          — Layer.effect depending on FileSystem; uses RuntimeFile
                             for GITHUB_STATE, reads STATE_* env vars. Schema encode/decode
  ActionStateTest          — in-memory Map<string, string>, pre-populatable for phase simulation

  ActionEnvironmentLive    — Layer.succeed; reads from process.env, lazy context construction
  ActionEnvironmentTest    — reads from provided Record<string, string>

  ActionCacheLive          — Layer.succeed; uses V2 Twirp RPC protocol with
                             ACTIONS_RESULTS_URL + ACTIONS_RUNTIME_TOKEN.
                             Creates tar.gz archives via execFileSync("tar") with -P
                             (absolute-names) to preserve absolute paths. Windows
                             extract uses -k to skip locked files.
                             Uses @azure/storage-blob for Azure Blob upload/download.
  ActionCacheTest           — in-memory Map for cache simulation (always-miss when empty)

Git Operations:
  GitBranchLive            — Layer.effect depending on GitHubClient
  GitBranchTest            — in-memory branch state Map<name, sha>

  GitCommitLive            — Layer.effect depending on GitHubClient
  GitCommitTest            — in-memory tree/commit/ref state

  GitTagLive               — Layer.effect depending on GitHubClient
  GitTagTest               — in-memory tag state Map<tag, sha>

GitHub API:
  GitHubClientLive         — Layer.effect; reads GITHUB_TOKEN from process.env,
                             creates Octokit instance directly from @octokit/rest.
                             Self-contained Layer (not a factory function).
  GitHubClientTest         — Map-based recorded REST/GraphQL responses; default test repo

  GitHubGraphQLLive        — Layer.effect depending on GitHubClient
  GitHubGraphQLTest        — recorded query/mutation responses

  GitHubReleaseLive        — Layer.effect depending on GitHubClient
  GitHubReleaseTest        — in-memory release state

  GitHubIssueLive          — Layer.effect depending on GitHubClient (+ GitHubGraphQL for linked issues)
  GitHubIssueTest          — in-memory issue state

  GitHubAppLive            — Layer.effect depending on OctokitAuthApp; uses native fetch
                             for installation resolution and token revocation
  GitHubAppTest            — in-memory token state

  OctokitAuthAppLive       — Layer.succeed; imports @octokit/auth-app directly
                             (one of only two layers importing external packages)

  CheckRunLive             — Layer.effect depending on GitHubClient; caps annotations at 50
  CheckRunTest             — in-memory CheckRunRecord array; resets ID counter on .empty()

  PullRequestLive          — Layer.effect depending on GitHubClient + GitHubGraphQL
  PullRequestTest          — in-memory PR state with CRUD, merge, labels, reviewers

  PullRequestCommentLive   — Layer.effect depending on GitHubClient; uses Issues API
  PullRequestCommentTest   — in-memory Map<prNumber, comments[]>; instance-scoped nextId

  RateLimiterLive          — Layer.effect depending on GitHubClient
  RateLimiterTest          — configurable rate limit state

  WorkflowDispatchLive     — Layer.effect depending on GitHubClient
  WorkflowDispatchTest     — in-memory dispatch records

Build Tooling:
  CommandRunnerLive        — Layer.succeed; uses node:child_process spawn directly.
                             No service dependencies.
  CommandRunnerTest        — Map<string, { exitCode, stdout, stderr }> keyed by command string

  NpmRegistryLive          — depends on CommandRunner; runs npm view --json
  NpmRegistryTest          — in-memory package metadata

  PackagePublishLive       — depends on CommandRunner + NpmRegistry + FileSystem
  PackagePublishTest       — in-memory publish state

  PackageManagerAdapterLive — depends on CommandRunner + FileSystem
  PackageManagerAdapterTest — in-memory PM state

  WorkspaceDetectorLive    — depends on FileSystem + CommandRunner
  WorkspaceDetectorTest    — in-memory workspace state

  ToolInstallerLive        — Layer.succeed; uses node:https/node:http for downloads
                             (with redirect following, socket timeout, and exponential
                             backoff retry), node:child_process spawn for tar/unzip
                             extraction (PowerShell on Windows for zip),
                             node:fs/promises for caching. Reads RUNNER_TOOL_CACHE
                             env var. No service dependencies.
  ToolInstallerTest        — in-memory tool cache state

  ChangesetAnalyzerLive    — depends on FileSystem
  ChangesetAnalyzerTest    — in-memory changeset state

  ConfigLoaderLive         — depends on FileSystem
  ConfigLoaderTest         — in-memory config file state

  DryRunLive               — reads enabled flag from constructor param
  DryRunTest               — always dry, records guarded labels in state

  TokenPermissionCheckerLive — depends on GitHubApp
  TokenPermissionCheckerTest — in-memory permission state

Platform:
  NodeFileSystem.layer     — @effect/platform-node: FileSystem
                             (provided by ActionsRuntime.Default)
```

---

## Import Pattern

Three Live layers import external packages directly:

- `GitHubClientLive` -- `import { Octokit } from "@octokit/rest"`
- `OctokitAuthAppLive` -- `import { createAppAuth } from "@octokit/auth-app"`
- `ActionCacheLive` -- `import { BlobClient, BlockBlobClient } from "@azure/storage-blob"`

All other Live layers either have no external imports or depend on Effect
services via `Layer.effect` and `yield*`. The runtime layer modules
(`WorkflowCommand`, `RuntimeFile`, `ActionsConfigProvider`, `ActionsLogger`)
use only Node.js built-ins and Effect APIs.

Several Live layers use `Layer.succeed` (no dependencies) because they
interact directly with process environment, stdout, or Node.js built-ins:

- `ActionLoggerLive` -- uses `WorkflowCommand` and Effect Logger API
- `ActionEnvironmentLive` -- reads from `process.env`
- `CommandRunnerLive` -- uses `node:child_process` spawn
- `ToolInstallerLive` -- uses `node:https`/`node:http` + `node:child_process` + `node:fs/promises`
- `ActionCacheLive` -- uses V2 Twirp RPC + `@azure/storage-blob` + `node:child_process` execFileSync

---

## Live Layer Details

### ActionsRuntime.Default

`Layer.Layer<ActionLogger | ActionOutputs | ActionState | ActionEnvironment>`.
Composes `Layer.mergeAll` of:

- `Layer.setConfigProvider(ActionsConfigProvider)` -- inputs via `Config.*`
- `Logger.replace(Logger.defaultLogger, ActionsLogger)` -- Effect Logger
- `ActionEnvironmentLive`
- `ActionLoggerLive`
- `ActionOutputsLive`
- `ActionStateLive`

Then pipes through `Layer.provideMerge(NodeFileSystem.layer)` to satisfy the
`FileSystem` dependency of `ActionOutputsLive` and `ActionStateLive`.

### ActionLoggerLive

`Layer.Layer<ActionLogger>`. No service dependencies. Uses `WorkflowCommand`
for `::group::` / `::endgroup::` markers. Buffer management uses Effect's
`Logger.replace` to install a buffering logger scoped to the effect.

### ActionOutputsLive

`Layer.Layer<ActionOutputs, never, FileSystem>`. Uses `RuntimeFile.append`
for `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH` file operations. Uses
`WorkflowCommand.issue` for `setFailed` (`::error::`) and `setSecret`
(`::add-mask::`). Reads `GITHUB_STEP_SUMMARY` env var for summary writes.

### ActionStateLive

`Layer.Layer<ActionState, never, FileSystem>`. Uses `RuntimeFile.append`
for `GITHUB_STATE` file writes. Reads `STATE_*` env vars for state retrieval.
Schema encode/decode via shared `decodeState`/`encodeState` helpers.

### ActionCacheLive

`Layer.Layer<ActionCache>`. No service dependencies. Reads `ACTIONS_RESULTS_URL`
and `ACTIONS_RUNTIME_TOKEN` from environment. Uses `execFileSync("tar")` for
archive creation/extraction with `-P` (absolute-names) flag to preserve leading
`/` on absolute paths — create uses `czPf`, extract uses `xzPf` (Linux/macOS) or
`xzPkf` (Windows, with `-k` to skip locked files). Tolerates tar exit code 1
(non-fatal warnings) but fails on exit code 2+. V2 Twirp RPC protocol:
`CreateCacheEntry` to reserve, Azure Blob `BlockBlobClient.uploadFile()` for
upload (64 MB chunks, 8 concurrent), `FinalizeCacheEntryUpload` to commit.
Restore uses `GetCacheEntryDownloadURL` then Azure Blob
`BlobClient.downloadToFile()`. Version hash:
`sha256(paths.join("|") + "|gzip|1.0")`. Exponential backoff retry (3s base,
1.5x, 5 attempts) on 5xx and network errors for Twirp calls; Azure SDK handles
its own retries internally.

### GitHubClientLive

`Layer.Layer<GitHubClient, GitHubClientError>`. Self-contained layer that
reads `GITHUB_TOKEN` from `process.env` and creates an `Octokit` instance
from `@octokit/rest`. REST calls use `Effect.tryPromise`, GraphQL uses
`octokit.graphql()`. Pagination handles page incrementing and empty-page
termination. Error mapping extracts HTTP status and sets the `retryable`
flag for 429/5xx. Detects HTML error pages (GitHub "Unicorn" pages).

### GitHubAppLive

`Layer.Layer<GitHubApp, never, OctokitAuthApp>`. Uses `Layer.effect` to yield
`OctokitAuthApp` for JWT-based auth. Uses native `fetch` for listing
installations and resolving installation IDs from `GITHUB_REPOSITORY`.
Token revocation also uses native `fetch`.

### OctokitAuthAppLive

`Layer.Layer<OctokitAuthApp>`. No service dependencies. Wraps the
`createAppAuth` function from `@octokit/auth-app` as a service value.

### CommandRunnerLive

`Layer.Layer<CommandRunner>`. No service dependencies. Uses `node:child_process`
`spawn` directly for all command execution. Captures stdout/stderr via pipe
listeners. Supports `streaming` option to forward output to
`process.stdout`/`process.stderr` in real-time while still capturing. On Windows,
uses `shell: true` to resolve `.cmd`/`.bat` files, with `escapeWindowsArg()`
applied to all arguments to prevent cmd.exe metacharacter injection (wraps in
double quotes, escapes internal `"`). Documented limitation: `%VAR%` expansion
still occurs inside double quotes in cmd.exe.

### ToolInstallerLive

`Layer.Layer<ToolInstaller>`. No service dependencies. Uses `node:https`/`node:http`
for downloads (streaming to temp files via `node:stream/promises` pipeline) with
redirect following (up to 10 hops), 3-minute socket timeout, User-Agent header,
and `Effect.retry` with exponential backoff for transient errors (5xx, 408, 429,
socket timeout, network errors). Best-effort cleanup of partial downloads on failure.
Uses `node:child_process` `spawn` for extraction: `tar` for tar archives, `unzip`
on non-Windows for zip, PowerShell `System.IO.Compression.ZipFile` on Windows (pwsh
→ powershell fallback). Uses `node:fs/promises` for cache directory management. Tool
cache path is `RUNNER_TOOL_CACHE` env var with fallback to `os.tmpdir()`.

### CheckRunLive

`Layer.Layer<CheckRun, never, GitHubClient>`. Annotations capped at 50 per
API call.

### PullRequestLive

`Layer.Layer<PullRequest, never, GitHubClient | GitHubGraphQL>`. Uses REST
API for PR CRUD, merge, labels, and reviewer operations. Delegates auto-merge
to `GitHubGraphQL` via `AutoMerge` utility.

### PullRequestCommentLive

`Layer.Layer<PullRequestComment, never, GitHubClient>`. Uses the GitHub
Issues API. Marker pattern uses `<!-- savvy-web:KEY -->` HTML comments.

### Other Live Layers

- `GitHubGraphQLLive` -- `Layer<GitHubGraphQL, never, GitHubClient>`
- `GitHubReleaseLive` -- `Layer<GitHubRelease, never, GitHubClient>`
- `GitHubIssueLive` -- `Layer<GitHubIssue, never, GitHubClient>`
- `GitTagLive` -- `Layer<GitTag, never, GitHubClient>`
- `GitBranchLive` -- `Layer<GitBranch, never, GitHubClient>`
- `GitCommitLive` -- `Layer<GitCommit, never, GitHubClient>`
- `RateLimiterLive` -- `Layer<RateLimiter, never, GitHubClient>`
- `WorkflowDispatchLive` -- `Layer<WorkflowDispatch, never, GitHubClient>`
- `PackagePublishLive` -- `Layer<PackagePublish, never, CommandRunner | NpmRegistry | FileSystem>`
- `TokenPermissionCheckerLive` -- `Layer<TokenPermissionChecker, never, GitHubApp>`

---

## Test Layer Details

Test layers use the namespace object pattern for ergonomic test setup:

**Core:**

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
- `GitHubReleaseTest.empty()` / `GitHubReleaseTest.layer(state)`
- `GitHubIssueTest.empty()` / `GitHubIssueTest.layer(state)`
- `GitHubAppTest.empty()` / `GitHubAppTest.layer(state)`
- `CheckRunTest.empty()` / `CheckRunTest.layer(state)` -- resets ID counter
- `PullRequestTest.empty()` / `PullRequestTest.layer(state)`
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
- `TokenPermissionCheckerTest.empty()` / `TokenPermissionCheckerTest.layer(state)`

Test layers for services like CheckRun, PullRequestComment, GitBranch, etc.
do NOT depend on GitHubClient -- they operate entirely in-memory.

---

## Service Dependency Graph

```text
Tier 0 — No service dependencies (use Node.js built-ins / native APIs directly):
  ActionLogger, ActionEnvironment, CommandRunner,
  ToolInstaller, DryRun,
  GithubMarkdown, SemverResolver, ErrorAccumulator, ReportBuilder

Tier 0 — External package import (no service dependencies):
  OctokitAuthApp            <- imports @octokit/auth-app
  GitHubClient              <- imports @octokit/rest, reads GITHUB_TOKEN from env
  ActionCache               <- imports @azure/storage-blob, reads ACTIONS_RESULTS_URL from env

Tier 0.5 — Depends on FileSystem (from @effect/platform):
  ActionOutputs             <- depends on FileSystem
  ActionState               <- depends on FileSystem

Tier 1 — Single service dependency:
  GitHubApp                 <- depends on OctokitAuthApp
  NpmRegistry               <- depends on CommandRunner
  ChangesetAnalyzer         <- depends on FileSystem
  ConfigLoader              <- depends on FileSystem
  TokenPermissionChecker    <- depends on GitHubApp

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
  PullRequest               <- depends on GitHubClient + GitHubGraphQL

Tier 2 — Multi-service (non-GitHubClient):
  PackageManagerAdapter     <- depends on CommandRunner + FileSystem
  WorkspaceDetector         <- depends on FileSystem + CommandRunner

Tier 3 — Composed dependencies:
  PackagePublish            <- depends on CommandRunner + NpmRegistry + FileSystem
  AutoMerge (utility)       <- depends on GitHubGraphQL
```

---

## Layer Composition Example

Users compose layers as needed. `Action.run()` provides
`ActionsRuntime.Default` automatically. Extra layers are passed via the
`layer` option:

```typescript
import { Action, GitHubClientLive, CheckRunLive }
  from "@savvy-web/github-action-effects"

Action.run(program, {
  layer: Layer.mergeAll(
    CheckRunLive,
    GitHubClientLive,
  ),
})
```

For manual layer composition outside `Action.run()`:

```typescript
import { ActionsRuntime, GitHubClientLive, CheckRunLive }
  from "@savvy-web/github-action-effects"

const MyActionLayer = Layer.mergeAll(
  ActionsRuntime.Default,
  CheckRunLive,
).pipe(Layer.provideMerge(GitHubClientLive))
```

---

## Current State

All 29 services have both live and test layer implementations. The runtime
layer provides native implementations of the GitHub Actions protocol. The
dependency graph is simplified from the previous architecture (no platform
wrapper tier). Many Live layers now have zero service dependencies since
they use Node.js built-ins directly.

## Rationale

Separating live and test layers allows services to be tested entirely in-memory
without touching real GitHub APIs or workflow commands. The namespace object
pattern for test layers (`.empty()` / `.layer(state)`) provides ergonomic setup
while remaining api-extractor compatible. Removing the `@actions/*` wrapper
layer tier simplified the dependency graph significantly.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interface descriptions
- [testing-strategy.md](./testing-strategy.md) -- Testing approach using test layers
