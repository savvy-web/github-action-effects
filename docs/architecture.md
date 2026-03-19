# Architecture

`@savvy-web/github-action-effects` is an Effect-based utility library for
building GitHub Actions. It follows the Effect services and layers pattern:
each capability is defined as an abstract service interface, with separate
live implementations (wrapping `@actions/core`) and test implementations
(capturing calls in memory). This separation makes action logic fully
testable without mocking.

## Source Layout

```text
src/
  services/    - Effect service definitions (interfaces + tags)
  layers/      - Live and Test implementations of each service
  errors/      - Tagged error types (Data.TaggedError)
  schemas/     - Effect Schema definitions (LogLevel, OtelExporter, Workspace, etc.)
  utils/       - Namespace utilities (GithubMarkdown, AutoMerge, SemverResolver, etc.)
  Action.ts    - Action namespace (run, parseInputs, makeLogger, setLogLevel, resolveLogLevel)
  index.ts     - Barrel export (single entry point)
```

## Services

Each service is defined as a TypeScript interface paired with a
`Context.GenericTag` for dependency injection. The tag and interface share
the same name via Effect's dual-purpose pattern.

### ActionInputs

Reads GitHub Action inputs with schema validation.

| Method | Signature | Description |
| --- | --- | --- |
| `get` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input, validate against schema |
| `getOptional` | `(name, schema) => Effect<Option<A>, ActionInputError>` | Read an optional input; returns `Option.none()` if empty |
| `getSecret` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input and mask it in logs via `core.setSecret` |
| `getJson` | `(name, schema) => Effect<A, ActionInputError>` | Read a required input, parse as JSON, then validate against schema |
| `getMultiline` | `(name, itemSchema) => Effect<Array<A>, ActionInputError>` | Read multiline input, split on newlines, trim, filter blanks/comments, validate each item |
| `getBoolean` | `(name) => Effect<boolean, ActionInputError>` | Read a boolean input (true/false, case-insensitive) |
| `getBooleanOptional` | `(name, defaultValue) => Effect<boolean, ActionInputError>` | Read an optional boolean input with a default value |

All methods that accept a `schema` parameter use `Schema.decode` to validate
the raw string (or parsed JSON) value. Validation failures are mapped to
`ActionInputError` with the input name, reason, and raw value.

### Action.parseInputs

`Action.parseInputs` reads all inputs at once from a config record. Each entry
specifies `{ schema, required?, default?, multiline?, secret?, json? }`. An
optional second argument accepts a cross-validation function that receives the
parsed object and can return errors.

```typescript
const inputs = yield* Action.parseInputs({
  "app-id": { schema: Schema.NumberFromString, required: true },
  "branch": { schema: Schema.String, default: "main" },
});
```

Requires `ActionInputs` in the Effect context. Accessed via the `Action`
namespace; the `InputConfig` type is exported separately.

### ActionLogger

Provides GitHub Actions-specific logging operations beyond what the Effect
Logger handles. The core log-level routing is handled separately by
`ActionLoggerLayer` (see Logging System below). This service adds:

| Method | Signature | Description |
| --- | --- | --- |
| `group` | `(name, effect) => Effect<A, E, R>` | Run an effect inside a collapsible log group |
| `withBuffer` | `(label, effect) => Effect<A, E, R>` | Run an effect with buffered logging (buffer-on-failure pattern) |
| `annotationError` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.error` (red, blocks PR checks) |
| `annotationWarning` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.warning` (yellow) |
| `annotationNotice` | `(message, properties?) => Effect<void>` | Emit a file/line annotation via `core.notice` (blue) |

### ActionOutputs

Sets GitHub Action outputs, step summaries, environment variables, and PATH
entries.

| Method | Signature | Description |
| --- | --- | --- |
| `set` | `(name, value) => Effect<void>` | Set a string output value |
| `setJson` | `(name, value, schema) => Effect<void, ActionOutputError>` | Encode via schema, serialize to JSON, set as output |
| `summary` | `(content) => Effect<void, ActionOutputError>` | Write markdown to the step summary |
| `exportVariable` | `(name, value) => Effect<void>` | Export an environment variable for subsequent steps |
| `addPath` | `(path) => Effect<void>` | Add a directory to PATH for subsequent steps |
| `setFailed` | `(message) => Effect<void>` | Mark the action as failed via `core.setFailed` |
| `setSecret` | `(value) => Effect<void>` | Mask a runtime value in logs via `core.setSecret` |

`setJson` uses `Schema.encode` to validate before serializing, ensuring
the output conforms to the schema.

### ActionState

Schema-serialized state passing for multi-phase GitHub Actions (pre/main/post).
Uses Effect Schema encode/decode to provide type-safe complex objects across
action phases, where `@actions/core.saveState()` and `getState()` only accept
strings.

| Method | Signature | Description |
| --- | --- | --- |
| `save` | `(key, value, schema) => Effect<void, ActionStateError>` | Serialize via Schema.encode, persist with core.saveState |
| `get` | `(key, schema) => Effect<A, ActionStateError>` | Read, parse JSON, decode via Schema.decode |
| `getOptional` | `(key, schema) => Effect<Option<A>, ActionStateError>` | Like get but returns Option.none() when key has no value |

## Action.run Helper

`Action.run` is a top-level convenience function that eliminates boilerplate
for wiring Effect programs into GitHub Action entry points. It is accessed via
the `Action` namespace.

```typescript
// Simplest form -- provides core layers automatically
Action.run(program);

// With additional layers (e.g., ActionStateLive)
Action.run(program, ActionStateLive);
```

It handles:

* Providing core Live layers (ActionInputsLive, ActionLoggerLive,
  ActionOutputsLive)
* Providing `NodeContext.layer` from `@effect/platform-node` for Node.js
  platform services (FileSystem, Path, Terminal, CommandExecutor, WorkerManager)
* Installing ActionLoggerLayer (routes Effect.log to core.info/debug)
* Catching all errors via `Effect.catchAllCause` and calling `core.setFailed`
  (uses `Cause.pretty` for formatting; planned upgrade to `Action.formatCause`)
* Running with `Effect.runPromise`

Note: `ActionStateLive` is not included in core layers because not all actions
need multi-phase state. Pass it as the second `layer` argument to `Action.run`
when needed.

## Platform Wrapper Services

All `@actions/*` and `@octokit/auth-app` package calls are isolated behind
thin wrapper services. This is what makes Live layers fully testable without
`vi.mock`.

### Purpose

Before the platform abstraction, Live layers imported `@actions/core`,
`@actions/github`, etc. directly. This meant any file that imported a Live
layer would transitively pull in those packages -- including test files -- even
when tests were only using in-memory test layers.

The platform wrapper pattern moves those static imports to a single dedicated
Live layer per package. All other Live layers depend only on the wrapper
service interface, which test code can satisfy with mock implementations.

### The 6 Wrapper Services

| Service | Live Layer | Wraps |
| --- | --- | --- |
| `ActionsCore` | `ActionsCoreLive` | `@actions/core` |
| `ActionsGitHub` | `ActionsGitHubLive` | `@actions/github` |
| `ActionsCache` | `ActionsCacheLive` | `@actions/cache` |
| `ActionsExec` | `ActionsExecLive` | `@actions/exec` |
| `ActionsToolCache` | `ActionsToolCacheLive` | `@actions/tool-cache` |
| `OctokitAuthApp` | `OctokitAuthAppLive` | `@octokit/auth-app` |

Each wrapper service is a thin Effect service interface that mirrors the
relevant API surface of its underlying package. The Live layer provides the
real implementation that calls the actual package functions.

### ActionsPlatformLive

`ActionsPlatformLive` is a convenience bundle that merges all six wrapper
Live layers into a single `Layer<ActionsPlatform>`:

```typescript
import { ActionsPlatformLive } from "@savvy-web/github-action-effects"

// Provides ActionsCore, ActionsGitHub, ActionsCache, ActionsExec,
// ActionsToolCache, and OctokitAuthApp all at once
Action.run(program, Layer.merge(ActionStateLive, ActionsPlatformLive))
```

`Action.run` already includes `ActionsCoreLive` internally (it is required for
core operations). `ActionsPlatformLive` is useful when you need all platform
wrappers in a single expression -- for example, in integration tests that
exercise multiple Live layers simultaneously.

### Injecting a Custom Platform in Action.run

`Action.run` accepts an optional `platform` option that replaces the default
`ActionsCoreLive`:

```typescript
import { Action, ActionsCoreLive } from "@savvy-web/github-action-effects"
import { ActionsPlatformLive } from "@savvy-web/github-action-effects"

// Use all platform wrappers (for actions that need GitHub API, exec, etc.)
Action.run(program, undefined, { platform: ActionsPlatformLive })
```

This design means `/testing` subpath imports never trigger `@actions/*`
package loads, since `ActionsCoreLive` (the only place those static imports
live) is not re-exported from `/testing`.

## Layer Composition

Services use `Context.GenericTag` (not class-based `Tag`) for their
dependency injection tokens. Live layers wrap `@actions/core` functions.
Compose them with `Layer.mergeAll` for a complete runtime:

```typescript
import { NodeContext } from "@effect/platform-node"

const MainLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionOutputsLive,
  ActionLoggerLive,
  NodeContext.layer,
)
```

There is an important distinction between two exports from
`ActionLoggerLive.ts`:

* **`ActionLoggerLive`** is a `Layer<ActionLogger>` that provides the service
  (group, withBuffer, annotationError, annotationWarning, annotationNotice).
* **`ActionLoggerLayer`** is a `Layer<never>` that replaces Effect's default
  `Logger` with a GitHub Actions-aware logger. It does not provide a service
  to the context; it reconfigures how `Effect.log` and friends behave.

Both are typically needed. `ActionLoggerLayer` must be provided separately
because it operates on the logger infrastructure rather than providing a
context service:

```typescript
const program = myAction.pipe(
  Effect.provide(MainLayer),
  Effect.provide(ActionLoggerLayer),
)
```

`Action.run` handles both automatically.

## Logging System

The logging architecture has two parts: a custom Effect Logger (installed via
`ActionLoggerLayer`) and the `ActionLogger` service for structural operations.

### CurrentLogLevel and Action.setLogLevel

`CurrentLogLevel` is a `FiberRef<ActionLogLevel>` that holds the active log
level for the current fiber. It defaults to `"info"`. Use `Action.setLogLevel`
to change it within a scoped region.

### Action.makeLogger

`Action.makeLogger()` creates an `Effect.Logger` with two output channels:

1. **Shadow channel** -- every log message is always written to `core.debug()`.
   GitHub only displays these when `ACTIONS_STEP_DEBUG` is enabled, so this
   acts as a full diagnostic trace at zero visible cost.
2. **User-facing channel** -- messages are conditionally emitted based on the
   current `ActionLogLevel` (read from `CurrentLogLevel` via `FiberRefs`).

### shouldEmitUserFacing

The user-facing emission rules for each action log level:

| ActionLogLevel | User-facing threshold |
| --- | --- |
| `debug` | All messages (always emit) |
| `verbose` | `LogLevel.Info` and above |
| `info` | `LogLevel.Warning` and above |

When emitting to user-facing output, `Error`-level and above maps to
`core.error()`, `Warning`-level maps to `core.warning()`, and everything
else maps to `core.info()`.

### withBuffer

The buffer-on-failure pattern optimizes output at `info` level:

1. If the current level is not `"info"`, the effect runs normally with no
   buffering.
2. At `"info"` level, a temporary logger is installed that:
   * Writes everything to `core.debug()` (shadow channel).
   * Emits `Warning` and above immediately.
   * Captures all other messages in an in-memory buffer.
3. On success, the buffer is discarded -- the user sees only warnings and
   errors.
4. On failure (via `tapErrorCause`), the buffer is flushed to `core.info()`
   with labeled delimiters, giving full context for debugging.

### LogLevelInput and Action.resolveLogLevel

`LogLevelInput` is an Effect Schema accepting `"info"`, `"verbose"`,
`"debug"`, or `"auto"`. `Action.resolveLogLevel` converts a `LogLevelInput`
to a concrete `ActionLogLevel`:

* `"info"`, `"verbose"`, `"debug"` pass through unchanged.
* `"auto"` resolves to `"debug"` when `RUNNER_DEBUG` is `"1"`, otherwise
  `"info"`.

## Error Types

All error types use `Data.TaggedError` for structural equality and pattern
matching.

### ActionInputError

* **Tag**: `"ActionInputError"`
* **Fields**: `inputName` (string), `reason` (string), `rawValue` (string
  or undefined)

### ActionOutputError

* **Tag**: `"ActionOutputError"`
* **Fields**: `outputName` (string), `reason` (string)

### ActionStateError

* **Tag**: `"ActionStateError"`
* **Fields**: `key` (string), `reason` (string), `rawValue` (string or
  undefined)

Each error module exports a `Base` class (e.g., `ActionInputErrorBase`)
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

* **`Status`** -- Literal union: `"pass"`, `"fail"`, `"skip"`, `"warn"`
* **`ChecklistItem`** -- Struct with `label` (string) and `checked` (boolean)
* **`CapturedOutput`** -- Struct with `name` (string) and `value` (string),
  used by test layers to record output calls

## Extended Services

Beyond the core services, the library includes a comprehensive set of
services for GitHub API operations, package management, and infrastructure.
Each follows the same pattern: interface + `Context.GenericTag` in
`src/services/`, live layer in `src/layers/*Live.ts`, test layer in
`src/layers/*Test.ts`.

See [services.md](./services.md) for usage examples of each service.

### GitHub API Services

| Service | Live Layer | Description |
| --- | --- | --- |
| GitHubClient | GitHubClientLive | Octokit REST/GraphQL with pagination |
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
| ActionCache | ActionCacheLive | GitHub Actions cache |
| ActionTelemetry | ActionTelemetryLive | Metrics and span attributes |
| CommandRunner | CommandRunnerLive | Shell execution with capture |
| ConfigLoader | ConfigLoaderLive | JSON/JSONC/YAML config loading |
| DryRun | DryRunLive | Mutation interception |
| TokenPermissionChecker | TokenPermissionCheckerLive | Token permission checks |
| RateLimiter | RateLimiterLive | Rate limit guard and retry |
| WorkflowDispatch | WorkflowDispatchLive | Workflow trigger and poll |
| ToolInstaller | ToolInstallerLive | Tool binary installation |

## Test Layers

Every service has a corresponding test implementation in `src/layers/`.
All follow the same namespace object pattern (`empty()` to create state,
`layer(state)` to build the layer) unless noted otherwise.

### Core Test Layers

* `ActionInputsTest(inputs)` -- accepts a `Record<string, string>` and
  returns a layer that reads from it instead of `@actions/core`.
* `ActionLoggerTest` -- captures groups, annotations (with type), and
  flushed buffers in `ActionLoggerTestState`.
* `ActionOutputsTest` -- captures outputs, summaries, exported variables,
  paths, failed messages, and secrets in `ActionOutputsTestState`.
* `ActionStateTest` -- uses an in-memory `Map<string, string>`. Can be
  pre-populated to simulate state from a previous phase.

### Extended Test Layers

All extended services ship with test layers following the same pattern:

| Test Layer | State Type |
| --- | --- |
| ActionEnvironmentTest | - |
| ActionCacheTest | ActionCacheTestState |
| ActionTelemetryTest | ActionTelemetryTestState |
| GitHubClientTest | GitHubClientTestState |
| GitHubGraphQLTest | GitHubGraphQLTestState |
| GitHubReleaseLive | GitHubReleaseTestState |
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
