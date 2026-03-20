# Replace @actions/\* Packages with Native ESM Implementations

**Date:** 2026-03-19
**Issue:** #51
**Release:** 0.11.0 (breaking)
**Branch:** `feat/custom-core`

## Summary

Replace all `@actions/*` packages (`core`, `exec`, `github`, `cache`,
`tool-cache`) with native ESM implementations built on Effect primitives and
the GitHub Actions runtime protocol. Promotes `@octokit/rest` and
`@octokit/auth-app` to direct dependencies. Adds `@effect/platform` and
`@effect/platform-node` as required peer dependencies.

This is a fully breaking release. All public service interfaces are
redesigned for idiomatic Effect usage. No backwards compatibility with 0.10.x.

## Goals

- Zero CJS dependencies in the entire package
- Idiomatic Effect developer experience (Config, Logger, Command, FileSystem)
- Clean tree-shaking with rslib
- Full control over implementation — no upstream blockers
- Single `ActionsRuntime.Default` layer as the primary consumer entry point

## Approach: Hybrid — Effect Primitives + Domain Services

Use Effect's standard abstractions where they naturally fit. Keep thin domain
services for GitHub-specific concepts that have no Effect analog.

## Effect Primitive Mappings

### Inputs via ConfigProvider

A custom `ConfigProvider` reads GitHub Actions inputs from environment
variables following the `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`
convention.

```typescript
const name = yield* Config.string("name")             // INPUT_NAME
const count = yield* Config.integer("retry-count")     // INPUT_RETRY-COUNT
const tags = yield* Config.array(Config.string("tags"), ",")
const debug = yield* Config.boolean("verbose")         // INPUT_VERBOSE
```

Behavior:

- Missing required inputs produce `ConfigError` (standard Effect error)
- Optional inputs use `Config.withDefault`
- Empty string inputs treated as missing (matches `@actions/core` behavior)
- No automatic trimming — consumers use `Config.map(String.trim)` if needed
- Hyphens in input names are preserved (not converted to underscores) —
  `retry-count` maps to `INPUT_RETRY-COUNT`, matching GitHub Actions behavior
- This is a flat `ConfigProvider` — `Config.nested` is not supported. All
  inputs are top-level keys. Nested config paths (e.g.,
  `Config.nested("db")(Config.string("url"))`) should not be used with this
  provider

### Logging via Custom Logger

A `Logger` implementation mapping Effect log levels to GitHub workflow
commands:

| Effect Level | GitHub Command |
| --- | --- |
| `Debug`, `Trace` | `::debug::message` |
| `Info` | Plain stdout (matches `core.info`) |
| `Warning` | `::warning::message` |
| `Error`, `Fatal` | `::error::message` |

The Logger reads annotation metadata from Effect's log annotations. When
`file`, `line`, or `col` annotations are present, the Logger emits workflow
commands with annotation properties:
`::error file=foo.ts,line=42::message`.

This replaces `ActionLogger`'s `annotationError`, `annotationWarning`, and
`annotationNotice` methods. Consumers use:

```typescript
Effect.logError("type mismatch").pipe(
  Effect.annotateLogs({ file: "foo.ts", line: "42", col: "5" }),
)
```

### ActionLogger Service (retained, reduced)

The Effect `Logger` replaces basic logging, but two capabilities have no
standard Effect equivalent and remain as a dedicated service:

```typescript
class ActionLogger extends Context.Tag("ActionLogger")<ActionLogger, {
  readonly group: <A, E, R>(
    name: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly withBuffer: <A, E, R>(
    label: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}>() {}
```

- `group` wraps effect execution with `::group::name` / `::endgroup::`
  workflow commands
- `withBuffer` buffers verbose logs during effect execution and flushes them
  only on failure — used for clean output in success paths

The `annotationError/Warning/Notice` methods are removed — replaced by
Effect log annotations (see Logger section above).

### Command Execution via @effect/platform

```typescript
import { Command } from "@effect/platform"

const result = yield* Command.make("npm", "publish", "--tag", "latest").pipe(
  Command.workingDirectory("/path"),
  Command.env({ NODE_AUTH_TOKEN: token }),
  Command.string,
)
```

Replaces both `@actions/exec` and the `ActionsExec` wrapper service.
`CommandRunner` is rewritten to use `@effect/platform` `Command` internally.

## Domain Services

### ActionOutputs

Writes to `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH`. Masks secrets.
Writes step summaries.

```typescript
class ActionOutputs extends Context.Tag("ActionOutputs")<ActionOutputs, {
  readonly set: (name: string, value: string) => Effect<void>
  readonly setJson: <A, I>(
    name: string,
    value: A,
    schema: Schema.Schema<A, I, never>,
  ) => Effect<void, ActionOutputError>
  readonly summary: (content: string) => Effect<void, ActionOutputError>
  readonly exportVariable: (name: string, value: string) => Effect<void>
  readonly addPath: (path: string) => Effect<void>
  readonly setFailed: (message: string) => Effect<void>
  readonly setSecret: (value: string) => Effect<void>
}>() {}
```

Live layer uses `@effect/platform-node` `FileSystem` for env file appending
and `WorkflowCommand` for stdout protocol. `setSecret` emits the
`::add-mask::value` workflow command (no key-value properties — the secret
value is the entire message field). `summary` appends markdown to the file at
`GITHUB_STEP_SUMMARY`.

Note: the separate `StepSummary` service from the brainstorming phase is
merged back into `ActionOutputs` to match the existing interface and avoid
unnecessary service proliferation.

### ActionState

Transfer state between action phases (main/post) via `GITHUB_STATE`.
Preserves schema-validated typed state from the existing interface.

```typescript
class ActionState extends Context.Tag("ActionState")<ActionState, {
  readonly save: <A, I>(
    key: string,
    value: A,
    schema: Schema.Schema<A, I, never>,
  ) => Effect<void, ActionStateError>
  readonly get: <A, I>(
    key: string,
    schema: Schema.Schema<A, I, never>,
  ) => Effect<A, ActionStateError>
  readonly getOptional: <A, I>(
    key: string,
    schema: Schema.Schema<A, I, never>,
  ) => Effect<Option<A>, ActionStateError>
}>() {}
```

Live layer serializes values via the provided schema, writes to
`GITHUB_STATE` file using `RuntimeFile`. `get` fails with `ActionStateError`
if the key is missing or fails schema decode. `getOptional` returns `None`
for missing keys.

### ActionEnvironment

Read-only typed accessors for GitHub/runner context (`GITHUB_REPOSITORY`,
`GITHUB_SHA`, `GITHUB_REF`, `RUNNER_OS`, etc.). Largely unchanged from
current implementation.

### ActionCache (rewritten)

The GitHub Actions cache system uses an internal protocol
(`ACTIONS_CACHE_URL` + `ACTIONS_RUNTIME_TOKEN`) for save/restore operations.
The public REST API only supports list and delete — it cannot upload cache
entries.

Strategy: reimplement the internal cache protocol using native `fetch`
instead of `@actions/http-client`. The protocol is discoverable from the
`@actions/cache` source:

- **Restore**: `GET` to `{ACTIONS_CACHE_URL}_apis/artifactcache/cache` with
  query params for keys and version
- **Save**: Reserve cache ID via `POST`, upload chunks via `PATCH` with
  `Content-Range` headers, commit via `POST`
- **Auth**: `Authorization: Bearer {ACTIONS_RUNTIME_TOKEN}` header

```typescript
class ActionCache extends Context.Tag("ActionCache")<ActionCache, {
  readonly save: (
    paths: ReadonlyArray<string>,
    key: string,
  ) => Effect<void, CacheError>
  readonly restore: (
    paths: ReadonlyArray<string>,
    primaryKey: string,
    restoreKeys?: ReadonlyArray<string>,
  ) => Effect<Option<string>, CacheError>
}>() {}
```

Live layer implements the internal protocol with native `fetch`. Chunked
uploads are included from the start — the protocol requires them for entries
over 32MB. Archive creation uses `tar` via `@effect/platform` `Command`.

### ToolInstaller

Download, extract, and cache tool binaries. Replaces `@actions/tool-cache`.

```typescript
class ToolInstaller extends Context.Tag("ToolInstaller")<ToolInstaller, {
  readonly find: (tool: string, version: string) => Effect<Option<string>>
  readonly download: (url: string) => Effect<string, ToolInstallError>
  readonly extractTar: (
    file: string,
    dest?: string,
    flags?: ReadonlyArray<string>,
  ) => Effect<string, ToolInstallError>
  readonly extractZip: (
    file: string,
    dest?: string,
  ) => Effect<string, ToolInstallError>
  readonly cacheDir: (
    sourceDir: string,
    tool: string,
    version: string,
  ) => Effect<string, ToolInstallError>
  readonly cacheFile: (
    sourceFile: string,
    targetFile: string,
    tool: string,
    version: string,
  ) => Effect<string, ToolInstallError>
}>() {}
```

Live layer uses native `fetch` for downloads, `@effect/platform` `Command`
for `tar`/`unzip`, `FileSystem` for cache directory management at
`RUNNER_TOOL_CACHE`.

### GitHubClient (updated)

Promote `@octokit/rest` to direct dependency. Drop `@actions/github`.
Preserve the existing interface shape that all 12+ higher-level services
depend on.

```typescript
class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, {
  readonly rest: <T>(
    operation: string,
    fn: (octokit: unknown) => Promise<{ data: T }>,
  ) => Effect<T, GitHubClientError>
  readonly graphql: <T>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Effect<T, GitHubClientError>
  readonly paginate: <T>(
    operation: string,
    fn: (
      octokit: unknown,
      page: number,
      perPage: number,
    ) => Promise<{ data: T[] }>,
    options?: { perPage?: number; maxPages?: number },
  ) => Effect<Array<T>, GitHubClientError>
  readonly repo: Effect<{ owner: string; repo: string }, GitHubClientError>
}>() {}
```

The interface is unchanged. Only the Live layer changes — it creates Octokit
directly from `@octokit/rest` + `GITHUB_TOKEN` instead of going through
`@actions/github`. This means all higher-level services (`GitHubIssue`,
`GitHubRelease`, `CheckRun`, `PullRequest`, `GitBranch`, `GitCommit`,
`GitTag`, etc.) require zero changes to their implementations.

## Internal Utilities (not exported)

### WorkflowCommand

Formats `::command key=val,key=val::message` strings with proper escaping:

| Char | Escape |
| --- | --- |
| `%` | `%25` |
| `\r` | `%0D` |
| `\n` | `%0A` |
| `:` | `%3A` (properties only) |
| `,` | `%2C` (properties only) |

Also handles property-less commands like `::add-mask::value` where the value
is the entire message field with no key-value properties.

### RuntimeFile

Appends to GitHub Actions env files (`GITHUB_OUTPUT`, `GITHUB_ENV`,
`GITHUB_STATE`, `GITHUB_PATH`, `GITHUB_STEP_SUMMARY`) using the
delimiter-based format for multiline values:

```text
name<<EOF
value line 1
value line 2
EOF
```

Single-line values use `name=value`. Auto-detects newlines and switches
format. Uses `@effect/platform-node` `FileSystem.appendFile`.

## Runtime Layer

### ActionsRuntime.Default

Single convenience layer that wires core services:

- `ConfigProvider` for GitHub Actions inputs
- `Logger` for workflow commands
- `FileSystem` from `@effect/platform-node`
- `ActionOutputs`, `ActionState`, `ActionLogger` Live layers
- `ActionEnvironment` Live layer

Optional services composed separately by consumers:

```typescript
// Core only
program.pipe(Effect.provide(ActionsRuntime.Default))

// With GitHub API
program.pipe(
  Effect.provide(ActionsRuntime.Default),
  Effect.provide(GitHubClientLive),
)

// With tool installation
program.pipe(
  Effect.provide(ActionsRuntime.Default),
  Effect.provide(ToolInstallerLive),
)

// With caching (depends on GitHubClient for archive, uses internal protocol)
program.pipe(
  Effect.provide(ActionsRuntime.Default),
  Effect.provide(ActionCacheLive),
)
```

## Error Handling

### RuntimeEnvironmentError

Thrown when required env vars are missing (running outside GitHub Actions):

```typescript
class RuntimeEnvironmentError extends Data.TaggedError(
  "RuntimeEnvironmentError",
)<{
  readonly variable: string
  readonly message: string
}>() {}
```

### ConfigProvider Errors

Missing required inputs produce standard `ConfigError` — no custom error
type needed.

### Existing Error Types

`CacheError`, `ToolInstallError`, `GitHubClientError`, `ActionStateError`,
`ActionOutputError`, etc. continue as `Data.TaggedError` with appropriate
fields.

## Dependency Changes

### New Peer Dependencies (required)

| Package | Purpose |
| --- | --- |
| `@effect/platform` | Command, FileSystem abstractions |
| `@effect/platform-node` | Node implementations |

### New Direct Dependencies

| Package | Purpose |
| --- | --- |
| `@octokit/rest` | GitHub REST API |
| `@octokit/auth-app` | GitHub App auth |

### Removed (all @actions/\* packages)

- `@actions/core` (was required peer)
- `@actions/exec` (was optional peer)
- `@actions/github` (was optional peer)
- `@actions/cache` (was optional peer)
- `@actions/tool-cache` (was optional peer)

## Source Layout

```text
src/
  runtime/         -- ConfigProvider, Logger, WorkflowCommand, RuntimeFile
  services/        -- Domain service interfaces
  layers/          -- Live and Test layer implementations
  errors/          -- Tagged error types
  schemas/         -- Schema definitions
  utils/           -- GithubMarkdown, ReportBuilder
  index.ts         -- Barrel export
```

## What Gets Deleted

### Removed Services (6)

- `ActionsCore` + `ActionsCoreLive`
- `ActionsExec` + `ActionsExecLive`
- `ActionsGitHub` + `ActionsGitHubLive`
- `ActionsCache` + `ActionsCacheLive` (the wrapper — `ActionCache` is
  rewritten)
- `ActionsToolCache` + `ActionsToolCacheLive`
- `ActionInputs` + `ActionInputsLive` (replaced by `ConfigProvider`)

### Rewritten Services (6)

- `ActionLogger` → reduced interface (group + withBuffer only), new Live
  layer
- `ActionOutputs` → same interface shape, new Live layer using `FileSystem` +
  `WorkflowCommand`
- `ActionState` → same interface shape, new Live layer using `FileSystem`
- `CommandRunner` → new Live layer using `@effect/platform` `Command`
- `ActionCache` → new Live layer using internal cache protocol with native
  `fetch`
- `ToolInstaller` → new Live layer using `fetch` + `Command` + `FileSystem`

### Unchanged Services

All higher-level GitHub API services retain their interfaces and
implementations. The `GitHubClient` interface is preserved — only the Live
layer changes wiring from `@actions/github` to direct `@octokit/rest`:

- `GitHubClient` (Live layer rewritten), `GitHubGraphQL`, `GitHubApp`
- `GitHubIssue`, `GitHubRelease`, `CheckRun`
- `PullRequest`, `PullRequestComment`, `WorkflowDispatch`
- `TokenPermissionChecker`, `RateLimiter`
- `GitBranch`, `GitCommit`, `GitTag`
- `ChangesetAnalyzer`, `ConfigLoader`
- `PackagePublish`, `PackageManagerAdapter`, `WorkspaceDetector`, `NpmRegistry`
- `ActionEnvironment`, `DryRun`

## Test Layers

Same namespace object pattern — no changes to testing strategy:

```typescript
const state = ActionOutputsTest.empty()
const layer = ActionOutputsTest.layer(state)
```

In-memory mocks, no runtime dependencies.

## Consumer Migration (workflow-runtime-action)

| Before | After |
| --- | --- |
| `ActionsCoreLive` | `ActionsRuntime.Default` |
| `ActionsExecLive` + `CommandRunnerLive` | `CommandRunnerLive` |
| `ActionsToolCacheLive` + `ToolInstallerLive` | `ToolInstallerLive` |
| `ActionsCacheLive` + `ActionCacheLive` | `ActionCacheLive` |
| `ActionInputs` service methods | `Config.string(...)` etc. |
| `ActionLogger` logging | `Effect.log` / `Effect.logWarning` etc. |
| `ActionLogger.group(...)` | unchanged |
| `ActionOutputs.summary(...)` | unchanged |
