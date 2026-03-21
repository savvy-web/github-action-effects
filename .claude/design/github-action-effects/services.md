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
  - ./layers.md
  - ./errors-and-schemas.md
  - ./testing-strategy.md
dependencies: []
---

# Services

All service interface descriptions, namespace objects, and utility namespaces
for `@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview and design decisions.
See [layers.md](./layers.md) for live and test layer implementations.

---

## Overview

Twenty-nine service modules plus five namespace/utility objects, each
independently usable. `Action.run()` automatically provides
`ActionsRuntime.Default`, which includes `NodeFileSystem.layer` from
`@effect/platform-node`. Programs also have access to Node.js platform
services (`FileSystem`, `Path`, etc.) without needing to provide them
manually.

Inputs are read via Effect's `Config` API backed by `ActionsConfigProvider`
(not a dedicated service). Logging is handled by the Effect Logger backed
by `ActionsLogger`.

```text
@savvy-web/github-action-effects
├── Runtime Layer (replaces @actions/*)
│   ├── WorkflowCommand     — ::command:: protocol formatter with escaping
│   ├── RuntimeFile          — Env file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
│   ├── ActionsConfigProvider — ConfigProvider reading INPUT_* env vars
│   ├── ActionsLogger        — Effect Logger emitting workflow commands
│   └── ActionsRuntime       — Single convenience Layer wiring everything
│
├── Core Action I/O
│   ├── ActionLogger        — Log groups + buffered output
│   ├── ActionOutputs       — Typed output setting and step summaries
│   ├── ActionState         — Schema-serialized state for multi-phase actions
│   ├── ActionEnvironment   — Schema-validated GitHub/Runner context variables
│   └── ActionCache         — Cache save/restore via V2 Twirp protocol (ACTIONS_RESULTS_URL)
│
├── Git Operations
│   ├── GitBranch           — Branch management via Git Data API
│   ├── GitCommit           — Verified commits via Git Data API
│   └── GitTag              — Tag management via Git refs API
│
├── GitHub API
│   ├── GitHubClient        — Direct @octokit/rest, self-contained Layer
│   ├── GitHubGraphQL       — GitHub GraphQL API operations
│   ├── GitHubRelease       — Create/manage GitHub releases
│   ├── GitHubIssue         — Issue management + linked issues
│   ├── GitHubApp           — GitHub App authentication lifecycle
│   ├── OctokitAuthApp      — Wrapper for @octokit/auth-app createAppAuth
│   ├── CheckRun            — Check runs with bracket pattern
│   ├── PullRequest         — PR lifecycle (CRUD, merge, labels, reviewers)
│   ├── PullRequestComment  — Sticky (upsert) PR comments
│   ├── RateLimiter         — Rate limit awareness and retry
│   └── WorkflowDispatch    — Trigger and monitor workflow runs
│
├── Build Tooling
│   ├── CommandRunner       — Structured shell execution (node:child_process)
│   ├── NpmRegistry         — npm registry queries
│   ├── PackagePublish      — Multi-registry package publishing
│   ├── PackageManagerAdapter — Unified PM operations (npm/pnpm/yarn/bun)
│   ├── WorkspaceDetector   — Monorepo workspace detection
│   ├── ToolInstaller       — Low-level tool binary management (native fetch + child_process)
│   ├── ChangesetAnalyzer   — Changeset file parsing and generation
│   ├── ConfigLoader        — JSON/JSONC/YAML config loading with schema validation
│   ├── TokenPermissionChecker — Token permission validation + enforcement
│   └── DryRun              — Mutation interception for dry-run mode
│
├── Namespace Objects
│   ├── Action.*            — run, resolveLogLevel, formatCause
│   └── GithubMarkdown.*    — table, heading, details, bold, code, etc.
│
└── Utility Namespaces
    ├── AutoMerge           — PR auto-merge enable/disable via GraphQL
    ├── SemverResolver      — Semver comparison, parsing, resolution
    ├── ErrorAccumulator    — Process-all-collect-failures pattern
    └── ReportBuilder       — Fluent markdown report builder
```

---

## Namespace Objects

The public API uses namespace objects to group related functions under a
single export, reducing barrel clutter and improving discoverability.

**`Action`** (from `src/Action.ts`) groups top-level action helpers:

- `Action.run(program)` / `Action.run(program, options?)` -- Run a GitHub
  Action program with standard boilerplate. Provides `ActionsRuntime.Default`
  (ConfigProvider, Logger, ActionLogger, ActionOutputs, ActionState,
  ActionEnvironment, FileSystem). Wraps the program in
  `ActionLogger.withBuffer` for buffered output. Catches all errors via
  `Effect.catchAllCause` and emits `::error::` workflow commands using
  `WorkflowCommand.issue`. `options` accepts a `layer` field for additional
  services to merge.
- `Action.resolveLogLevel(input)` -- Resolve LogLevelInput to ActionLogLevel
- `Action.formatCause(cause)` -- Extract human-readable error message from an
  Effect `Cause` using a `[Tag] message` fallback chain

**`GithubMarkdown`** (from `src/utils/GithubMarkdown.ts`) groups GFM builders:

- `GithubMarkdown.table`, `GithubMarkdown.heading`, `GithubMarkdown.details`,
  `GithubMarkdown.bold`, `GithubMarkdown.code`, `GithubMarkdown.codeBlock`,
  `GithubMarkdown.link`, `GithubMarkdown.list`, `GithubMarkdown.checklist`,
  `GithubMarkdown.rule`, `GithubMarkdown.statusIcon`

All functions are defined directly as properties of their namespace objects.
They are not exported individually from the barrel -- only the namespace
objects are exported.

---

## Module Details

### ActionLogger Service

Service for action-specific logging operations beyond the Effect Logger.
The core log-level routing is handled by the Effect Logger installed via
`ActionsRuntime.Default` (the `ActionsLogger` module). This service provides
additional GitHub Actions-specific operations.

**Interface:**

- `group(name, effect)` -- Wraps an effect in a collapsible log group
  (`::group::` / `::endgroup::`)
- `withBuffer(label, effect)` -- Captures verbose output in memory; on
  success the buffer is discarded; on failure the buffer is flushed before
  the error is reported. At Debug log level, passes through without buffering.

**Error type:** (none -- logger never fails)

### ActionOutputs Service

Sets action outputs and writes step summaries via RuntimeFile and
WorkflowCommand.

**Interface:**

- `set(name, value)` -- Set an output value (appends to `GITHUB_OUTPUT` file)
- `setJson(name, value, schema)` -- Serialize and set a JSON output
- `summary(content)` -- Write to `$GITHUB_STEP_SUMMARY`
- `exportVariable(name, value)` -- Export an environment variable (appends to
  `GITHUB_ENV` file)
- `addPath(path)` -- Add to PATH (appends to `GITHUB_PATH` file)
- `setFailed(message)` -- Mark the action as failed via `::error::` command
  and `process.exitCode = 1`
- `setSecret(value)` -- Mask a runtime value in logs via `::add-mask::` command

**Error type:** `ActionOutputError`

### ActionState Service

Schema-serialized state passing for multi-phase GitHub Actions (pre/main/post).
Persists via `GITHUB_STATE` file, reads from `STATE_*` environment variables.

**Interface:**

- `save(key, value, schema)` -- Serialize via `Schema.encode`, persist to
  `GITHUB_STATE` file via RuntimeFile
- `get(key, schema)` -- Read `STATE_*` env var, parse, and decode via
  `Schema.decode`
- `getOptional(key, schema)` -- Like `get` but returns `Option<A>` when empty

**Error type:** `ActionStateError`

### ActionEnvironment Service

Read-only, schema-validated access to GitHub Actions context variables.

**Interface:**

- `get(name)` -- Read environment variable, return string or fail
- `getOptional(name)` -- Read env var, return Option
- `github` -- Lazy accessor returning validated `GitHubContext`
- `runner` -- Lazy accessor returning validated `RunnerContext`

**Error type:** `ActionEnvironmentError`

### ActionCache Service

Cache save/restore using the GitHub Actions V2 Twirp RPC protocol at
`ACTIONS_RESULTS_URL/twirp/github.actions.results.api.v1.CacheService/`.
Reads `ACTIONS_RESULTS_URL` and `ACTIONS_RUNTIME_TOKEN` from the environment.
Uses `@azure/storage-blob` for Azure Blob Storage upload/download. No
dependency on `@actions/cache`.

**Interface:**

- `save(paths, key)` -- Create tar.gz archive of paths, upload via
  `CreateCacheEntry` + Azure Blob `BlockBlobClient.uploadFile()` +
  `FinalizeCacheEntryUpload`
- `restore(paths, primaryKey, restoreKeys?)` -- Look up cache entry via
  `GetCacheEntryDownloadURL`, download via Azure Blob `BlobClient.downloadToFile()`,
  extract. Returns `Option<string>` (matched key or none on miss)

**Error type:** `ActionCacheError`

### GitBranch Service

Branch management via the GitHub Git Data API.

**Interface:**

- `create(name, sha)` -- Create a new branch pointing at SHA
- `exists(name)` -- Check whether a branch exists
- `delete(name)` -- Delete a branch
- `getSha(name)` -- Get the current SHA of a branch
- `reset(name, sha)` -- Force-reset a branch to a new SHA

**Error type:** `GitBranchError`

### GitCommit Service

Create verified commits via the GitHub Git Data API. Supports both file
additions/updates and file deletions.

**Interface:**

- `createTree(entries, baseTree?)` -- Create a tree object, return SHA
- `createCommit(message, treeSha, parentShas)` -- Create a commit object
- `updateRef(ref, sha, force?)` -- Update a ref to point at a new SHA
- `commitFiles(branch, message, files)` -- Convenience: commit files to a
  branch. Each file is a `FileChange` (union of `FileChangeContent` for
  add/update and `FileChangeDeletion` with `sha: null` for deletion)

**Error type:** `GitCommitError`

### GitTag Service

Tag management via the GitHub Git refs API.

**Interface:**

- `create(tag, sha)` -- Create a lightweight tag pointing at the given SHA
- `delete(tag)` -- Delete a tag
- `list(prefix?)` -- List tags, optionally filtered by prefix. Returns `Array<TagRef>`
- `resolve(tag)` -- Resolve a tag to its SHA

**Types:** `TagRef` -- `{ tag: string; sha: string }`

**Error type:** `GitTagError`

### GitHubClient Service

Authenticated Octokit provider for GitHub REST and GraphQL API operations.
Uses `@octokit/rest` directly. Self-contained Layer that reads `GITHUB_TOKEN`
from `process.env` (not a factory function).

**Interface:**

- `rest(operation, fn)` -- Execute a REST API call via callback
- `graphql(query, variables?)` -- Execute a GraphQL query
- `paginate(operation, fn, options?)` -- Paginate a REST API call, collecting
  all results. Options: `{ perPage?, maxPages? }`
- `repo` -- Get the repository context (`{ owner, repo }`) from
  `GITHUB_REPOSITORY` env var

**Error type:** `GitHubClientError` -- includes `retryable` flag for 429/5xx

### GitHubGraphQL Service

GitHub GraphQL API operations as a separate service.

**Interface:**

- `query(operation, queryString, variables?)` -- Execute a GraphQL query
- `mutation(operation, mutationString, variables?)` -- Execute a GraphQL mutation

**Error type:** `GitHubGraphQLError`

### GitHubRelease Service

Create and manage GitHub releases via the REST API.

**Interface:**

- `create(options)` -- Create a new release. Returns `ReleaseData`
- `uploadAsset(releaseId, name, data, contentType)` -- Upload an asset.
  Returns `ReleaseAsset`
- `getByTag(tag)` -- Get a release by tag name. Returns `ReleaseData`
- `list(options?)` -- List releases. Returns `Array<ReleaseData>`

**Types:** `ReleaseData`, `ReleaseAsset`

**Error type:** `GitHubReleaseError`

### GitHubIssue Service

Issue management and linked issue queries.

**Interface:**

- `list(options?)` -- List issues filtered by state, labels, milestone
- `close(issueNumber, reason?)` -- Close an issue
- `comment(issueNumber, body)` -- Add a comment
- `getLinkedIssues(prNumber)` -- Get issues linked to a PR via closing references

**Types:** `IssueData` -- `{ number, title, state, labels }`

**Error type:** `GitHubIssueError`

### GitHubApp Service

GitHub App authentication lifecycle. Uses `OctokitAuthApp` for JWT-based
app auth and native `fetch` for installation resolution and token revocation.

**Interface:**

- `generateToken(appId, privateKey, installationId?)` -- Generate an
  installation token. Auto-resolves installation ID from `GITHUB_REPOSITORY`
  if not provided. Returns `InstallationToken`
- `revokeToken(token)` -- Revoke a previously generated token via REST API
- `botIdentity(appSlug?)` -- Get bot identity for commit attribution. Returns
  `BotIdentity` (`{ name, email }`)
- `withToken(appId, privateKey, effect)` -- Bracket: generate, run, revoke

**Types:** `InstallationToken` (Schema), `BotIdentity` (interface)

**Error type:** `GitHubAppError`

### OctokitAuthApp Service

Wrapper service for `@octokit/auth-app`. This is the only service that
imports `@octokit/auth-app` directly (via `OctokitAuthAppLive`).

**Interface:**

- `createAppAuth(options)` -- Create an `AppAuth` callable for JWT-based
  app and installation authentication

**Types:** `AppAuth` -- callable interface for app/installation auth

### CheckRun Service

Create, update, and complete GitHub check runs with bracket pattern.

**Interface:**

- `create(name, headSha)` -- Create a new check run. Returns check run ID
- `update(checkRunId, output)` -- Update with output content
- `complete(checkRunId, conclusion, output?)` -- Complete with conclusion
- `withCheckRun(name, headSha, effect)` -- Bracket: create, run, complete

**Types:** `CheckRunConclusion`, `AnnotationLevel`, `CheckRunAnnotation`,
`CheckRunOutput`

**Error type:** `CheckRunError`

### PullRequest Service

Full pull request lifecycle management.

**Interface:**

- `get(number)` -- Get a single PR by number
- `list(options?)` -- List PRs matching filters
- `create(options)` -- Create a new PR
- `update(number, options)` -- Update an existing PR
- `getOrCreate(options)` -- Find existing PR for head->base or create one
- `merge(number, options?)` -- Immediately merge a PR
- `addLabels(number, labels)` -- Add labels to a PR
- `requestReviewers(number, options)` -- Request reviewers

**Types:** `PullRequestInfo`, `PullRequestListOptions`

**Error type:** `PullRequestError`

### PullRequestComment Service

Sticky (upsert) PR comments with marker-based idempotency.

**Interface:**

- `create(prNumber, body)` -- Create a new comment
- `upsert(prNumber, markerKey, body)` -- Create or update sticky comment
- `find(prNumber, markerKey)` -- Find comment by marker
- `delete(prNumber, commentId)` -- Delete a comment by ID

**Types:** `CommentRecord` -- `{ id: number; body: string }`

**Error type:** `PullRequestCommentError`

### RateLimiter Service

GitHub API rate limit awareness and retry.

**Interface:**

- `checkRest()` -- Check current REST API rate limit status
- `checkGraphQL()` -- Check current GraphQL API rate limit status
- `withRateLimit(effect)` -- Guard with rate limit check; waits if below 10%
- `withRetry(effect, options?)` -- Retry with exponential backoff

**Error type:** `RateLimitError`

### WorkflowDispatch Service

Trigger and monitor GitHub Actions workflow runs.

**Interface:**

- `dispatch(workflow, ref, inputs?)` -- Trigger a workflow run
- `dispatchAndWait(workflow, ref, inputs?, pollOptions?)` -- Trigger and poll
  until completion
- `getRunStatus(runId)` -- Get status of a workflow run

**Types:** `WorkflowRunStatus`, `PollOptions`

**Error type:** `WorkflowDispatchError`

### CommandRunner Service

Structured shell command execution via `node:child_process` `spawn`.

**Interface:**

- `exec(command, args?, options?)` -- Run a command, return exit code
- `execCapture(command, args?, options?)` -- Run and capture stdout/stderr
- `execJson(command, args?, schema?)` -- Run, parse stdout as JSON, validate
- `execLines(command, args?, options?)` -- Run and return stdout split into lines

**Types:** `ExecOptions` -- `{ cwd?, env?, timeout?, silent? }`,
`ExecOutput` -- `{ exitCode, stdout, stderr }`

**Error type:** `CommandRunnerError`

### NpmRegistry Service

Query npm registry for package metadata.

**Interface:**

- `getLatestVersion(pkg)` -- Get latest version string
- `getDistTags(pkg)` -- Get dist-tags record
- `getPackageInfo(pkg, version?)` -- Get package info
- `getVersions(pkg)` -- Get all version strings

**Error type:** `NpmRegistryError`

### PackagePublish Service

Multi-registry npm package publishing workflow.

**Interface:**

- `setupAuth(registry, token)` -- Configure npm authentication
- `pack(packageDir)` -- Pack into tarball and compute digest
- `publish(packageDir, options?)` -- Publish to a registry
- `verifyIntegrity(packageName, version, expectedDigest)` -- Verify integrity
- `publishToRegistries(packageDir, registries)` -- Publish to multiple registries

**Types:** `PackResult`, `RegistryTarget`

**Error type:** `PackagePublishError`

### PackageManagerAdapter Service

Unified package manager operations supporting npm, pnpm, yarn, bun, and deno.

**Interface:**

- `detect()` -- Detect the package manager
- `install(options?)` -- Install dependencies
- `getCachePaths()` -- Get cache directory paths
- `getLockfilePaths()` -- Get lockfile paths
- `exec(args, options?)` -- Execute a command via the detected PM

**Error type:** `PackageManagerError`

### WorkspaceDetector Service

Monorepo workspace detection.

**Interface:**

- `detect()` -- Detect workspace type and patterns
- `listPackages()` -- List all workspace packages
- `getPackage(nameOrPath)` -- Get a specific package

**Error type:** `WorkspaceDetectorError`

### ToolInstaller Service

Low-level primitives for downloading, extracting, and caching tool binaries.
Uses `node:https`/`node:http` for downloads and `node:child_process` for
extraction (tar/unzip/PowerShell). Tool cache lives at `RUNNER_TOOL_CACHE`
(or a temp directory fallback). No dependency on `@actions/tool-cache`.

**Interface:**

- `find(tool, version)` -- Look up a cached tool. Returns `Option<string>`
- `download(url)` -- Download a URL to a temporary file via `node:https`/`node:http` with redirect following (up to 10 hops), 3-minute socket timeout, User-Agent header, and `Effect.retry` with exponential backoff for transient errors
- `extractTar(file, dest?, flags?)` -- Extract a tar archive via `tar` command
- `extractZip(file, dest?)` -- Extract a zip archive via `unzip` (non-Windows) or PowerShell `System.IO.Compression.ZipFile` (Windows, pwsh → powershell fallback)
- `cacheDir(sourceDir, tool, version)` -- Cache a directory as a tool
- `cacheFile(sourceFile, targetFile, tool, version)` -- Cache a single file

**Error type:** `ToolInstallerError`

### ChangesetAnalyzer Service

Changeset file parsing and generation.

**Interface:**

- `parseAll(dir?)` -- Parse all changeset files
- `hasChangesets(dir?)` -- Check if any changeset files exist
- `generate(packages, summary, dir?)` -- Generate a changeset file

**Error type:** `ChangesetError`

### ConfigLoader Service

Load and validate configuration files with Effect Schema.

**Interface:**

- `loadJson(path, schema)` -- Load and validate a JSON config file
- `loadJsonc(path, schema)` -- Load JSONC
- `loadYaml(path, schema)` -- Load YAML
- `exists(path)` -- Check if a config file exists

**Error type:** `ConfigLoaderError`

### DryRun Service

Cross-cutting mutation interception for dry-run mode.

**Interface:**

- `isDryRun` -- Check if dry-run mode is active
- `guard(label, effect, fallback)` -- If dry-run: log, return fallback.
  Otherwise: execute the effect.

**Error type:** (none)

### TokenPermissionChecker Service

Check GitHub token permissions against requirements.

**Interface:**

- `check(requirements)` -- Compare granted vs required
- `assertSufficient(requirements)` -- Fail if missing permissions
- `assertExact(requirements)` -- Fail if missing OR extra permissions
- `warnOverPermissioned(requirements)` -- Log warnings for extras

**Error type:** `TokenPermissionError`

---

## Utility Namespaces

### GithubMarkdown (Pure Functions)

Standalone GFM builders -- no Effect service, just pure functions.

- `table(headers, rows)`, `heading(text, level)`, `details(summary, content)`,
  `rule()`, `statusIcon(status)`, `link(text, url)`, `list(items)`,
  `checklist(items)`, `bold(text)`, `code(text)`, `codeBlock(text, language)`

### SemverResolver (Pure Effects)

Wraps the `semver-effect` package with Effect error handling.

- `compare(a, b)`, `satisfies(version, range)`, `latestInRange(versions, range)`,
  `increment(version, bump)`, `parse(version)`

**Error type:** `SemverResolverError`

### AutoMerge (Effect Functions)

PR auto-merge operations via GitHub GraphQL API. Depends on `GitHubGraphQL`.

- `enable(prNodeId, mergeMethod?)`, `disable(prNodeId)`

### ErrorAccumulator (Pure Effects)

Process-all-collect-failures pattern.

- `forEachAccumulate(items, fn)`, `forEachAccumulateConcurrent(items, fn, concurrency)`

**Types:** `AccumulateResult` -- `{ successes, failures }`

### ReportBuilder (Fluent Builder)

Composable markdown report builder with multiple output targets.

- `ReportBuilder.create(title)`, `report.stat(label, value)`,
  `report.section(title, content)`, `report.details(summary, content)`,
  `report.toMarkdown()`, `report.toSummary()`, `report.toComment(prNumber, markerKey)`,
  `report.toCheckRun(checkRunId)`

---

## Action.run Helper

Top-level convenience function that eliminates boilerplate for wiring Effect
programs into GitHub Action entry points.

**Signatures:**

```typescript
Action.run(program): Promise<void>
Action.run(program, options: ActionRunOptions): Promise<void>
```

**`ActionRunOptions` interface:**

```typescript
interface ActionRunOptions<R = never> {
  layer?: Layer.Layer<R, never, never>    // additional services to merge
}
```

**Behavior:**

1. Provides `ActionsRuntime.Default` which includes:
   - `ActionsConfigProvider` -- reads `INPUT_*` env vars via Effect `Config` API
   - `ActionsLogger` -- Effect Logger emitting workflow commands
   - `ActionLoggerLive` -- group + withBuffer service
   - `ActionOutputsLive` -- output setting via RuntimeFile + WorkflowCommand
   - `ActionStateLive` -- state via RuntimeFile + `STATE_*` env vars
   - `ActionEnvironmentLive` -- validated GitHub/runner context
   - `NodeFileSystem.layer` -- Node.js filesystem from `@effect/platform-node`
2. Wraps the program in `ActionLogger.withBuffer("action", program)` for
   buffered output
3. Catches all errors (via `Effect.catchAllCause`) and emits `::error::`
   workflow commands using `WorkflowCommand.issue`, plus JS stack trace and
   Effect span trace via `::debug::`
4. Sets `process.exitCode = 1` on failure
5. Runs the program with `Effect.runPromise()`
6. Merges any user-supplied `layer` with the core layers
7. Last-resort catch on the promise sets `process.exitCode = 1` if even
   the error handler fails

---

## Current State

All 29 service modules and 5 namespace/utility objects are fully defined with
interfaces, error types, and live layer implementations. All services also have
test layer implementations. The runtime layer (`src/runtime/`) provides native
implementations of the GitHub Actions protocol, eliminating all `@actions/*`
dependencies.

## Rationale

Services are designed as independent, composable Effect modules so that action
authors can pick only what they need without pulling in unnecessary dependencies.
The namespace object pattern keeps the public API surface small while remaining
compatible with api-extractor.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [layers.md](./layers.md) -- Live and test layer implementations
- [errors-and-schemas.md](./errors-and-schemas.md) -- Error types and schema patterns
- [testing-strategy.md](./testing-strategy.md) -- Testing approach and coverage
