---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-18
last-synced: 2026-03-18
completeness: 90
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

Twenty-seven service modules plus six namespace/utility objects, each
independently usable. `Action.run()` automatically provides
`NodeContext.layer` from `@effect/platform-node`, so programs also have
access to Node.js platform services (`FileSystem`, `Path`, `Terminal`,
`CommandExecutor`, `WorkerManager`) without needing to provide them manually.

```text
@savvy-web/github-action-effects
├── Core Action I/O
│   ├── ActionInputs        — Schema-validated input reading
│   ├── ActionLogger        — Structured logging with buffering
│   ├── ActionOutputs       — Typed output setting and step summaries
│   ├── ActionState         — Schema-serialized state for multi-phase actions
│   ├── ActionEnvironment   — Schema-validated GitHub/Runner context variables
│   └── ActionCache         — Effect wrapper for @actions/cache save/restore
│
├── Git Operations
│   ├── GitBranch           — Branch management via Git Data API
│   ├── GitCommit           — Verified commits via Git Data API
│   └── GitTag              — Tag management via Git refs API
│
├── GitHub API
│   ├── GitHubClient        — Authenticated Octokit provider with pagination
│   ├── GitHubGraphQL       — GitHub GraphQL API operations
│   ├── GitHubRelease       — Create/manage GitHub releases
│   ├── GitHubIssue         — Issue management + linked issues
│   ├── GitHubApp           — GitHub App authentication lifecycle
│   ├── CheckRun            — Check runs with bracket pattern
│   ├── PullRequestComment  — Sticky (upsert) PR comments
│   ├── RateLimiter         — Rate limit awareness and retry
│   └── WorkflowDispatch    — Trigger and monitor workflow runs
│
├── Build Tooling
│   ├── CommandRunner       — Structured shell command execution
│   ├── NpmRegistry         — npm registry queries
│   ├── PackagePublish      — Multi-registry package publishing
│   ├── PackageManagerAdapter — Unified PM operations (npm/pnpm/yarn/bun)
│   ├── WorkspaceDetector   — Monorepo workspace detection
│   ├── ToolInstaller       — Binary download, cache, PATH management
│   ├── ChangesetAnalyzer   — Changeset file parsing and generation
│   ├── ConfigLoader        — JSON/JSONC/YAML config loading with schema validation
│   └── DryRun              — Mutation interception for dry-run mode
│
├── Observability
│   └── ActionTelemetry     — Metric recording and span attributes
│
├── Namespace Objects
│   ├── Action.*            — run, parseInputs, makeLogger, setLogLevel, resolveLogLevel
│   └── GithubMarkdown.*    — table, heading, details, bold, code, etc.
│
└── Utility Namespaces
    ├── AutoMerge           — PR auto-merge enable/disable via GraphQL
    ├── SemverResolver      — Semver comparison, parsing, resolution
    ├── ErrorAccumulator    — Process-all-collect-failures pattern
    ├── GitHubOtelAttributes — Map GitHub env vars to OTel resource attributes
    ├── ReportBuilder       — Fluent markdown report builder
    └── TelemetryReport     — Render spans/metrics as GFM markdown
```

---

## Namespace Objects

The public API uses namespace objects to group related functions under a
single export, reducing barrel clutter and improving discoverability.

**`Action`** (from `src/Action.ts`) groups top-level action helpers:

- `Action.run(program)` / `Action.run(program, layer)` -- Run a GitHub Action
  program with standard boilerplate (provides core layers, catches errors).
  Automatically parses OTel inputs and wires up exporter when enabled.
- `Action.parseInputs(config, crossValidate?)` -- Read and validate all inputs
  at once from a config record
- `Action.makeLogger()` -- Create the Effect Logger for GitHub Actions
- `Action.setLogLevel(level)` -- Set action log level for current scope
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

### ActionInputs Service

Reads and validates GitHub Action inputs using Effect Schema.

**Interface:**

- `get(name, schema)` -- Read a single input, validate against schema
- `getOptional(name, schema)` -- Read optional input, return Option
- `getSecret(name, schema)` -- Read input, mark as secret (masked in logs)
- `getJson(name, schema)` -- Read input as JSON string, parse and validate
- `getMultiline(name, itemSchema)` -- Read multiline input, split on newlines,
  trim each line, filter blanks and comment lines (starting with `#`), validate
  each item against `itemSchema`. Live layer uses `core.getMultilineInput()`,
  test layer splits from string. Returns `Effect<Array<A>, ActionInputError>`
- `getBoolean(name)` -- Read boolean input. Live layer uses
  `core.getBooleanInput()`. Returns `Effect<boolean, ActionInputError>`
- `getBooleanOptional(name, defaultValue)` -- Read boolean input or return
  default if not provided. Returns `Effect<boolean, ActionInputError>`

**Batch helper:** `Action.parseInputs(config, crossValidate?)` -- Read all
inputs at once from a config object (`Record<string, InputConfig>`). Each
`InputConfig` specifies `{ schema, required?, default?, multiline?, secret?,
json? }`. After reading all inputs, passes the parsed object to an optional
cross-validation function. Returns the fully typed parsed object. Errors from
individual inputs and cross-validation unified under `ActionInputError`.
Requires `ActionInputs` in the Effect context. Implementation is inlined in
`Action.ts`.

**Shared decode helpers:** `decodeInput` and `decodeJsonInput` are extracted
to `layers/internal/decodeInput.ts` and shared by both `ActionInputsLive`
and `ActionInputsTest`, eliminating duplication of schema validation logic.

**Error type:** `ActionInputError`

### ActionLogger Service

Custom Effect Logger with three log levels and a standardized `log-level`
action input. Separates user-facing output (always visible via `core.info()`)
from internal diagnostics (GitHub-gated via `core.debug()`).

**Log Levels:**

| Level | Behavior | Use Case |
| --------- | ------------------------------------------------ | --------------------------------- |
| `info` | Buffered. Shows only outcome summaries. On failure, flushes captured verbose buffer at the failure point. | Default. Clean, LLM-friendly. |
| `verbose` | Unbuffered milestones. Start/finish markers for operations. | CI debugging, progress tracking. |
| `debug` | Everything. Full command output, input/output values, internal state. | Deep debugging. |

**Interface:**

- Implements `Effect.Logger` -- plugs into Effect's logging system
- `group(name, effect)` -- Wraps an effect in a collapsible log group
- `withBuffer(label, effect)` -- Captures verbose output in memory; flushes on failure
- `annotationError(message, properties?)` -- Error annotation via `core.error()`
- `annotationWarning(message, properties?)` -- Warning annotation via `core.warning()`
- `annotationNotice(message, properties?)` -- Notice annotation via `core.notice()`

**Error type:** (none -- logger never fails)

### ActionOutputs Service

Sets action outputs and writes step summaries.

**Interface:**

- `set(name, value)` -- Set an output value
- `setJson(name, value, schema)` -- Serialize and set a JSON output
- `summary(content)` -- Write to `$GITHUB_STEP_SUMMARY`
- `exportVariable(name, value)` -- Export an environment variable
- `addPath(path)` -- Add to PATH
- `setFailed(message)` -- Mark the action as failed via `core.setFailed()`
- `setSecret(value)` -- Mask a runtime value in logs via `core.setSecret()`

**Error type:** `ActionOutputError`

### ActionState Service

Schema-serialized state passing for multi-phase GitHub Actions (pre/main/post).

**Interface:**

- `save(key, value, schema)` -- Serialize via `Schema.encode`, persist with
  `core.saveState()`
- `get(key, schema)` -- Read, parse, and decode via `Schema.decode`
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

Effect wrapper around `@actions/cache` for save/restore.

**Interface:**

- `save(key, paths)` -- Save paths to cache under key
- `restore(key, restoreKeys?, paths?)` -- Restore from cache, returns `CacheHit`
- `withCache(key, paths, effect)` -- Bracket: restore, run effect, save if miss

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

- `createTree(entries, baseTree?)` -- Create a tree object, return SHA.
  Each entry is a `TreeEntry` (union of `TreeEntryContent` for add/update
  and `TreeEntryDeletion` with `sha: null` for deletion)
- `createCommit(message, treeSha, parentShas)` -- Create a commit object, return SHA
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

**Interface:**

- `rest(operation, fn)` -- Execute a REST API call via callback
- `graphql(query, variables?)` -- Execute a GraphQL query
- `paginate(operation, fn, options?)` -- Paginate a REST API call, collecting
  all results. Options: `{ perPage?, maxPages? }`
- `repo` -- Get the repository context (`{ owner, repo }`)

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

- `create(options)` -- Create a new release. Options: `{ tag, name, body,
  draft?, prerelease?, generateReleaseNotes? }`. Returns `ReleaseData`
- `uploadAsset(releaseId, name, data, contentType)` -- Upload an asset.
  Returns `ReleaseAsset`
- `getByTag(tag)` -- Get a release by tag name. Returns `ReleaseData`
- `list(options?)` -- List releases. Options: `{ perPage?, maxPages? }`.
  Returns `Array<ReleaseData>`

**Types:**

- `ReleaseData` -- `{ id, tag, name, body, draft, prerelease, uploadUrl }`
- `ReleaseAsset` -- `{ id, name, url, size }`

**Error type:** `GitHubReleaseError`

### GitHubIssue Service

Issue management and linked issue queries.

**Interface:**

- `list(options?)` -- List issues filtered by state, labels, milestone.
  Returns `Array<IssueData>`
- `close(issueNumber, reason?)` -- Close an issue with optional reason
  (`"completed"` | `"not_planned"`)
- `comment(issueNumber, body)` -- Add a comment. Returns `{ id: number }`
- `getLinkedIssues(prNumber)` -- Get issues linked to a PR via closing
  references. Returns `Array<{ number, title }>`

**Types:** `IssueData` -- `{ number, title, state, labels }`

**Error type:** `GitHubIssueError`

### GitHubApp Service

GitHub App authentication lifecycle.

**Interface:**

- `generateToken(appId, privateKey, installationId?)` -- Generate an
  installation token. Returns `InstallationToken`
- `revokeToken(token)` -- Revoke a previously generated token
- `withToken(appId, privateKey, effect)` -- Bracket: generate, run, revoke

**Types:** `InstallationToken` -- `{ token, expiresAt, installationId, permissions }`

**Error type:** `GitHubAppError`

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

### PullRequestComment Service

Sticky (upsert) PR comments with marker-based idempotency.

**Interface:**

- `create(prNumber, body)` -- Create a new comment. Returns comment ID
- `upsert(prNumber, markerKey, body)` -- Create or update sticky comment
- `find(prNumber, markerKey)` -- Find comment by marker. Returns `Option<CommentRecord>`
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
  until completion. Returns the run conclusion
- `getRunStatus(runId)` -- Get status of a workflow run

**Types:** `WorkflowRunStatus` -- `{ status, conclusion }`,
`PollOptions` -- `{ intervalMs?, timeoutMs? }`

**Error type:** `WorkflowDispatchError`

### CommandRunner Service

Structured shell command execution with stdout/stderr capture.

**Interface:**

- `exec(command, args?, options?)` -- Run a command, return exit code
- `execCapture(command, args?, options?)` -- Run and capture stdout/stderr.
  Returns `ExecOutput`
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
- `getPackageInfo(pkg, version?)` -- Get package info. Returns `NpmPackageInfo`
- `getVersions(pkg)` -- Get all version strings

**Error type:** `NpmRegistryError`

### PackagePublish Service

Multi-registry npm package publishing workflow.

**Interface:**

- `setupAuth(registry, token)` -- Configure npm authentication for a registry
- `pack(packageDir)` -- Pack into tarball and compute digest. Returns `PackResult`
- `publish(packageDir, options?)` -- Publish to a registry. Options:
  `{ registry?, tag?, access?, provenance? }`
- `verifyIntegrity(packageName, version, expectedDigest)` -- Verify published
  package integrity hash
- `publishToRegistries(packageDir, registries)` -- Publish to multiple
  registries in sequence

**Types:** `PackResult` -- `{ tarball, digest }`,
`RegistryTarget` -- `{ registry, token, tag?, access? }`

**Error type:** `PackagePublishError`

### PackageManagerAdapter Service

Unified package manager operations supporting npm, pnpm, yarn, bun, and deno.

**Interface:**

- `detect()` -- Detect the package manager. Returns `PackageManagerInfo`
- `install(options?)` -- Install dependencies. Options: `{ frozen?, cwd? }`
- `getCachePaths()` -- Get cache directory paths
- `getLockfilePaths()` -- Get lockfile paths
- `exec(args, options?)` -- Execute a command via the detected PM

**Types:** `InstallOptions` -- `{ frozen?, cwd? }`

**Error type:** `PackageManagerError`

### WorkspaceDetector Service

Monorepo workspace detection.

**Interface:**

- `detect()` -- Detect workspace type and patterns. Returns `WorkspaceInfo`
- `listPackages()` -- List all workspace packages. Returns `Array<WorkspacePackage>`
- `getPackage(nameOrPath)` -- Get a specific package by name or path

**Error type:** `WorkspaceDetectorError`

### ToolInstaller Service

Download, extract, cache, and add tool binaries to PATH.

**Interface:**

- `install(name, version, downloadUrl, options?)` -- Download and cache.
  Returns cached tool path
- `isCached(name, version)` -- Check if tool is cached
- `installAndAddToPath(name, version, downloadUrl, options?)` -- Install and
  add to PATH

**Types:** `ToolInstallOptions` -- `{ archiveType?, binSubPath?, platform?, arch? }`

**Error type:** `ToolInstallerError`

### ChangesetAnalyzer Service

Changeset file parsing and generation.

**Interface:**

- `parseAll(dir?)` -- Parse all changeset files. Returns `Array<Changeset>`
- `hasChangesets(dir?)` -- Check if any changeset files exist
- `generate(packages, summary, dir?)` -- Generate a changeset file. Returns
  `ChangesetFile`

**Error type:** `ChangesetError`

### ConfigLoader Service

Load and validate configuration files with Effect Schema.

**Interface:**

- `loadJson(path, schema)` -- Load and validate a JSON config file
- `loadJsonc(path, schema)` -- Load JSONC (requires `jsonc-parser` peer)
- `loadYaml(path, schema)` -- Load YAML (requires `yaml` peer)
- `exists(path)` -- Check if a config file exists

**Error type:** `ConfigLoaderError`

### DryRun Service

Cross-cutting mutation interception for dry-run mode.

**Interface:**

- `isDryRun` -- Check if dry-run mode is active
- `guard(label, effect, fallback)` -- If dry-run: log `[DRY-RUN] {label}`,
  return fallback. Otherwise: execute the effect.

**Error type:** (none)

### ActionTelemetry Service

Numeric metric recording and span attribute annotation.

**Interface:**

- `metric(name, value, unit?)` -- Record a numeric metric value
- `attribute(key, value)` -- Annotate the current span with a key-value attribute
- `getMetrics()` -- Retrieve all recorded metrics. Returns `Array<MetricData>`

**Error type:** (none -- never fails)

### TokenPermissionChecker Service

Check GitHub token permissions against requirements with three enforcement
modes.

**Interface:**

- `check(requirements)` -- Compare granted vs required. Returns
  `PermissionCheckResult`
- `assertSufficient(requirements)` -- Fail if missing permissions
- `assertExact(requirements)` -- Fail if missing OR extra permissions
- `warnOverPermissioned(requirements)` -- Log warnings for extras; never fails

Permission levels are hierarchical: `admin > write > read`. A token with
`write` satisfies a `read` requirement.

**Error type:** `TokenPermissionError`

---

## Utility Namespaces

### GithubMarkdown (Pure Functions)

Standalone GFM builders -- no Effect service, just pure functions.

- `table(headers, rows)` -- Build a GFM table
- `heading(text, level)` -- Heading with optional level
- `details(summary, content)` -- Collapsible `<details>` block
- `rule()` -- Horizontal rule
- `statusIcon(status)` -- Map status to emoji
- `link(text, url)` -- Markdown link
- `list(items)` -- Bulleted list
- `checklist(items)` -- Checkbox list
- `bold(text)` -- Bold text
- `code(text)` -- Inline code
- `codeBlock(text, language)` -- Fenced code block

### SemverResolver (Pure Effects)

Wraps the `semver` npm package with Effect error handling.

- `compare(a, b)` -- Compare two semver versions. Returns `-1 | 0 | 1`
- `satisfies(version, range)` -- Check if version satisfies a range
- `latestInRange(versions, range)` -- Find highest version satisfying range
- `increment(version, bump)` -- Increment by `"major" | "minor" | "patch" | "prerelease"`
- `parse(version)` -- Parse into `{ major, minor, patch, prerelease?, build? }`

**Error type:** `SemverResolverError`

### AutoMerge (Effect Functions)

PR auto-merge operations via GitHub GraphQL API. Depends on `GitHubGraphQL`.

- `enable(prNodeId, mergeMethod?)` -- Enable auto-merge. Default method: `"SQUASH"`
- `disable(prNodeId)` -- Disable auto-merge

**Error type:** `GitHubGraphQLError` (from underlying service)

### ErrorAccumulator (Pure Effects)

Process-all-collect-failures pattern. Error channel is `never` -- all errors
captured in the failures array.

- `forEachAccumulate(items, fn)` -- Process sequentially. Returns
  `AccumulateResult<A, B, E>`
- `forEachAccumulateConcurrent(items, fn, concurrency)` -- Process with
  concurrency control

**Types:** `AccumulateResult` -- `{ successes, failures }`

### GitHubOtelAttributes (Pure Function)

Map GitHub Actions environment variables to OpenTelemetry semantic convention
resource attributes.

- `fromEnvironment(env?)` -- Read `GITHUB_*` and `RUNNER_*` env vars, return
  `Record<string, string>` with OTel attribute keys

### ReportBuilder (Fluent Builder)

Composable markdown report builder with multiple output targets.

- `ReportBuilder.create(title)` -- Create a new `Report` instance
- `report.stat(label, value)` -- Add a key-value summary row
- `report.section(title, content)` -- Add a titled section
- `report.details(summary, content)` -- Add a collapsible block
- `report.timings(spans)` -- Add a timing table from span summaries
- `report.toMarkdown()` -- Render to markdown string
- `report.toSummary()` -- Write to step summary via `ActionOutputs`
- `report.toComment(prNumber, markerKey)` -- Upsert as PR comment
- `report.toCheckRun(checkRunId)` -- Set as check run output

**Types:** `Report` (interface)

### TelemetryReport (Effect Functions)

Render telemetry span data and metrics as GitHub-Flavored Markdown.

- `fromSpans(spans, metrics?)` -- Render as GFM markdown string
- `toSummary(spans, metrics?)` -- Write to step summary via `ActionOutputs`
- `toComment(prNumber, markerKey, spans, metrics?)` -- Upsert as PR comment
- `toCheckRun(checkRunId, spans, metrics?)` -- Set as check run output

**Types:** `SpanSummary` -- `{ name, duration, status, parentName?, attributes }`

---

## Action.run Helper

Top-level convenience function that eliminates boilerplate for wiring Effect
programs into GitHub Action entry points.

**Signatures:**

```typescript
Action.run(program): void          // uses all standard Live layers
Action.run(program, layer): void   // merge additional layers with standard layers
```

**Behavior:**

1. Provides core Live layers (ActionInputsLive, ActionLoggerLive,
   ActionOutputsLive, NodeContext.layer) plus ActionLoggerLayer (the
   Effect Logger integration). NodeContext.layer provides Node.js platform
   services from `@effect/platform-node`.
2. Parses OTel inputs (`otel-enabled`, `otel-endpoint`, `otel-protocol`,
   `otel-headers`) and conditionally wires up OtelExporterLive or
   InMemoryTracer based on resolved config.
3. Catches all errors (via `Effect.catchAllCause`) and routes them to
   `core.setFailed()` with `Cause.pretty` formatting. (Planned: upgrade to
   use `Action.formatCause` for structured `[Tag] message` output, plus JS
   stack trace and Effect span trace via `core.debug()`.)
4. Runs the program with `Effect.runPromise()`
5. Merges any user-supplied `layer` with the core layers
6. Last-resort catch on the promise sets `process.exitCode = 1` if even
   `setFailed` fails

**Note:** `ActionStateLive` is not included in the core layers because not
all actions need multi-phase state; users who need it pass it as the second
`layer` argument.

---

## Current State

All 27 service modules and 6 namespace/utility objects are fully defined with
interfaces, error types, and both live and test layer implementations. The
service catalog is stable and actively used by downstream actions.

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
