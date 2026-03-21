# Architecture

`@savvy-web/github-action-effects` is an Effect-based utility library for
building GitHub Actions. It follows the Effect services and layers pattern:
each capability is defined as an abstract service interface, with separate
live implementations (using native runtime protocol) and test implementations
(capturing calls in memory). This separation makes action logic fully
testable without mocking.

## Zero @actions/* Dependencies

All `@actions/*` packages have been replaced with native ESM implementations.
The library implements the GitHub Actions runtime protocol directly:

- `WorkflowCommand` -- formats `::command::` protocol strings with value/property escaping
- `RuntimeFile` -- appends to environment files (`GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_STATE`, `GITHUB_PATH`)
- `ActionsConfigProvider` -- reads `INPUT_*` environment variables as an Effect `ConfigProvider`
- `ActionsLogger` -- Effect `Logger` that emits workflow commands (`::debug::`, `::warning::`, `::error::`)

Direct dependencies on `@octokit/rest` and `@octokit/auth-app` replace
`@actions/github`.

## Source Layout

```text
src/
  runtime/     - Native GitHub Actions runtime protocol implementations
  services/    - Effect service definitions (interfaces + tags)
  layers/      - Live and Test implementations of each service
  errors/      - Tagged error types (Data.TaggedError)
  schemas/     - Effect Schema definitions (LogLevel, Changeset, Workspace, etc.)
  utils/       - Namespace utilities (GithubMarkdown, AutoMerge, SemverResolver, etc.)
  Action.ts    - Action namespace (run, formatCause, resolveLogLevel)
  index.ts     - Barrel export (single entry point)
  testing.ts   - Test-safe entry point (excludes Action namespace)
```

## Runtime Layer

The `src/runtime/` directory is the foundation of the library. It implements
the GitHub Actions runtime protocol natively, with no CJS dependencies.

### WorkflowCommand

Formats GitHub Actions workflow commands following the `::command::` protocol:

```text
::debug::This is a debug message
::warning file=src/index.ts,line=10::Deprecated API usage
::error::Something went wrong
::group::Build
::endgroup::
```

Handles value escaping (`%`, `\r`, `\n`) and property escaping (`%`, `\r`,
`\n`, `:`, `,`).

### RuntimeFile

Appends key-value pairs and delimited values to GitHub Actions environment
files (`GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_STATE`, `GITHUB_PATH`,
`GITHUB_STEP_SUMMARY`). Uses a random delimiter for multi-line values.

### ActionsConfigProvider

An Effect `ConfigProvider` that reads GitHub Actions inputs from `INPUT_*`
environment variables. This replaces `@actions/core.getInput()`:

```typescript
// In action.yml: inputs.package-name
// Environment: INPUT_PACKAGE-NAME=my-package

const name = yield* Config.string("package-name")  // reads INPUT_PACKAGE-NAME
```

The provider converts config keys to uppercase and prepends `INPUT_`.
Hyphens are preserved (not converted to underscores), matching the GitHub
Actions runtime behavior.

### ActionsLogger

An Effect `Logger` implementation that maps log levels to workflow commands:

| Effect LogLevel | Workflow Command |
| --- | --- |
| Debug, Trace | `::debug::` |
| Info | stdout (plain text) |
| Warning | `::warning::` |
| Error, Fatal | `::error::` |

Log annotations (`file`, `line`, `col`) are emitted as workflow command
properties, producing inline annotations on PR diffs.

### ActionsRuntime.Default

A single convenience `Layer` that wires all runtime components together:

```typescript
import { Effect, Config } from "effect"
import { ActionsRuntime } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const name = yield* Config.string("name")
  yield* Effect.log(`Hello, ${name}!`)
})

Effect.runPromise(Effect.provide(program, ActionsRuntime.Default))
```

Provides:

- `ConfigProvider` backed by `ActionsConfigProvider`
- `Logger` backed by `ActionsLogger`
- `ActionOutputs` for setting outputs and writing step summaries
- `ActionState` for reading and writing action state across phases
- `ActionLogger` for group markers and buffered logging
- `ActionEnvironment` for reading GitHub/runner context variables
- `FileSystem` (Node.js) required by output and state services

## Action.run Helper

`Action.run` is a top-level convenience function that eliminates boilerplate
for wiring Effect programs into GitHub Action entry points. It is accessed via
the `Action` namespace.

```typescript
// Simplest form -- provides ActionsRuntime.Default automatically
Action.run(program)

// With additional layers
Action.run(program, { layer: Layer.mergeAll(GitHubClientLive, DryRunLive) })
```

It handles:

- Providing `ActionsRuntime.Default` (ConfigProvider, Logger, core services,
  Node.js FileSystem)
- Wrapping the program in `ActionLogger.withBuffer` for buffered output
- Catching all errors via `Effect.catchAllCause` and emitting `::error::`
  workflow commands
- Setting `process.exitCode = 1` on failure
- Running with `Effect.runPromise`

## Services

Each service is defined as a TypeScript interface paired with a `Context.Tag`
for dependency injection.

### ActionLogger

Provides GitHub Actions-specific logging operations beyond what the Effect
Logger handles:

| Method | Signature | Description |
| --- | --- | --- |
| `group` | `(name, effect) => Effect<A, E, R>` | Run an effect inside a collapsible log group |
| `withBuffer` | `(label, effect) => Effect<A, E, R>` | Run an effect with buffered logging (buffer-on-failure pattern) |
| `annotationError` | `(message, properties?) => Effect<void>` | Emit a file/line annotation (red, blocks PR checks) |
| `annotationWarning` | `(message, properties?) => Effect<void>` | Emit a file/line annotation (yellow) |
| `annotationNotice` | `(message, properties?) => Effect<void>` | Emit a file/line annotation (blue) |

### ActionOutputs

Sets GitHub Action outputs, step summaries, environment variables, and PATH
entries via `RuntimeFile`:

| Method | Signature | Description |
| --- | --- | --- |
| `set` | `(name, value) => Effect<void>` | Set a string output value |
| `setJson` | `(name, value, schema) => Effect<void, ActionOutputError>` | Encode via schema, serialize to JSON, set as output |
| `summary` | `(content) => Effect<void, ActionOutputError>` | Write markdown to the step summary |
| `exportVariable` | `(name, value) => Effect<void>` | Export an environment variable for subsequent steps |
| `addPath` | `(path) => Effect<void>` | Add a directory to PATH for subsequent steps |
| `setFailed` | `(message) => Effect<void>` | Mark the action as failed |
| `setSecret` | `(value) => Effect<void>` | Mask a runtime value in logs |

### ActionState

Schema-serialized state passing for multi-phase GitHub Actions (pre/main/post).
Uses Effect Schema encode/decode to provide type-safe complex objects across
action phases via `GITHUB_STATE` environment files.

| Method | Signature | Description |
| --- | --- | --- |
| `save` | `(key, value, schema) => Effect<void, ActionStateError>` | Serialize via Schema.encode, write to GITHUB_STATE |
| `get` | `(key, schema) => Effect<A, ActionStateError>` | Read state, parse JSON, decode via Schema.decode |
| `getOptional` | `(key, schema) => Effect<Option<A>, ActionStateError>` | Like get but returns Option.none() when key has no value |

## Logging System

The logging architecture uses `ActionsLogger`, an Effect Logger that maps
log levels to GitHub Actions workflow commands.

### withBuffer

The buffer-on-failure pattern optimizes output:

1. A temporary logger is installed that writes everything to `::debug::` and
   captures messages in an in-memory buffer.
2. Warning and above messages are emitted immediately.
3. On success, the buffer is discarded -- the user sees only warnings and
   errors.
4. On failure (via `tapErrorCause`), the buffer is flushed to stdout with
   labeled delimiters, giving full context for debugging.

## Error Types

All error types use `Data.TaggedError` for structural equality and pattern
matching.

### ActionOutputError

- **Tag**: `"ActionOutputError"`
- **Fields**: `outputName` (string), `reason` (string)

### ActionStateError

- **Tag**: `"ActionStateError"`
- **Fields**: `key` (string), `reason` (string), `rawValue` (string or
  undefined)

Each error module exports a `Base` class (e.g., `ActionOutputErrorBase`)
created by `Data.TaggedError(tag)`. The actual error class extends this
base. The base is exported separately for compatibility with api-extractor,
which requires the intermediate class to be visible.

## GithubMarkdown Namespace

Pure functions in `src/utils/GithubMarkdown.ts` for building GitHub Flavored
Markdown strings, accessed via the `GithubMarkdown` namespace. None of these
have side effects or dependencies.

| Method | Description |
| --- | --- |
| `GithubMarkdown.table(headers, rows)` | Build a GFM table from header and row arrays |
| `GithubMarkdown.heading(text, level?)` | Build a markdown heading (default level 2) |
| `GithubMarkdown.details(summary, content)` | Build a collapsible `<details>` block |
| `GithubMarkdown.checklist(items)` | Build a checkbox list from `ChecklistItem` array |
| `GithubMarkdown.statusIcon(status)` | Map a `Status` to its unicode indicator |
| `GithubMarkdown.bold(text)` | Wrap text in `**bold**` |
| `GithubMarkdown.code(text)` | Wrap text in inline backticks |
| `GithubMarkdown.codeBlock(content, language?)` | Build a fenced code block |
| `GithubMarkdown.link(text, url)` | Build an inline markdown link |
| `GithubMarkdown.list(items)` | Build a bulleted list |
| `GithubMarkdown.rule()` | Horizontal rule (`---`) |

### Schemas

Three schemas in `src/schemas/GithubMarkdown.ts` support the builders:

- **`Status`** -- Literal union: `"pass"`, `"fail"`, `"skip"`, `"warn"`
- **`ChecklistItem`** -- Struct with `label` (string) and `checked` (boolean)
- **`CapturedOutput`** -- Struct with `name` (string) and `value` (string),
  used by test layers to record output calls

## Extended Services

Beyond the core services, the library includes a comprehensive set of
services for GitHub API operations, package management, and infrastructure.
Each follows the same pattern: interface + `Context.Tag` in
`src/services/`, live layer in `src/layers/*Live.ts`, test layer in
`src/layers/*Test.ts`.

See [services.md](./services.md) for usage examples of each service.

### GitHub API Services

| Service | Live Layer | Description |
| --- | --- | --- |
| GitHubClient | GitHubClientLive | Octokit REST/GraphQL with pagination (uses @octokit/rest) |
| GitHubGraphQL | GitHubGraphQLLive | Typed GraphQL queries and mutations |
| GitHubRelease | GitHubReleaseLive | Release CRUD and asset upload |
| GitHubIssue | GitHubIssueLive | Issue management and PR linking |
| GitHubApp | GitHubAppLive | App token generation with bracket pattern |
| CheckRun | CheckRunLive | Check run CRUD with annotations |
| PullRequest | PullRequestLive | PR lifecycle: get, list, create, update, merge, getOrCreate |
| PullRequestComment | PullRequestCommentLive | Sticky (upsert) PR comments |
| GitTag | GitTagLive | Tag CRUD via Git Data API |
| GitBranch | GitBranchLive | Branch CRUD via Git Data API |
| GitCommit | GitCommitLive | Tree/commit creation, ref updates, file deletions |

### Package Management Services

| Service | Live Layer | Description |
| --- | --- | --- |
| NpmRegistry | NpmRegistryLive | npm registry queries |
| PackagePublish | PackagePublishLive | Pack, publish, verify integrity |
| PackageManagerAdapter | PackageManagerAdapterLive | Unified PM operations |
| WorkspaceDetector | WorkspaceDetectorLive | Monorepo detection |
| ChangesetAnalyzer | ChangesetAnalyzerLive | Changeset file operations |

### Infrastructure Services

| Service | Live Layer | Description |
| --- | --- | --- |
| ActionEnvironment | ActionEnvironmentLive | Typed env var access |
| ActionCache | ActionCacheLive | GitHub Actions cache (V2 Twirp + @azure/storage-blob) |
| CommandRunner | CommandRunnerLive | Shell execution with capture (node:child_process) |
| ConfigLoader | ConfigLoaderLive | JSON/JSONC/YAML config loading |
| DryRun | DryRunLive | Mutation interception |
| TokenPermissionChecker | TokenPermissionCheckerLive | Token permission checks |
| RateLimiter | RateLimiterLive | Rate limit guard and retry |
| WorkflowDispatch | WorkflowDispatchLive | Workflow trigger and poll |
| ToolInstaller | ToolInstallerLive | Tool installation (node:https/http + child_process) |

## Test Layers

Every service has a corresponding test implementation in `src/layers/`.
All follow the same namespace object pattern (`empty()` to create state,
`layer(state)` to build the layer).

### Core Test Layers

- `ActionLoggerTest` -- captures groups, annotations (with type), and
  flushed buffers in `ActionLoggerTestState`.
- `ActionOutputsTest` -- captures outputs, summaries, exported variables,
  paths, failed messages, and secrets in `ActionOutputsTestState`.
- `ActionStateTest` -- uses an in-memory `Map<string, string>`. Can be
  pre-populated to simulate state from a previous phase.
- `ActionEnvironmentTest` -- provides mock environment variables.

### Extended Test Layers

All extended services ship with test layers following the same pattern:

| Test Layer | State Type |
| --- | --- |
| ActionCacheTest | ActionCacheTestState |
| GitHubClientTest | GitHubClientTestState |
| GitHubGraphQLTest | GitHubGraphQLTestState |
| GitHubReleaseTest | GitHubReleaseTestState |
| GitHubIssueTest | GitHubIssueTestState |
| GitHubAppTest | GitHubAppTestState |
| CheckRunTest | CheckRunTestState |
| PullRequestTest | PullRequestTestState |
| PullRequestCommentTest | PullRequestCommentTestState |
| GitTagTest | GitTagTestState |
| GitBranchTest | GitBranchTestState |
| GitCommitTest | GitCommitTestState |
| CommandRunnerTest | CommandResponse |
| ConfigLoaderTest | ConfigLoaderTestState |
| DryRunTest | DryRunTestState |
| NpmRegistryTest | NpmRegistryTestState |
| PackagePublishTest | PackagePublishTestState |
| PackageManagerAdapterTest | PackageManagerAdapterTestState |
| WorkspaceDetectorTest | WorkspaceDetectorTestState |
| ChangesetAnalyzerTest | ChangesetAnalyzerTestState |
| TokenPermissionCheckerTest | TokenPermissionCheckerTestState |
| RateLimiterTest | RateLimiterTestState |
| WorkflowDispatchTest | WorkflowDispatchTestState |
| ToolInstallerTest | ToolInstallerTestState |

The namespace pattern lets tests inspect captured operations after the
effect completes.

See [testing.md](./testing.md) for usage details and
[patterns.md](./patterns.md) for common testing patterns.
