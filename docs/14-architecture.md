# Architecture

`@savvy-web/github-action-effects` is an Effect-based utility library for building GitHub Actions. It follows the Effect services and layers pattern: every capability is an abstract service interface with two implementations behind it. The live layer talks to the real runtime protocol; the test layer records calls in memory. Because your action code depends on the interface and not the implementation, you can test it against the in-memory layer without mocking anything.

## Zero @actions/* dependencies

Native ESM code replaces every `@actions/*` package. The library implements the GitHub Actions runtime protocol directly:

- `WorkflowCommand` — formats `::command::` protocol strings with value/property escaping
- `RuntimeFile` — appends to environment files (`GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_STATE`, `GITHUB_PATH`)
- `ActionsConfigProvider` — reads `INPUT_*` environment variables as an Effect `ConfigProvider`
- `ActionsLogger` — Effect `Logger` that emits workflow commands (`::debug::`, `::warning::`, `::error::`)

Direct dependencies on `@octokit/rest` and `@octokit/auth-app` replace `@actions/github`.

## Source layout

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

## Runtime layer

Everything else in the library sits on top of `src/runtime/`. It implements the GitHub Actions runtime protocol natively, with no CJS dependencies.

### WorkflowCommand

Formats GitHub Actions workflow commands following the `::command::` protocol:

```text
::debug::This is a debug message
::warning file=src/index.ts,line=10::Deprecated API usage
::error::Something went wrong
::group::Build
::endgroup::
```

Handles value escaping (`%`, `\r`, `\n`) and property escaping (`%`, `\r`, `\n`, `:`, `,`). Beyond `format` / `issue`, it exposes the named commands that have no Effect log level: `notice(properties, message)` for `::notice::`, `stopCommands(token)` / `resumeCommands(token)` to suspend and resume command processing, and `setCommandEcho(enabled)` for `::echo::on` / `::echo::off`. `ActionLogger.notice` is the Effect-level entry point built on `WorkflowCommand.notice`.

### RuntimeFile

Appends key-value pairs and delimited values to GitHub Actions environment files (`GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_STATE`, `GITHUB_PATH`, `GITHUB_STEP_SUMMARY`). Uses a random delimiter for multi-line values.

### ActionsConfigProvider

An Effect `ConfigProvider` that reads GitHub Actions inputs from `INPUT_*` environment variables. This replaces `@actions/core.getInput()`:

```typescript
// In action.yml: inputs.package-name
// Environment: INPUT_PACKAGE-NAME=my-package

const name = yield* Config.string("package-name")  // reads INPUT_PACKAGE-NAME
```

The provider converts config keys to uppercase and prepends `INPUT_`. Hyphens are preserved (not converted to underscores), matching the GitHub Actions runtime behavior.

### ActionsLogger

An Effect `Logger` implementation that maps log levels to workflow commands:

| Effect LogLevel | Workflow Command |
| --- | --- |
| Debug, Trace | `::debug::` |
| Info | stdout (plain text) |
| Warning | `::warning::` |
| Error, Fatal | `::error::` |

Log annotations (`file`, `line`, `col`) are emitted as workflow command properties, producing inline annotations on PR diffs.

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
- `HttpClient` (fetch-backed) required by `GitHubAppLive`, `ActionCacheLive`, `ArtifactLive` and `OidcTokenIssuerLive`

## Action.run helper

`Action.run` is the convenience function for wiring an Effect program into a GitHub Action entry point. Without it you would repeat the same setup in every `main.ts`. It lives on the `Action` namespace.

```typescript
// Simplest form -- provides ActionsRuntime.Default automatically
Action.run(program)

// With additional layers
Action.run(program, { layer: Layer.mergeAll(GitHubClientLive.fromEnv(), DryRunLive) })
```

It handles:

- Providing `ActionsRuntime.Default` (ConfigProvider, Logger, core services, Node.js FileSystem, fetch-backed HttpClient)
- Wrapping the program in `ActionLogger.withBuffer` for buffered output
- Catching all errors via `Effect.catchAllCause` and emitting `::error::` workflow commands
- Setting `process.exitCode = 1` on failure
- Running with `Effect.runPromise`

## Services

Each service is defined as a TypeScript interface paired with a `Context.Tag` for dependency injection.

### ActionLogger

Covers the two GitHub Actions logging operations the Effect Logger leaves out — collapsible groups and buffer-on-failure:

| Method | Signature | Description |
| --- | --- | --- |
| `group` | `(name, effect) => Effect<A, E, R>` | Run an effect inside a collapsible log group |
| `withBuffer` | `(label, effect) => Effect<A, E, R>` | Run an effect with buffered logging (buffer-on-failure pattern) |
| `notice` | `(message, properties?) => Effect<void>` | Emit a `::notice::` annotation (mirrors `@actions/core.notice`) |

`ActionLogger` has no annotation methods. Workflow annotations come from logging through Effect itself: call `Effect.logError` or `Effect.logWarning` with `file`, `line` and `col` log annotations, and `ActionsLogger` turns those into `::error file=...,line=...::` and `::warning file=...::` workflow commands. See the `ActionsLogger` section above for the level-to-command mapping.

### ActionOutputs

Sets GitHub Action outputs, step summaries, environment variables and PATH entries via `RuntimeFile`:

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

Schema-serialized state passing for multi-phase GitHub Actions (pre/main/post). Uses Effect Schema encode/decode to provide type-safe complex objects across action phases via `GITHUB_STATE` environment files.

| Method | Signature | Description |
| --- | --- | --- |
| `save` | `(key, value, schema) => Effect<void, ActionStateError>` | Serialize via Schema.encode, write to GITHUB_STATE |
| `get` | `(key, schema) => Effect<A, ActionStateError>` | Read state, parse JSON, decode via Schema.decode |
| `getOptional` | `(key, schema) => Effect<Option<A>, ActionStateError>` | Like get but returns Option.none() when key has no value |

## Logging system

Logging runs through `ActionsLogger`, an Effect Logger that maps each log level to a GitHub Actions workflow command.

### withBuffer

The buffer-on-failure pattern keeps the log quiet on success and verbose on failure:

1. A temporary logger is installed that writes everything to `::debug::` and captures messages in an in-memory buffer.
2. Warning and above messages are emitted immediately.
3. On success, the buffer is discarded — the user sees only warnings and errors.
4. On failure (via `tapErrorCause`), the buffer is flushed to stdout with labeled delimiters, giving full context for debugging.

## Error types

All error types use `Data.TaggedError` for structural equality and pattern matching.

### ActionOutputError

- **Tag**: `"ActionOutputError"`
- **Fields**: `outputName` (string), `reason` (string)

### ActionStateError

- **Tag**: `"ActionStateError"`
- **Fields**: `key` (string), `reason` (string), `rawValue` (string or undefined)

### Attestation and publish errors

The attestation cluster and the newer GitHub services add eight tagged errors. Each carries a `reason` or `operation` discriminator so a handler can branch on the failing stage:

| Error | Tag | Discriminator and fields |
| --- | --- | --- |
| `AttestError` | `"AttestError"` | `reason: "build" \| "save" \| "oidc" \| "sign" \| "upload"`, `message` |
| `SbomError` | `"SbomError"` | `reason: "build" \| "serialize" \| "save"`, `message` |
| `SigstoreSignerError` | `"SigstoreSignerError"` | `reason: "sign" \| "witness" \| "bundle"`, `message` |
| `OidcTokenError` | `"OidcTokenError"` | `reason: "env" \| "http" \| "decode" \| "save"`, `message` |
| `SlsaError` | `"SlsaError"` | `reason: "decode" \| "claims" \| "env"`, `message` |
| `GitHubContentError` | `"GitHubContentError"` | `operation: "getFile"`, `reason`, optional `path` |
| `GitHubCommitError` | `"GitHubCommitError"` | `operation: "get" \| "list" \| "compare"`, `reason`, optional `ref` |
| `GitHubArtifactMetadataError` | `"GitHubArtifactMetadataError"` | `operation: "createStorageRecord"`, `reason`, `retryable: boolean` |

See [error handling](./13-error-handling.md#the-attestation-and-publish-error-surface) for `catchTag` examples against these.

Every error class in `src/errors/` extends `Data.TaggedError("Tag")<{ ... }>` directly. There is no intermediate `Base` class.

## The Octokit cast seam

`AttestLive` uploads through `client.rest(..., (octokit) => ...)`, then guards the handle with `isOctokitLike(octokit)` before calling `octokit.request(...)`. If the provided client is not Octokit-shaped, it throws `"GitHubClient did not provide an Octokit-compatible client"`.

The trade-off is deliberate. The `GitHubClient` interface is intentionally Octokit-agnostic — most call sites work through `client.rest` / `client.paginate` and never touch a concrete Octokit type. The attestation upload is the one path that needs the raw `octokit.request(route, params)` shape, because `POST /repos/{owner}/{repo}/attestations` is not on a typed Octokit method. Rather than widen the public `GitHubClient` interface to expose Octokit internals everywhere, `AttestLive` narrows the type at runtime in the one place that needs it. The cost is a runtime guard instead of a compile-time guarantee; the benefit is a client interface that stays free of `@octokit/rest` types.

## The Action.run type-erasure boundary

`Action.run` merges `ActionsRuntime.Default` with any caller-supplied `options.layer`. Both sides can surface their own remaining requirements (for example `FileSystem` from `@effect/platform`), and `Layer.mergeAll` widens the requires-channel to the union. Internally the merged layer is annotated `Layer.Layer<any, never, any>` behind a `noExplicitAny` Biome ignore, and the program is cast back to `Effect<void, never, never>` at the `runPromise` boundary.

The `any` is a type-erasure seam, not a type hole. The two public overloads keep call-site safety intact:

```typescript
<E>(program: Effect.Effect<void, E, CoreServices>, options?: ActionRunOptions): Promise<void>
<E, R>(program: Effect.Effect<void, E, CoreServices | R>, options: ActionRunOptions<R>): Promise<void>
```

A caller still names exactly the services its program requires (`CoreServices`, plus any `R` it provides through `options.layer`). The internal erasure exists only so callers do not have to construct a single concrete `Layer<…>` annotation that spells out every transitively-required service of the merged stack. By the time the program reaches `runPromise`, the layer has resolved every requirement, so no requirements actually remain — the cast is sound.

## Replacing @actions/* packages

Native ESM stands in for every `@actions/*` package. This table is the at-a-glance lookup; for the narrative migration walkthrough with a worked example per package, see [coming from `@actions/*`](./06-toolkit-parity.md). The mapping:

| `@actions/*` | Replacement | Notes |
| --- | --- | --- |
| `@actions/core` (inputs) | `Config.*` via `ActionsConfigProvider`, plus `ActionInput.boolean` / `multiline` | reads `INPUT_*`; `ActionInput` adds YAML 1.2 boolean + multiline parity |
| `@actions/core` (outputs/state) | `ActionOutputs` / `ActionState` | via `RuntimeFile` |
| `@actions/core` (logging) | Effect `Logger` via `ActionsLogger` + `ActionLogger` | level→command mapping; `ActionLogger.notice` for `::notice::` |
| `@actions/core` (commands) | `WorkflowCommand` | `notice` / `stopCommands` / `resumeCommands` / `setCommandEcho` |
| `@actions/core` (paths) | `PathUtils` | `toPosixPath` / `toWin32Path` / `toPlatformPath` |
| `@actions/github` (context) | `ActionEnvironment` (`payload` / `repo` / `issue` / `isDebug`) + `WebhookPayload` | parsed `GITHUB_EVENT_PATH` |
| `@actions/github` (API) | `GitHubClient` (+ `@octokit/rest`) | direct dep, not `@actions/github` |
| `@actions/exec` | `CommandRunner` | `node:child_process` |
| `@actions/io` (`which`/`findInPath`) | `IoUtil.which` / `IoUtil.whichOrFail` / `IoUtil.findInPath` | namespace reading `FileSystem` |
| `@actions/io` (`cp`/`mv`/`rmRF`/`mkdirP`) | `@effect/platform` `FileSystem` | `copy` / `rename` / `remove` / `makeDirectory` |
| `@actions/glob` | `Glob` service | `Glob.glob` + `Glob.hashFiles` (SHA-256 hash-of-hashes, `@actions/glob`-compatible) |
| `@actions/http-client` | `@effect/platform` `HttpClient` | idiomatic substitute; no new export |
| `@actions/cache` | `ActionCache` | V2 Twirp + Azure Blob |
| `@actions/artifact` | `Artifact` service | V2 Twirp + Azure Block Blob; runs inside a JS action only |
| `@actions/tool-cache` | `ToolInstaller` | `node:https`/`http` + child_process |
| `@actions/attest` | `Attest` cluster | Sigstore + GitHub attestation store |

The `IoUtil`, `Glob` and `Artifact` rows reflect the filesystem, glob and artifact work that shipped in this release. The `@actions/io` `cp`/`mv`/`rmRF`/`mkdirP` helpers are deliberately NOT wrapped — they map onto `@effect/platform` `FileSystem` (`copy` / `rename` / `remove` / `makeDirectory`) directly. See [filesystem I/O](./15-filesystem-io.md) for the operation-by-operation recipe.

## Upgrading to 2.0

The 2.0 release changes a handful of layer signatures. If you wire through `ActionsRuntime.Default` or `Action.run`, no changes are needed — both bundle the new requirements. The migration affects only consumers that compose layers by hand.

### Scopes and the fromApp / fromEnv constructors

`GitHubClientLive.fromApp` is now a scoped layer: it acquires the installation token when built and revokes it on scope close, so building the layer needs a `Scope`. Wrap a bare `Effect.provide` in `Effect.scoped`. `fromApp` also requires `HttpClient.HttpClient` and takes `privateKey` as a `Redacted<string>`:

```typescript
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  // ...
}).pipe(
  Effect.provide(
    GitHubClientLive.fromApp({ clientId, privateKey: Redacted.make(pem) }),
  ),
  Effect.provide(FetchHttpClient.layer), // 2.0: fromApp needs an HttpClient
  Effect.scoped, // 2.0: fromApp acquires the token in a scope
)
```

`GitHubClientLive.fromEnv` is now a function — call `fromEnv()` where you previously referenced the bare property.

### Redacted secret-bearing signatures

The secret-bearing APIs now take `Redacted<string>` instead of plain `string`: `GitHubApp.generateToken` / `resolveAppIdentity` / `revokeToken` / `withToken`, `GitHubClientLive.fromToken` / `fromApp`, and `PackagePublish.setupAuth` / `RegistryTarget.token`. `InstallationToken.token` now decodes to `Redacted<string>` — read it with `Redacted.value` where you need the plain string. Wrap raw tokens with `Redacted.make` before passing them in.

### HttpClient requirement

`GitHubAppLive` and `ActionCacheLive` now require `HttpClient.HttpClient` in their requirements channel. Provide `FetchHttpClient.layer` from `@effect/platform`, or use `ActionsRuntime.Default`, which now bundles it:

```typescript
import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { ActionCacheLive } from "@savvy-web/github-action-effects"

const cacheLayer = Layer.provide(ActionCacheLive, FetchHttpClient.layer)
```

The filesystem, glob and artifact services (`IoUtil`, `Glob`) and the input/event/notice helpers added in 2.0 are additive — they add new exports without changing existing signatures, so they need no migration.

## GithubMarkdown namespace

Pure functions in `src/utils/GithubMarkdown.ts` for building GitHub Flavored Markdown strings, accessed via the `GithubMarkdown` namespace. None of these have side effects or dependencies.

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
| `GithubMarkdown.image(src, alt, options?)` | Build an `<img>` tag (matches `@actions/core` `addImage`) |
| `GithubMarkdown.quote(text, cite?)` | Build a `<blockquote>` (matches `@actions/core` `addQuote`) |

`image` and `quote` interpolate their values raw, not HTML-escaped — matching `@actions/core`, which relies on GitHub sanitizing step-summary HTML server-side. Escape the values yourself if you embed the output elsewhere with untrusted input.

### Schemas

Three schemas in `src/schemas/GithubMarkdown.ts` support the builders:

- **`Status`** — Literal union: `"pass"`, `"fail"`, `"skip"`, `"warn"`
- **`ChecklistItem`** — Struct with `label` (string) and `checked` (boolean)
- **`CapturedOutput`** — Struct with `name` (string) and `value` (string), used by test layers to record output calls

## Extended services

Past the core services, the library ships services for GitHub API calls, package management and infrastructure. They all follow the same pattern: interface plus `Context.Tag` in `src/services/`, live layer in `src/layers/*Live.ts`, test layer in `src/layers/*Test.ts`.

See [services guide](./03-services.md) for usage examples of each service.

### GitHub API services

| Service | Live Layer | Description |
| --- | --- | --- |
| GitHubClient | GitHubClientLive (namespace) | Octokit REST/GraphQL with pagination (uses @octokit/rest) |
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

`GitHubClientLive` is the exception in this table — it is not a bare `Layer`. It is a namespace object with three constructors, each building a `GitHubClient` layer from a different credential source. See [Building a GitHubClient layer](#building-a-githubclient-layer) below.

`GitHubApp` authenticates as a GitHub App. Its live layer, `GitHubAppLive`, depends on `OctokitAuthApp` — the wrapper around `@octokit/auth-app`. In production you compose the two: `Layer.provide(GitHubAppLive, OctokitAuthAppLive)`.

#### Building a GitHubClient layer

`GitHubClientLive` exposes three constructors. Each builds the same `GitHubClient` service from a different credential source, so the choice is about which identity the API calls run as:

| Constructor | Signature | Result type |
| --- | --- | --- |
| `fromEnv` | `(resilience?)`, no required arguments | `Layer<GitHubClient, GitHubClientError>` |
| `fromToken` | `(token: Redacted<string>, resilience?)` | `Layer<GitHubClient>` |
| `fromApp` | `({ clientId, privateKey: Redacted<string>, installationId? }, resilience?)` | `Layer<GitHubClient, GitHubAppError, HttpClient.HttpClient>` |

- `fromEnv()` reads `process.env.GITHUB_TOKEN`, the repo-scoped workflow token. It is a function — call it with no arguments, or pass `ResilienceOptions` to tune retries. It fails with `GitHubClientError` if the variable is unset.
- `fromToken` takes a token you constructed. The token must be a `Redacted<string>` — wrap a bare string with `Redacted.make(...)` at the call site. It has no `process.env` dependency and cannot fail, so its error channel is `never`.
- `fromApp` mints an installation token from GitHub App credentials, with `privateKey` as a `Redacted<string>`. It composes `GitHubAppLive` and `OctokitAuthAppLive` internally, leaving only `HttpClient.HttpClient` to provide. It is a scoped layer: the minted token is revoked on scope close, so a bare `Effect.provide` must be wrapped in `Effect.scoped` (the `ActionsRuntime.Default` / `Action.run` path already scopes). For the pre/main/post pattern where one token is shared across phases, use `GitHubToken` instead.

```typescript
import { Effect, Redacted } from "effect"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
  return yield* client.rest("repos.get", (octokit) =>
    octokit.rest.repos.get({ owner, repo }),
  )
}).pipe(Effect.provide(GitHubClientLive.fromToken(Redacted.make(process.env.MY_TOKEN ?? ""))))
```

### GitHubToken namespace

`GitHubToken` (in `src/GitHubToken.ts`) coordinates a single GitHub App installation token across the three phases of an action — `pre`, `main` and `post`. It is a namespace object with five members:

| Member | Signature | Phase |
| --- | --- | --- |
| `provision` | `(options?: ProvisionOptions) => Effect<InstallationToken, ..., ActionState \| GitHubApp>` | `pre` |
| `client` | `() => Layer<GitHubClient, ActionStateError, ActionState>` | `main` |
| `read` | `() => Effect<InstallationToken, ActionStateError, ActionState>` | any post-provision |
| `botIdentity` | `() => Effect<BotIdentity, ActionStateError, ActionState>` | any post-provision |
| `dispose` | `() => Effect<void, ..., ActionState \| GitHubApp>` | `post` |

`provision` generates an installation token, optionally verifies its `permissions` against a required set, then persists the token envelope to `ActionState` under an internal key. It also calls `GET /app` best-effort to resolve the App's public identity (slug, bot user ID, display name) and stores those fields — `appSlug`, `appUserId`, `appName` — on the persisted token. By default it reads App credentials from the `app-client-id` and `app-private-key` action inputs; pass `clientId` and `privateKey` on the options object to override. If verification or persistence fails the token is revoked, so a rejected token is never left orphaned.

`client` reads the persisted token back out of `ActionState` and returns a `GitHubClient` layer built via `GitHubClientLive.fromToken`. `read` returns the full `InstallationToken` envelope including the optional identity fields. `botIdentity` derives a `BotIdentity` (name + email) suitable for Git commit attribution — using the App-specific verified format when `appSlug` and `appUserId` are present, falling back to the well-known `github-actions[bot]` identity otherwise. `dispose` reads the token and revokes it, doing nothing if no token was persisted.

`provision` and `dispose` need a `GitHubApp` layer in their requirements channel — `GitHubAppLive` composed with `OctokitAuthAppLive` in production, `GitHubAppTest` in tests. `client`, `read` and `botIdentity` need only `ActionState`, which `ActionsRuntime.Default` already provides.

### Package management services

| Service | Live Layer | Description |
| --- | --- | --- |
| NpmRegistry | NpmRegistryLive | npm registry queries |
| PackagePublish | PackagePublishLive | Pack, publish, verify integrity |
| PackageManagerAdapter | PackageManagerAdapterLive | Unified PM operations |
| WorkspaceDetector | WorkspaceDetectorLive | Monorepo detection |
| ChangesetAnalyzer | ChangesetAnalyzerLive | Changeset file operations |

### Infrastructure services

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

## Test layers

Every service has a corresponding test implementation in `src/layers/`. All follow the same namespace object pattern (`empty()` to create state, `layer(state)` to build the layer).

### Core test layers

- `ActionLoggerTest` — captures log entries, groups and flushed buffers in `ActionLoggerTestState`.
- `ActionOutputsTest` — captures outputs, summaries, exported variables, paths, failed messages and secrets in `ActionOutputsTestState`.
- `ActionStateTest` — uses an in-memory `Map<string, string>`. Can be pre-populated to simulate state from a previous phase.
- `ActionEnvironmentTest` — provides mock environment variables.

### Extended test layers

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

The namespace pattern lets tests inspect captured operations after the effect completes.

See [testing GitHub Actions](./16-testing.md) for usage details and [common patterns](./04-patterns.md) for common testing patterns.
