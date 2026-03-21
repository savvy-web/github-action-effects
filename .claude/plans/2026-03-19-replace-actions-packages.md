# Replace @actions/* Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `@actions/*` CJS packages with native ESM
implementations using Effect primitives and the GitHub Actions runtime
protocol.

**Architecture:** Internal utilities (WorkflowCommand, RuntimeFile)
provide the foundation. Effect's ConfigProvider replaces input reading,
a custom Logger replaces logging, `@effect/platform` Command replaces
exec. Domain services (ActionOutputs, ActionState, ActionLogger,
ActionCache, ToolInstaller) get new Live layers. GitHubClient rewires
to direct `@octokit/rest`. An `ActionsRuntime.Default` layer ties it
all together.

**Tech Stack:** Effect, `@effect/platform`, `@effect/platform-node`,
`@octokit/rest`, `@octokit/auth-app`, native `fetch`, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-replace-actions-packages-design.md`

---

## File Map

### New Files

```text
src/runtime/WorkflowCommand.ts         -- ::command:: protocol formatter
src/runtime/WorkflowCommand.test.ts
src/runtime/RuntimeFile.ts             -- Env file appender (GITHUB_OUTPUT etc.)
src/runtime/RuntimeFile.test.ts
src/runtime/ActionsConfigProvider.ts   -- ConfigProvider for INPUT_* env vars
src/runtime/ActionsConfigProvider.test.ts
src/runtime/ActionsLogger.ts           -- Logger for workflow commands
src/runtime/ActionsLogger.test.ts
src/runtime/ActionsRuntime.ts          -- Convenience layer wiring everything
src/runtime/ActionsRuntime.test.ts
src/errors/RuntimeEnvironmentError.ts  -- New error for missing env vars
```

### Modified Files

```text
src/services/ActionLogger.ts          -- Reduce to group + withBuffer
src/services/ActionCache.ts           -- Update interface (new save/restore signatures)
src/services/ToolInstaller.ts         -- Update interface (low-level find/download/extract/cache)
src/layers/ActionOutputsLive.ts       -- Rewrite: FileSystem + WorkflowCommand
src/layers/ActionStateLive.ts         -- Rewrite: FileSystem + RuntimeFile
src/layers/ActionLoggerLive.ts        -- Rewrite: WorkflowCommand for groups
src/layers/CommandRunnerLive.ts       -- Rewrite: @effect/platform Command
src/layers/GitHubClientLive.ts        -- Rewrite: direct @octokit/rest (factory → layer)
src/layers/ToolInstallerLive.ts       -- Rewrite: fetch + Command + FileSystem
src/layers/ActionCacheLive.ts         -- Rewrite: internal cache protocol
src/Action.ts                         -- Update: use new runtime primitives
src/index.ts                          -- Update: exports
package.json                          -- Update: deps
```

### Deleted Files

```text
src/services/ActionsCore.ts
src/services/ActionsExec.ts
src/services/ActionsGitHub.ts
src/services/ActionsCache.ts          -- wrapper (ActionCache.ts is kept+updated)
src/services/ActionsToolCache.ts
src/services/OctokitAuthApp.ts
src/services/ActionInputs.ts
src/layers/ActionsCoreLive.ts
src/layers/ActionsExecLive.ts
src/layers/ActionsGitHubLive.ts
src/layers/ActionsCacheLive.ts
src/layers/ActionsToolCacheLive.ts
src/layers/ActionsPlatformLive.ts
src/layers/ActionInputsLive.ts
src/layers/ActionInputsTest.ts
```

---

## Task 1: WorkflowCommand Utility

**Files:**

- Create: `src/runtime/WorkflowCommand.ts`
- Create: `src/runtime/WorkflowCommand.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases for `WorkflowCommand`:

1. `format("debug", {}, "hello")` → `::debug::hello`
2. `format("error", { file: "foo.ts", line: "42" }, "msg")`
   → `::error file=foo.ts,line=42::msg`
3. `format("add-mask", {}, "secret")` → `::add-mask::secret`
4. Escapes `%` → `%25`, `\r` → `%0D`, `\n` → `%0A` in message
5. Escapes `:` → `%3A`, `,` → `%2C` in property values
6. `format("group", {}, "Section")` → `::group::Section`
7. `format("endgroup", {}, "")` → `::endgroup::`

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/runtime/WorkflowCommand.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement WorkflowCommand**

Module exports:

- `escapeData(value: string): string` — escape message content
- `escapeProperty(value: string): string` — escape property values
- `format(command: string, properties: Record<string, string>, message: string): string`
- `issue(command: string, properties: Record<string, string>, message: string): void`
  — calls `format` and writes to `process.stdout`

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/runtime/WorkflowCommand.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/
git commit -m "feat: add WorkflowCommand runtime utility"
```

---

## Task 2: RuntimeFile Utility + RuntimeEnvironmentError

**Files:**

- Create: `src/errors/RuntimeEnvironmentError.ts`
- Create: `src/runtime/RuntimeFile.ts`
- Create: `src/runtime/RuntimeFile.test.ts`

- [ ] **Step 0: Create RuntimeEnvironmentError**

Create `src/errors/RuntimeEnvironmentError.ts` following the
existing `Data.TaggedError` pattern:

```typescript
import { Data } from "effect"

export class RuntimeEnvironmentError extends Data.TaggedError(
  "RuntimeEnvironmentError",
)<{
  readonly variable: string
  readonly message: string
}>() {}
```

- [ ] **Step 1: Write failing tests**

Test cases for `RuntimeFile`:

1. `prepareValue("key", "value")` → `"key=value\n"`
2. `prepareValue("key", "line1\nline2")` produces delimiter format:
   `"key<<ghadelimiter_...\nline1\nline2\nghadelimiter_...\n"`
3. `append(filePath, "key", "value")` appends to file using
   `FileSystem`
4. Returns `RuntimeEnvironmentError` when env var is undefined
5. Delimiter is unique per call (UUID-based)

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/runtime/RuntimeFile.test.ts
```

- [ ] **Step 3: Implement RuntimeFile**

Module exports:

- `prepareValue(name: string, value: string): string` — format
  key-value for file append (single-line or delimiter format)
- `append(envVar: string, name: string, value: string): Effect<void, RuntimeEnvironmentError>`
  — read env var for file path, format value, append to file via
  `FileSystem`

Depends on `@effect/platform` `FileSystem` for the append effect.

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/runtime/RuntimeFile.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/
git commit -m "feat: add RuntimeFile utility for env file writes"
```

---

## Task 3: ActionsConfigProvider

**Files:**

- Create: `src/runtime/ActionsConfigProvider.ts`
- Create: `src/runtime/ActionsConfigProvider.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:

1. `Config.string("name")` reads `INPUT_NAME` from env
2. `Config.string("retry-count")` reads `INPUT_RETRY-COUNT`
   (hyphens preserved)
3. `Config.string("my input")` reads `INPUT_MY_INPUT`
   (spaces to underscores)
4. Missing input → `ConfigError`
5. Empty string input → treated as missing → `ConfigError`
6. `Config.withDefault(Config.string("optional"), "fallback")`
   returns `"fallback"` when missing
7. `Config.boolean("verbose")` reads and parses `INPUT_VERBOSE`
8. `Config.integer("count")` reads and parses `INPUT_COUNT`

Use `Effect.withConfigProvider` to install the provider in tests.
Set `process.env` values directly for test isolation.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/runtime/ActionsConfigProvider.test.ts
```

- [ ] **Step 3: Implement ActionsConfigProvider**

Create a `ConfigProvider` using `ConfigProvider.fromFlat` or
`ConfigProvider.make`:

- Transform config key: replace spaces with `_`, uppercase,
  prepend `INPUT_`
- Read from `process.env`
- Treat empty string as missing
- This is a flat provider — no nested path support

Export: `ActionsConfigProvider: ConfigProvider`

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/runtime/ActionsConfigProvider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/
git commit -m "feat: add ActionsConfigProvider for GitHub Actions inputs"
```

---

## Task 4: ActionsLogger

**Files:**

- Create: `src/runtime/ActionsLogger.ts`
- Create: `src/runtime/ActionsLogger.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (capture stdout to verify output):

1. `Effect.logDebug("msg")` → stdout contains `::debug::msg`
2. `Effect.logInfo("msg")` → stdout contains `msg` (no prefix)
3. `Effect.logWarning("msg")` → stdout contains `::warning::msg`
4. `Effect.logError("msg")` → stdout contains `::error::msg`
5. `Effect.logError("msg").pipe(Effect.annotateLogs({ file: "a.ts", line: "1" }))`
   → stdout contains `::error file=a.ts,line=1::msg`
6. Messages with special chars are properly escaped

Use `WorkflowCommand` from Task 1.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/runtime/ActionsLogger.test.ts
```

- [ ] **Step 3: Implement ActionsLogger**

Create a `Logger.make` implementation:

- Read log level from the `FiberId` / log span
- Map to appropriate workflow command via `WorkflowCommand`
- Read `file`, `line`, `col` from log annotations for annotation
  properties
- `Info` level writes plain text to stdout (no command prefix)
- All other levels use `WorkflowCommand.issue`

Export: `ActionsLogger: Logger.Logger<unknown, unknown>`

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/runtime/ActionsLogger.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/
git commit -m "feat: add ActionsLogger for workflow command logging"
```

---

## Task 5: Rewrite ActionOutputsLive

**Files:**

- Modify: `src/layers/ActionOutputsLive.ts`
- Modify: `src/layers/ActionOutputsLive.test.ts`

- [ ] **Step 1: Update tests**

Replace tests that depend on `ActionsCore` mock with tests that
verify file writes and stdout output:

1. `set("key", "value")` appends `key=value\n` to `GITHUB_OUTPUT`
   file
2. `set("key", "multi\nline")` uses delimiter format in
   `GITHUB_OUTPUT`
3. `setJson("key", { a: 1 }, schema)` writes JSON-encoded value
4. `summary("# Title")` appends to `GITHUB_STEP_SUMMARY` file
5. `exportVariable("FOO", "bar")` appends to `GITHUB_ENV` file
   and sets `process.env.FOO`
6. `addPath("/bin")` appends to `GITHUB_PATH` file and updates
   `process.env.PATH`
7. `setSecret("token")` writes `::add-mask::token` to stdout
8. `setFailed("msg")` writes `::error::msg` to stdout and sets
   `process.exitCode = 1`

Use temp files for `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH`,
`GITHUB_STEP_SUMMARY` env vars in tests.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/ActionOutputsLive.test.ts
```

- [ ] **Step 3: Rewrite ActionOutputsLive**

Remove `ActionsCore` dependency. Use:

- `RuntimeFile.append` for file writes
- `WorkflowCommand.issue` for `setSecret` and `setFailed`
- `@effect/platform-node` `FileSystem` (via RuntimeFile)
- `Schema.encode` for `setJson`

Layer dependencies: `FileSystem` (from `@effect/platform-node`)

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/ActionOutputsLive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/ActionOutputsLive.ts src/layers/ActionOutputsLive.test.ts
git commit -m "feat: rewrite ActionOutputsLive without @actions/core"
```

---

## Task 6: Rewrite ActionStateLive

**Files:**

- Modify: `src/layers/ActionStateLive.ts`
- Modify: `src/layers/ActionStateLive.test.ts`

- [ ] **Step 1: Update tests**

Replace `ActionsCore` mock with file-based tests:

1. `save("key", value, schema)` encodes via schema and appends to
   `GITHUB_STATE` file
2. `get("key", schema)` reads from `process.env[`STATE_key`]` and
   decodes via schema
3. `get` for missing key → `ActionStateError`
4. `getOptional` for missing key → `Option.none()`
5. `getOptional` for present key → `Option.some(decoded)`

Note: GitHub Actions sets state values as env vars with `STATE_`
prefix for the post phase. The `save` method writes to
`GITHUB_STATE` file; the `get` method reads from
`process.env.STATE_{key}`.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/ActionStateLive.test.ts
```

- [ ] **Step 3: Rewrite ActionStateLive**

Remove `ActionsCore` dependency. Use:

- `RuntimeFile.append("GITHUB_STATE", key, encodedValue)` for save
- `process.env[`STATE_${key}`]` for reads
- `Schema.decodeUnknown` / `Schema.encode` for serde

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/ActionStateLive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/ActionStateLive.ts src/layers/ActionStateLive.test.ts
git commit -m "feat: rewrite ActionStateLive without @actions/core"
```

---

## Task 7: Rewrite ActionLoggerLive (reduced interface)

**Files:**

- Modify: `src/services/ActionLogger.ts`
- Modify: `src/layers/ActionLoggerLive.ts`
- Modify: `src/layers/ActionLoggerLive.test.ts`
- Modify: `src/layers/ActionLoggerTest.ts`
- Modify: `src/layers/ActionLoggerTest.test.ts`

- [ ] **Step 1: Update ActionLogger service interface**

Reduce to `group` and `withBuffer` only. Remove:

- `annotationError`
- `annotationWarning`
- `annotationNotice`

These are now handled by the `ActionsLogger` (Effect Logger) via
log annotations.

- [ ] **Step 2: Update ActionLoggerTest**

Remove annotation methods from the test layer state tracking.
Keep `group` and `withBuffer` tracking.

- [ ] **Step 3: Update tests**

Delete all annotation test blocks from `ActionLoggerLive.test.ts`
(the `annotationError`, `annotationWarning`, `annotationNotice`
describe blocks). These are replaced by Effect log annotations
handled in `ActionsLogger` (Task 4).

Keep/update tests for:

1. `group("name", effect)` writes `::group::name` before and
   `::endgroup::` after the effect
2. `withBuffer("label", successEffect)` — logs are suppressed on
   success
3. `withBuffer("label", failEffect)` — buffered logs flush on
   failure

- [ ] **Step 4: Rewrite ActionLoggerLive**

Remove `ActionsCore` dependency. Use:

- `WorkflowCommand.issue("group", {}, name)` for group start
- `WorkflowCommand.issue("endgroup", {}, "")` for group end
- Internal buffering logic for `withBuffer`

`withBuffer` uses Effect's native `Logger.minimumLogLevel` to
determine buffering behavior (replacing the old `CurrentLogLevel`
FiberRef). The `CurrentLogLevel` FiberRef and `setLogLevel`
export are removed — consumers use
`Logger.withMinimumLogLevel` instead.

Remove `CurrentLogLevel` export from `ActionLoggerLive.ts`. Update
`ActionLoggerTest.ts` imports accordingly.

- [ ] **Step 5: Run all ActionLogger tests**

```bash
pnpm vitest run src/layers/ActionLoggerLive.test.ts src/layers/ActionLoggerTest.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/services/ActionLogger.ts src/layers/ActionLogger*.ts
git commit -m "feat: reduce ActionLogger to group + withBuffer, remove @actions/core"
```

---

## Task 8: Rewrite CommandRunnerLive

**Files:**

- Modify: `src/layers/CommandRunnerLive.ts`
- Modify: `src/layers/CommandRunnerLive.test.ts`

- [ ] **Step 1: Update tests**

Replace `ActionsExec` mock with tests using `@effect/platform`
`Command`:

1. Successful command returns stdout
2. Failed command returns `CommandRunnerError` with exit code
3. `cwd` option sets working directory
4. `env` option sets environment variables
5. `silent` option suppresses output
6. stderr captured in error

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/CommandRunnerLive.test.ts
```

- [ ] **Step 3: Rewrite CommandRunnerLive**

Remove `ActionsExec` dependency. Use `@effect/platform` `Command`:

- `Command.make(commandLine, ...args)`
- `Command.workingDirectory(cwd)`
- `Command.env(env)`
- `Command.string` for stdout capture
- `Command.exitCode` for exit code

Layer dependencies: `CommandExecutor` from `@effect/platform-node`

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/CommandRunnerLive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/CommandRunnerLive.ts src/layers/CommandRunnerLive.test.ts
git commit -m "feat: rewrite CommandRunnerLive with @effect/platform Command"
```

---

## Task 9: Rewrite GitHubClientLive

**Files:**

- Modify: `src/layers/GitHubClientLive.ts`
- Modify: `src/layers/GitHubClientLive.test.ts`

- [ ] **Step 1: Update tests**

Replace `ActionsGitHub` mock with tests using direct Octokit:

1. `rest("operation", fn)` calls the function with Octokit and
   extracts `.data`
2. `graphql(query, vars)` calls `octokit.graphql`
3. `paginate("operation", fn, opts)` iterates pages
4. `repo` reads `GITHUB_REPOSITORY` env var and splits `owner/repo`
5. Missing `GITHUB_TOKEN` → `GitHubClientError`
6. Missing `GITHUB_REPOSITORY` → `GitHubClientError`

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/GitHubClientLive.test.ts
```

- [ ] **Step 3: Rewrite GitHubClientLive**

Remove `ActionsGitHub` dependency. Use direct `@octokit/rest`:

```typescript
import { Octokit } from "@octokit/rest"

const token = process.env.GITHUB_TOKEN
const octokit = new Octokit({ auth: token })
```

The service interface is unchanged — `rest`, `graphql`, `paginate`,
`repo` all keep the same signatures.

**Breaking change:** `GitHubClientLive` changes from a factory
function `(token: string) => Layer` to a self-contained `Layer`
that reads `GITHUB_TOKEN` from `process.env` internally. This
means all call sites of `GitHubClientLive(token)` must be updated
to just `GitHubClientLive`.

- [ ] **Step 4: Update all GitHubClientLive call sites**

Grep for `GitHubClientLive(` across the codebase and update:

```bash
grep -r "GitHubClientLive(" src/
```

Change `GitHubClientLive(token)` → `GitHubClientLive` everywhere.
This includes `src/Action.ts` and any Live layer that constructs
the GitHub client layer.

- [ ] **Step 5: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/GitHubClientLive.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/layers/GitHubClientLive.ts src/layers/GitHubClientLive.test.ts
git commit -m "feat: rewrite GitHubClientLive with direct @octokit/rest"
```

---

## Task 10: Rewrite ToolInstaller Service + Live Layer

**Files:**

- Modify: `src/services/ToolInstaller.ts`
- Modify: `src/layers/ToolInstallerLive.ts`
- Modify: `src/layers/ToolInstallerLive.test.ts`
- Modify: `src/layers/ToolInstallerTest.ts`

- [ ] **Step 0: Update ToolInstaller service interface**

The existing interface has `install`, `isCached`,
`installAndAddToPath`, `installBinary`,
`installBinaryAndAddToPath`. Replace with the low-level interface
from the spec: `find`, `download`, `extractTar`, `extractZip`,
`cacheDir`, `cacheFile`.

Update `src/services/ToolInstaller.ts` and
`src/layers/ToolInstallerTest.ts` to match.

- [ ] **Step 1: Update tests**

Replace `ActionsToolCache` mock with filesystem-based tests:

1. `find("node", "20.0.0")` checks
   `RUNNER_TOOL_CACHE/node/20.0.0/x64` directory existence
2. `find` returns `Option.none()` when tool not cached
3. `download(url)` fetches URL and writes to temp file
4. `extractTar(file)` runs `tar` via Command
5. `extractZip(file)` runs `unzip` via Command
6. `cacheDir(dir, tool, version)` copies to
   `RUNNER_TOOL_CACHE/tool/version/x64`
7. `cacheFile(file, name, tool, version)` copies single file to
   cache

Use temp directories for `RUNNER_TOOL_CACHE` in tests.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/ToolInstallerLive.test.ts
```

- [ ] **Step 3: Rewrite ToolInstallerLive**

Remove `ActionsToolCache` and `ActionsCore` dependencies. Use:

- Native `fetch` for `download`
- `@effect/platform` `Command` for `extractTar` (`tar xzf`)
  and `extractZip` (`unzip`)
- `@effect/platform-node` `FileSystem` for cache dir management
- `process.env.RUNNER_TOOL_CACHE` for cache root
- Architecture suffix: `process.arch` (e.g., `x64`, `arm64`)

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/ToolInstallerLive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/ToolInstallerLive.ts src/layers/ToolInstallerLive.test.ts
git commit -m "feat: rewrite ToolInstallerLive with native fetch + Command"
```

---

## Task 11: Rewrite ActionCache Service + Live Layer

**Files:**

- Modify: `src/services/ActionCache.ts`
- Modify: `src/layers/ActionCacheLive.ts`
- Modify: `src/layers/ActionCacheLive.test.ts`
- Modify: `src/layers/ActionCacheTest.ts`

This is the most complex task. The internal cache protocol uses
`ACTIONS_CACHE_URL` and `ACTIONS_RUNTIME_TOKEN`.

- [ ] **Step 0: Update ActionCache service interface**

The existing interface has `save(key, paths)` (note: key first),
`restore` returning `CacheHit`, and `withCache`. Replace with
the spec interface: `save(paths, key)` and `restore` returning
`Option<string>`. Drop `withCache` — consumers compose this
themselves.

Update `src/services/ActionCache.ts` and
`src/layers/ActionCacheTest.ts` to match.

- [ ] **Step 1: Update tests**

Replace `ActionsCache` mock with HTTP mock tests:

1. `restore(paths, "key-v1")` sends GET to cache API, extracts
   archive on hit
2. `restore` returns `Option.none()` on cache miss (204)
3. `save(paths, "key-v1")` creates tar archive, reserves cache
   ID, uploads chunks, commits
4. Large archives split into chunks (32MB each) with
   `Content-Range` headers
5. Missing `ACTIONS_CACHE_URL` → `CacheError`
6. Missing `ACTIONS_RUNTIME_TOKEN` → `CacheError`
7. Upload failure → `CacheError`

Mock the cache service HTTP endpoints for testing. Use
`@effect/platform` `HttpClient` test utilities or manual mocking.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/layers/ActionCacheLive.test.ts
```

- [ ] **Step 3: Implement cache protocol**

Internal protocol (from `@actions/cache` source):

**Restore:**

1. `GET {ACTIONS_CACHE_URL}_apis/artifactcache/cache`
   with query: `keys=key-v1&version={hash}`
   - 200 + JSON with `archiveLocation` → download + extract
   - 204 → cache miss

**Save:**

1. `POST {ACTIONS_CACHE_URL}_apis/artifactcache/caches`
   body: `{ key, version }` → returns `{ cacheId }`
2. `PATCH {ACTIONS_CACHE_URL}_apis/artifactcache/caches/{cacheId}`
   headers: `Content-Type: application/octet-stream`,
   `Content-Range: bytes start-end/*`
   body: chunk data (32MB max per request)
3. `POST {ACTIONS_CACHE_URL}_apis/artifactcache/caches/{cacheId}`
   body: `{ size }` → commit

**Auth:** `Authorization: Bearer {ACTIONS_RUNTIME_TOKEN}` on all
requests. Also `Accept: application/json;api-version=6.0-preview.1`.

**Version hash:** SHA256 of paths joined with `|`, used for cache
version isolation.

Use native `fetch` for all HTTP calls. Use `@effect/platform`
`Command` to create/extract tar archives.

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/layers/ActionCacheLive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/layers/ActionCacheLive.ts src/layers/ActionCacheLive.test.ts
git commit -m "feat: rewrite ActionCacheLive with native cache protocol"
```

---

## Task 12: ActionsRuntime Convenience Layer

**Files:**

- Create: `src/runtime/ActionsRuntime.ts`
- Create: `src/runtime/ActionsRuntime.test.ts`

- [ ] **Step 1: Write failing tests**

1. Program using `Config.string("name")` reads `INPUT_NAME` when
   provided with `ActionsRuntime.Default`
2. Program using `Effect.log("msg")` emits workflow command when
   provided with `ActionsRuntime.Default`
3. Program using `ActionOutputs` can set outputs when provided
   with `ActionsRuntime.Default`
4. Program using `ActionState` can save/get state when provided
   with `ActionsRuntime.Default`
5. Program using `ActionLogger.group` works when provided with
   `ActionsRuntime.Default`
6. `ActionsRuntime.Default` includes `ActionEnvironment`

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/runtime/ActionsRuntime.test.ts
```

- [ ] **Step 3: Implement ActionsRuntime**

```typescript
import { Layer } from "effect"

const ActionsRuntime = {
  Default: Layer.mergeAll(
    ActionOutputsLive,
    ActionStateLive,
    ActionLoggerLive,
    ActionEnvironmentLive,
  ).pipe(
    Layer.provideMerge(/* FileSystem, ConfigProvider, Logger */),
  ),
}
```

Wire together:

- `ConfigProvider.layer(ActionsConfigProvider)` for inputs
- `Logger.replace(Logger.defaultLogger, ActionsLogger)` for logging
- `NodeFileSystem.layer` for file operations
- `NodeCommandExecutor.layer` for command execution
- All core Live layers

Export as `ActionsRuntime` with `Default` property.

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm vitest run src/runtime/ActionsRuntime.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/ActionsRuntime.ts src/runtime/ActionsRuntime.test.ts
git commit -m "feat: add ActionsRuntime convenience layer"
```

---

## Task 13: Update Action Namespace

**Files:**

- Modify: `src/Action.ts`
- Modify: `src/Action.test.ts`

- [ ] **Step 1: Update Action.run**

Rewrite `Action.run` to use `ActionsRuntime.Default` instead of
manually wiring `ActionsCoreLive` + individual Live layers.

The `run` function should:

- Accept a program `Effect<A, E, R>`
- Provide `ActionsRuntime.Default`
- Handle errors with `setFailed` via `ActionOutputs`
- Support optional additional layers for GitHub API, caching, etc.

- [ ] **Step 2: Update Action.parseInputs**

Replace `ActionInputs` service usage with `Config` API:

- `parseInputs` takes a record of `Config` definitions
- Reads all inputs via `ConfigProvider`
- Returns typed, validated result

- [ ] **Step 3: Remove Action.makeLogger, setLogLevel, resolveLogLevel**

These are replaced by the `ActionsLogger` (Effect Logger). Log level
is controlled via `Logger.minimumLogLevel` in Effect.

- [ ] **Step 4: Update tests**

Update `Action.test.ts` to use the new API. Replace `ActionsCore`
mocks with env var setup and stdout capture.

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run src/Action.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/Action.ts src/Action.test.ts
git commit -m "feat: update Action namespace for new runtime"
```

---

## Task 14: Verify OctokitAuthApp (likely no-op)

**Files:**

- Review: `src/layers/OctokitAuthAppLive.ts`

`OctokitAuthAppLive` already imports directly from
`@octokit/auth-app` — it does not use `@actions/github`. This task
is a verification step: confirm no changes are needed now that
`@octokit/auth-app` is a direct dependency instead of optional
peer.

- [ ] **Step 1: Verify OctokitAuthAppLive imports**

Read `src/layers/OctokitAuthAppLive.ts` and confirm it imports
from `@octokit/auth-app` directly (not via `@actions/github`).
If so, no code changes needed.

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/layers/OctokitAuthAppLive.test.ts
```

- [ ] **Step 3: Commit (only if changes were needed)**

---

## Task 15: Delete Removed Services and Cleanup

**Files:**

- Delete: all files listed in "Deleted Files" above
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Delete removed wrapper services**

```bash
rm src/services/ActionsCore.ts
rm src/services/ActionsExec.ts
rm src/services/ActionsGitHub.ts
rm src/services/ActionsCache.ts
rm src/services/ActionsToolCache.ts
rm src/services/OctokitAuthApp.ts
rm src/services/ActionInputs.ts
```

- [ ] **Step 2: Delete removed Live layers and test files**

```bash
rm src/layers/ActionsCoreLive.ts
rm src/layers/ActionsExecLive.ts
rm src/layers/ActionsGitHubLive.ts
rm src/layers/ActionsCacheLive.ts
rm src/layers/ActionsToolCacheLive.ts
rm src/layers/ActionsPlatformLive.ts
rm src/layers/ActionInputsLive.ts
rm src/layers/ActionInputsTest.ts
```

Also delete any corresponding test files for the removed layers
(e.g., `ActionsCoreLive.test.ts`, etc.).

- [ ] **Step 3: Delete removed test files**

Delete any test files for the removed services/layers.

- [ ] **Step 4: Update package.json**

Remove from peerDependencies + peerDependenciesMeta:

- `@actions/core`
- `@actions/exec`
- `@actions/github`
- `@actions/cache`
- `@actions/tool-cache`
- `@octokit/auth-app` (now direct dep)

Add to dependencies:

- `@octokit/rest`
- `@octokit/auth-app`

Ensure `@effect/platform` and `@effect/platform-node` remain as
required peers (already present via catalog:silkPeers).

Remove from devDependencies:

- `@actions/core`
- `@actions/exec`
- `@actions/github`
- `@actions/cache`
- `@actions/tool-cache`

- [ ] **Step 5: Update src/index.ts**

Remove exports for deleted services:

- `ActionsCore`, `ActionsCoreLive`
- `ActionsExec`, `ActionsExecLive`
- `ActionsGitHub`, `ActionsGitHubLive`
- `ActionsCache`, `ActionsCacheLive`
- `ActionsToolCache`, `ActionsToolCacheLive`
- `ActionsPlatformLive`
- `ActionInputs`, `ActionInputsLive`, `ActionInputsTest`
- `OctokitAuthApp`, `OctokitAuthAppLive`

Add exports for new runtime modules:

- `ActionsRuntime`
- `ActionsConfigProvider`
- `ActionsLogger` (the Logger instance)
- `WorkflowCommand` (if consumers need direct access)
- `RuntimeFile` (if consumers need direct access)
- `RuntimeEnvironmentError`

- [ ] **Step 6: Run full test suite**

```bash
pnpm run test
```

Fix any import errors in remaining test files that referenced
deleted services.

- [ ] **Step 7: Run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 8: Run lint**

```bash
pnpm run lint:fix
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat!: remove @actions/* dependencies, add ActionsRuntime

BREAKING CHANGE: All @actions/* peer dependencies removed.
Services rewritten to use native ESM implementations.
New ActionsRuntime.Default layer replaces ActionsCoreLive.
ActionInputs replaced by ConfigProvider.
ActionLogger reduced to group + withBuffer.
@octokit/rest and @octokit/auth-app are now direct dependencies."
```

---

## Task 16: Verify Build

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

```bash
pnpm run build
```

- [ ] **Step 2: Run full test suite with coverage**

```bash
pnpm run test:coverage
```

Verify 80% threshold met.

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 4: Run lint**

```bash
pnpm run lint
```

- [ ] **Step 5: Fix any remaining issues**

Address any build, type, lint, or coverage failures.

- [ ] **Step 6: Final commit if needed**

```bash
git add -A
git commit -m "fix: address build and test issues"
```
