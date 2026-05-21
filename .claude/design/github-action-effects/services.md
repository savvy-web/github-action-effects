---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-05-20
last-synced: 2026-05-20
completeness: 97
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

Thirty-seven service modules plus six namespace/utility objects, each
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
│   ├── WorkflowCommand      — ::command:: protocol formatter with escaping
│   ├── RuntimeFile          — Env file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
│   ├── ActionsConfigProvider — ConfigProvider reading INPUT_* env vars
│   ├── ActionsLogger        — Effect Logger emitting workflow commands
│   ├── ActionsRuntime       — Single convenience Layer wiring everything
│   └── Step                 — Step-buffered logging (withStep, success, collapse, groupStep)
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
│   ├── GitHubClient        — Direct @octokit/rest; namespace layer (fromEnv/fromToken/fromApp)
│   ├── GitHubGraphQL       — GitHub GraphQL API operations
│   ├── GitHubRelease       — Create/manage GitHub releases + assets
│   ├── GitHubIssue         — Issue management + linked issues
│   ├── GitHubApp           — GitHub App authentication lifecycle
│   ├── OctokitAuthApp      — Wrapper for @octokit/auth-app createAppAuth
│   ├── CheckRun            — Check runs with bracket pattern + get
│   ├── PullRequest         — PR lifecycle (CRUD, merge, labels, reviewers, files)
│   ├── PullRequestComment  — Sticky (upsert) PR comments
│   ├── RateLimiter         — Rate limit awareness and retry
│   ├── WorkflowDispatch    — Trigger and monitor workflow runs
│   ├── GitHubContent       — Read repository file contents at a ref
│   ├── GitHubCommit        — Read the commit graph (get/list/compare)
│   └── GitHubArtifactMetadata — GitHub Packages artifact-metadata storage records
│
├── Build Tooling
│   ├── CommandRunner       — Structured shell execution (node:child_process)
│   ├── NpmRegistry         — npm registry queries + per-registry integrity probe
│   ├── PackagePublish      — Multi-registry publishing (pack/publish/publishTarball/dryRun/publishIdempotent)
│   ├── PackageManagerAdapter — Unified PM operations (npm/pnpm/yarn/bun)
│   ├── WorkspaceDetector   — Monorepo workspace detection
│   ├── ToolInstaller       — Low-level tool binary management (native fetch + child_process)
│   ├── ChangesetAnalyzer   — Changeset file parsing and generation
│   ├── ConfigLoader        — JSON/JSONC/YAML config loading with schema validation
│   ├── TokenPermissionChecker — Token permission validation + enforcement
│   └── DryRun              — Mutation interception for dry-run mode
│
├── Attestation
│   ├── Attest              — End-to-end attest/sign/upload + listForSubject
│   ├── OidcTokenIssuer     — GitHub Actions OIDC token for Sigstore
│   ├── SigstoreSigner      — Sign an in-toto statement → Sigstore bundle
│   └── Sbom                — CycloneDX 1.5 BOM generation and serialization
│
├── Namespace Objects
│   ├── Action.*            — run, resolveLogLevel, formatCause
│   ├── GitHubToken.*       — provision, client, dispose (App-token lifecycle)
│   └── GithubMarkdown.*    — table, heading, details, bold, code, etc.
│
└── Utility Namespaces
    ├── AutoMerge           — PR auto-merge enable/disable via GraphQL
    ├── SemverResolver      — Semver comparison, parsing, resolution
    ├── ErrorAccumulator    — Process-all-collect-failures pattern
    ├── ReportBuilder       — Fluent markdown report builder
    └── RegistryClassifier  — URL-safe registry detection and display utilities
```

---

## Namespace Objects

The public API uses namespace objects to group related functions under a
single export, reducing barrel clutter and improving discoverability.

**`Action`** (from `src/Action.ts`) groups top-level action helpers:

- `Action.run(program)` / `Action.run(program, options?)` -- Run a GitHub Action program with standard boilerplate. Provides `ActionsRuntime.Default` (ConfigProvider, Logger, ActionLogger, ActionOutputs, ActionState, ActionEnvironment, FileSystem). Wraps the program in `ActionLogger.withBuffer` for buffered output. Catches all errors via `Effect.catchAllCause` and emits `::error::` workflow commands using `WorkflowCommand.issue`. `options` accepts a `layer` field for additional services to merge.
- `Action.resolveLogLevel(input)` -- Resolve LogLevelInput to ActionLogLevel
- `Action.formatCause(cause)` -- Extract human-readable error message from an Effect `Cause` using a `[Tag] message` fallback chain

**`GitHubToken`** (from `src/GitHubToken.ts`) groups phase-oriented helpers for
the GitHub App installation-token lifecycle. See [GitHubToken Lifecycle](#githubtoken-lifecycle)
below for the full pre/main/post data flow.

- `GitHubToken.provision(options?)` -- `pre.ts`: generate an installation token, best-effort resolve App identity by passing the token to `resolveAppIdentity` (so `GET /users` runs authenticated at 5000 req/hr rather than unauthenticated), enrich the token with identity fields, persist it to `ActionState`. Failure of identity resolution is wrapped in `Effect.option` so a network hiccup degrades gracefully.
- `GitHubToken.client()` -- `main.ts`: build a `GitHubClient` layer from the persisted token.
- `GitHubToken.dispose()` -- `post.ts`: revoke the persisted token.
- `GitHubToken.read()` -- `Effect<InstallationToken, ActionStateError, ActionState>`: read the raw persisted token from `ActionState`. Available in any phase after `provision`.
- `GitHubToken.botIdentity()` -- `Effect<BotIdentity, ActionStateError, ActionState>`: read the token and derive a `BotIdentity` via `formatBotIdentity`. Produces a verified identity when `appSlug` and `appUserId` were resolved by `provision`; falls back to `github-actions[bot]` otherwise.

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

- `group(name, effect)` -- Wraps an effect in a collapsible log group (`::group::` / `::endgroup::`). If the wrapped effect fails and a buffer is active, the buffered diagnostics are flushed *inside* the group, before `::endgroup::`, so a failure's context stays within its own group.
- `withBuffer(label, effect)` -- Captures verbose output in memory; on success the buffer is discarded; on failure the buffer is flushed before the error is reported. At Debug log level, passes through without buffering.

The buffer is fiber-scoped (a module-level `FiberRef`), so nested `group`
calls and the outer `withBuffer` boundary share one buffer. Each buffered chunk
prints exactly once — the innermost failing boundary flushes it and clears the
entries; `withBuffer`'s flush is the catch-all for output produced outside any
group. See [layers.md](./layers.md) for the mechanics.

**Error type:** (none -- logger never fails)

### ActionOutputs Service

Sets action outputs and writes step summaries via RuntimeFile and
WorkflowCommand.

**Interface:**

- `set(name, value)` -- Set an output value (appends to `GITHUB_OUTPUT` file)
- `setJson(name, value, schema)` -- Serialize and set a JSON output
- `summary(content)` -- Write to `$GITHUB_STEP_SUMMARY`
- `exportVariable(name, value)` -- Export an environment variable (appends to `GITHUB_ENV` file)
- `addPath(path)` -- Add to PATH (appends to `GITHUB_PATH` file)
- `setFailed(message)` -- Mark the action as failed via `::error::` command and `process.exitCode = 1`
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

- `save(paths, key)` -- Create tar.gz archive of paths with `-P` (absolute-names) to preserve absolute paths, upload via `CreateCacheEntry` + Azure Blob `BlockBlobClient.uploadFile()` + `FinalizeCacheEntryUpload`
- `restore(paths, primaryKey, restoreKeys?)` -- Look up cache entry via `GetCacheEntryDownloadURL`, download via Azure Blob `BlobClient.downloadToFile()`, extract with `-P` to restore absolute paths correctly. Returns `Option<string>` (matched key or none on miss)

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
- `commitFiles(branch, message, files)` -- Convenience: commit files to a branch. Each file is a `FileChange` (union of `FileChangeContent` for add/update and `FileChangeDeletion` with `sha: null` for deletion)

**Error type:** `GitCommitError`

### GitTag Service

Tag management via the GitHub Git refs API.

**Interface:**

- `create(tag, sha)` -- Create a lightweight tag pointing at the given SHA
- `delete(tag)` -- Delete a tag
- `list(prefix?)` -- List tags, optionally filtered by prefix. Returns `Array<TagRef>`
- `resolve(tag)` -- Resolve a tag to its commit SHA. Annotated tags are unwrapped: when the ref object type is `tag` the implementation dereferences the tag object to retrieve the target commit SHA, so the result is always a commit SHA regardless of tag type

**Types:** `TagRef` -- `{ tag: string; sha: string }`

**Error type:** `GitTagError`

### GitHubClient Service

Authenticated Octokit provider for GitHub REST and GraphQL API operations.
Uses `@octokit/rest` directly.

**Interface:**

- `rest(operation, fn)` -- Execute a REST API call via callback
- `graphql(query, variables?)` -- Execute a GraphQL query
- `paginate(operation, fn, options?)` -- Paginate a REST API call, collecting all results. Options: `{ perPage?, maxPages? }`
- `repo` -- Get the repository context (`{ owner, repo }`) from `GITHUB_REPOSITORY` env var

**Error type:** `GitHubClientError` -- includes `retryable` flag for 429/5xx

**Construction.** The `GitHubClientLive` layer is a namespace object, not a
plain const — the construction surface chooses the client's identity. See
[layers.md](./layers.md) for `fromEnv` (ambient `GITHUB_TOKEN`), `fromToken`
(explicit token) and `fromApp` (generates an App installation token). For a
token shared across pre/main/post phases, use the `GitHubToken` namespace.

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
- `uploadAsset(releaseId, name, data, contentType)` -- Upload an asset. Returns `ReleaseAsset`
- `getByTag(tag)` -- Get a release by tag name. Returns `ReleaseData`
- `list(options?)` -- List releases. Returns `Array<ReleaseData>`
- `updateRelease(releaseId, options)` -- Update an existing release's fields. Returns updated `ReleaseData`
- `listReleaseAssets(releaseId)` -- List all assets attached to a release. Returns `Array<ReleaseAsset>`

**Types:** `ReleaseData`, `ReleaseAsset`

**Error type:** `GitHubReleaseError`

### GitHubIssue Service

Issue management and linked issue queries.

**Interface:**

- `list(options?)` -- List issues filtered by state, labels, milestone
- `get(issueNumber)` -- Get a single issue by number
- `close(issueNumber, reason?)` -- Close an issue
- `comment(issueNumber, body)` -- Add a comment
- `getLinkedIssues(prNumber)` -- Get issues linked to a PR via closing references

**Types:** `IssueData` -- `{ number, title, state, labels, htmlUrl?, nodeId? }`

**Error type:** `GitHubIssueError`

### GitHubApp Service

GitHub App authentication lifecycle. Uses `OctokitAuthApp` for JWT-based
app auth and native `fetch` for installation resolution, identity lookup and
token revocation.

**Interface:**

- `generateToken(appId, privateKey, installationId?)` -- Generate an installation token. Auto-resolves installation ID from `GITHUB_REPOSITORY` if not provided. Returns `InstallationToken` (without identity fields; call `resolveAppIdentity` separately to enrich).
- `revokeToken(token)` -- Revoke a previously generated token via REST API.
- `resolveAppIdentity(appId, privateKey, installationToken?)` -- Resolve the App's public identity via `GET /app` (App JWT) then `GET /users/<slug>[bot]`. Returns `{ appSlug, appUserId, appName }`. Fails with `GitHubAppError { operation: "identity" }` on HTTP error or when `GET /app` returns no slug. `GET /users` is a public endpoint that rejects the App JWT; when `installationToken` is supplied it is used as `Bearer` auth (5000 req/hr), otherwise the lookup runs unauthenticated (60 req/hr per IP).
- `botIdentity(source?)` -- Derive a `BotIdentity` for commit/tag attribution. `source` is `{ appSlug?, appUserId? }`. When both are present returns a verified identity with the numeric-ID email prefix GitHub recognises; otherwise falls back to the well-known `github-actions[bot]` identity. Delegates to `formatBotIdentity` from `src/utils/botIdentity.ts`.
- `withToken(appId, privateKey, effect)` -- Bracket: generate, run, revoke.

**Types:** `InstallationToken` (Schema), `BotIdentity` (interface)

**Error type:** `GitHubAppError`

### OctokitAuthApp Service

Wrapper service for `@octokit/auth-app`. This is the only service that imports `@octokit/auth-app` directly (via `OctokitAuthAppLive`).

**Interface:**

- `createAppAuth(options)` -- Create an `AppAuth` callable for JWT-based app and installation authentication

**Types:** `AppAuth` -- callable interface for app/installation auth

### CheckRun Service

Create, update, and complete GitHub check runs with bracket pattern.

**Interface:**

- `create(name, headSha)` -- Create a new check run. Returns `CheckRunData` (id, name, status, conclusion, htmlUrl)
- `get(checkRunId)` -- Get a check run by id. Returns `CheckRunData`
- `update(checkRunId, output)` -- Update with output content
- `complete(checkRunId, conclusion, output?)` -- Complete with conclusion
- `withCheckRun(name, headSha, effect)` -- Bracket: create, run, complete

**Types:** `CheckRunConclusion`, `AnnotationLevel`, `CheckRunAnnotation`, `CheckRunOutput`, `CheckRunData`

**Error type:** `CheckRunError`

### PullRequest Service

Full pull request lifecycle management.

**Interface:**

- `get(number)` -- Get a single PR by number
- `list(options?)` -- List PRs matching filters
- `listFiles(number)` -- List files changed in a PR. Returns `Array<PullRequestFile>`
- `listAssociatedWithCommit(sha)` -- List PRs associated with a commit SHA
- `create(options)` -- Create a new PR
- `update(number, options)` -- Update an existing PR
- `getOrCreate(options)` -- Find existing PR for head->base or create one
- `merge(number, options?)` -- Immediately merge a PR
- `addLabels(number, labels)` -- Add labels to a PR
- `requestReviewers(number, options)` -- Request reviewers

**Types:** `PullRequestInfo`, `PullRequestListOptions`, `PullRequestFile`

`PullRequestInfo` carries optional fields added in this cycle: `mergedAt`, `body`, `mergeCommitSha` and `baseSha`.

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
- `dispatchAndWait(workflow, ref, inputs?, pollOptions?)` -- Trigger and poll until completion
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

**Types:** `ExecOptions` -- `{ cwd?, env?, timeout?, silent?, streaming? }`, `ExecOutput` -- `{ exitCode, stdout, stderr }`

**Error type:** `CommandRunnerError`

### NpmRegistry Service

Query npm registry for package metadata.

**Interface:**

- `getLatestVersion(pkg)` -- Get latest version string
- `getDistTags(pkg)` -- Get dist-tags record
- `getPackageInfo(pkg, version?, options?)` -- Get package info. `options.registry` routes to a specific registry
- `getVersions(pkg, options?)` -- Get all version strings. `options.registry` routes to a specific registry
- `getPublishedIntegrity(pkg, version, options)` -- Probe a specific registry for the published `dist.integrity` hash of a version. Returns `Option<string>` — `none` when the version is absent (404), `some(integrity)` when found. Other failures propagate as `NpmRegistryError`. `options.registry` is required

**Error type:** `NpmRegistryError` (carries a `message` getter for readable error surfaces)

### PackagePublish Service

Multi-registry npm package publishing workflow.

**Interface:**

- `setupAuth(registry, token)` -- Configure npm authentication. URL scheme is stripped from the key written to `.npmrc` (only the hostname+path is used, not `https://`)
- `pack(packageDir)` -- Pack into a tarball; returns `PackResult` with `tarballPath`, `digest` (sha512-base64 integrity), `sha256Hex` (lowercase hex SHA-256 of the tarball for use with attestation APIs), `name`, `version`, `packedSize`, `unpackedSize`, `fileCount`
- `publish(packageDir, options?)` -- Publish to a registry. `options.packageManager` routes through the active PM's executor (e.g. `pnpm dlx npm` or `yarn npm`) so callers can use npm ≥ 11.5.1 for OIDC trusted publishing regardless of which PM manages the workspace. Verbose npm logging is enabled so the OIDC exchange is visible in the action log
- `publishTarball(tarballPath, options)` -- Upload a previously-packed tarball to a specific registry without re-packing. `options.registry` is required. Suitable for publishing byte-identical content to multiple registries
- `verifyIntegrity(packageName, version, expectedDigest)` -- Verify a published package's integrity hash against the expected digest
- `publishToRegistries(packageDir, registries)` -- Publish to multiple registries in sequence
- `publishIdempotent(input)` -- Skip when an identical version already exists; fail on content mismatch. Deprecated: new callers should compose `pack`, `NpmRegistry.getPublishedIntegrity` and `publishTarball` directly
- `dryRun(packageDir, options?)` -- Simulate publishing via `npm publish --dry-run`. Returns `DryRunResult { ok, packedSize?, unpackedSize?, fileCount?, output }`. A non-zero exit is reported as `ok: false`, not as an error

**Types:** `PackResult`, `RegistryTarget`, `IdempotentPublishInput`, `IdempotentPublishResult`, `DryRunResult`

**Error type:** `PackagePublishError` (carries a `message` getter for readable error surfaces; captures the source error as `cause`; surfaces the tail of long stderr output)

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

### GitHubContent Service

Read repository file contents via the GitHub REST API.

**Interface:**

- `getFile(path, ref?)` -- Read a file's decoded UTF-8 contents at a ref. `ref` defaults to the repository's default branch. Fails when the path resolves to a directory, submodule, or is missing

**Error type:** `GitHubContentError`

### GitHubCommit Service

Read the GitHub commit graph via the REST API. Distinct from `GitCommit`, which wraps the local `git` CLI — this service wraps `repos.getCommit` / `listCommits` / `compareCommits`.

**Interface:**

- `get(ref)` -- Get a single commit by ref (SHA or branch name). Returns `CommitDetail`
- `list(ref)` -- List commits reachable from a ref, paginated. Returns `Array<CommitSummary>`
- `compare(base, head)` -- Compare two commits/refs; returns the commits and changed files between base and head. Returns `CommitComparison`

**Types:** `CommitSummary { sha, message, author }`, `CommitDetail extends CommitSummary { parents }`, `CommitFile { filename, status }`, `CommitComparison { commits, files }`

**Error type:** `GitHubCommitError`

### GitHubArtifactMetadata Service

GitHub Packages artifact-metadata operations for linking attestations to published artifacts.

**Interface:**

- `createStorageRecord(input)` -- Create an artifact-metadata storage record linking an attestation to a published GitHub Packages artifact. Returns `ReadonlyArray<number>` (created record IDs). `input` carries `name` (purl), `digest`, `version`, `registryUrl`, `artifactUrl` and `repo`

**Error type:** `GitHubArtifactMetadataError`

### Attest Service

End-to-end attestation: build in-toto statements, sign via Sigstore, upload to GitHub's attestation store, and query existing attestations.

**Interface:**

- `buildStatement(input)` -- Build an `InTotoStatement` from subjects + predicate. Pure aside from Effect wrapping
- `save(data, path)` -- Write an in-toto statement or Sigstore bundle to disk. Requires `FileSystem`
- `buildBundle(input)` -- Build a signed Sigstore bundle (no upload). Requires `SigstoreSigner | OidcTokenIssuer`
- `attest(input)` -- Full end-to-end: build statement, sign, POST to `POST /repos/{owner}/{repo}/attestations`. Returns `AttestationRecord`. Requires `SigstoreSigner | OidcTokenIssuer | GitHubClient`
- `sbom(input)` -- Generate a CycloneDX SBOM and attest it (`CYCLONEDX_BOM` predicateType). `input` accepts either `dependencies` (the service builds the BOM) or a pre-built `bomDocument` (attested verbatim). Requires `Sbom | SigstoreSigner | OidcTokenIssuer | GitHubClient`
- `provenance(input)` -- Attest with a caller-supplied SLSA Provenance v1 predicate. Requires `SigstoreSigner | OidcTokenIssuer | GitHubClient`
- `listForSubject(subjectSha256, options?)` -- List existing attestations for a tarball digest (`GET /repos/{owner}/{repo}/attestations/sha256:{hex}`). `options.predicateType` filters client-side. Returns an empty array on 404 (never-attested subject). Requires `GitHubClient`

**Types:** `SbomAttestationInput`, `ProvenanceAttestationInput`, `AttestationListEntry { attestationUrl, predicateType }`, `AttestationRecord` (see `schemas/Attestation.ts`)

**Error type:** `AttestError`

### OidcTokenIssuer Service

Fetch OIDC ID tokens from the GitHub Actions token service. Requires `id-token: write` in the workflow permissions.

**Interface:**

- `getToken(audience)` -- Request an OIDC ID token from `ACTIONS_ID_TOKEN_REQUEST_URL`. `audience` is the `aud` claim (e.g. `"sigstore"` for Fulcio cert issuance). Returns `Redacted<string>`

**Error type:** `OidcTokenError`

### SigstoreSigner Service

Sign an in-toto statement to produce a Sigstore DSSE bundle.

**Interface:**

- `signStatement(statement)` -- Build a Sigstore bundle from an `InTotoStatement`. Fetches an OIDC token via `OidcTokenIssuer` (audience: `"sigstore"`), signs through Fulcio, and witnesses on Rekor. Returns `SigstoreBundle`. Requires `OidcTokenIssuer`

**Constants:** `IN_TOTO_PAYLOAD_TYPE`, `SIGSTORE_OIDC_AUDIENCE`

**Config:** `SigstoreSignerConfig { fulcioBaseURL?, rekorBaseURL? }` for overriding public-good defaults

**Error type:** `SigstoreSignerError`

### Sbom Service

CycloneDX 1.5 SBOM generation for npm packages.

**Interface:**

- `generate(input)` -- Build an in-memory CycloneDX 1.5 BOM from a resolved dependency graph. `input` includes NTIA-required fields: `rootName`, `rootVersion`, `dependencies`, optional `supplier` (`SbomSupplier { name, url?, contact? }`) and `authors` (`Array<SbomAuthor>`) for NTIA "author of SBOM data". `inFlightPackages` handles workspace packages not yet on a registry
- `serializeJson(bom)` -- Serialize a BOM to canonical CycloneDX JSON
- `save(bom, path)` -- Write a BOM to disk as pretty-printed JSON. Requires `FileSystem`

**Types:** `SbomInput`, `CycloneDXBom`, `ResolvedDependency`, `InFlightPackage`, `SbomSupplier`, `SbomContact`, `SbomAuthor`

**Error type:** `SbomError`

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

- `ReportBuilder.create(title)`, `report.stat(label, value)`, `report.section(title, content)`, `report.details(summary, content)`, `report.toMarkdown()`, `report.toSummary()`, `report.toComment(prNumber, markerKey)`, `report.toCheckRun(checkRunId)`

### RegistryClassifier (Pure Functions)

URL-safe registry detection. Parses URLs and checks hostnames (not substrings) to prevent CWE-20 bypass attacks.

- `isNpmRegistry(url)`, `isGitHubPackagesRegistry(url)`, `isJsrRegistry(url)`, `isCustomRegistry(url)` -- boolean predicates
- `getRegistryType(url)` -- returns `RegistryType` (`"npm" | "github-packages" | "jsr" | "custom"`)
- `getRegistryDisplayName(url)` -- human-readable name; defaults to `"jsr.io"` when `url` is null/undefined
- `generatePackageViewUrl(registry, packageName)` -- generates a browse URL for npm and GitHub Packages registries

---

## Action.run Helper

Top-level convenience function that eliminates boilerplate for wiring Effect programs into GitHub Action entry points.

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

## GitHubToken Lifecycle

`GitHubToken` (`src/GitHubToken.ts`) is a namespace object that orchestrates
the GitHub App installation-token lifecycle across the three phases of a
multi-phase action. It holds no state of its own — it draws on `GitHubApp`,
`ActionState` and `TokenPermissionChecker`, and uses `GitHubClientLive.fromToken`
to build the client. All three helpers expose their dependencies in the `R` channel rather than self-providing them: `provision` and `dispose` require a `GitHubApp` layer in context and `client` requires `ActionState`. Consumers provide `GitHubAppLive` composed with `OctokitAuthAppLive` in production, or `GitHubAppTest` in their own tests.

The helpers communicate through a single internal `ActionState` key
(`github-action-effects/installation-token`) carrying the `InstallationToken`
envelope (the schema exported from `GitHubApp.ts`):

```text
pre.ts   GitHubToken.provision()  — resolve App credentials, generate token,
                                    best-effort resolve App identity, enrich
                                    token with identity fields, optionally verify
                                    scopes, persist enriched envelope
                                          │
                                          ▼  ActionState (GITHUB_STATE file)
                                          │
main.ts  GitHubToken.client()     — read envelope, build GitHubClient layer
                                    via GitHubClientLive.fromToken
         GitHubToken.read()       — read raw InstallationToken from state
         GitHubToken.botIdentity() — derive BotIdentity from persisted token
                                          │
post.ts  GitHubToken.dispose()    — read envelope, revoke token via GitHubApp
```

- **`provision(options?)`** — `Effect<InstallationToken, GitHubAppError | TokenPermissionError | ActionStateError | ConfigError, ActionState | GitHubApp>`. Credentials are hybrid: `clientId` defaults to the `app-client-id` action input (`Config.string`) and `privateKey` to `app-private-key` (`Config.redacted`); the options object overrides both. Generates the token via `GitHubApp.generateToken`, then calls `GitHubApp.resolveAppIdentity(clientId, privateKey, token.token)` — passing the freshly-minted installation token as the third argument so the `GET /users` lookup runs authenticated at 5000 req/hr rather than unauthenticated. The call is wrapped in `Effect.option` so a failure degrades to a token without identity fields rather than crashing the action. When `permissions` are given runs `assertSufficient` against the token's own `permissions` (no API call). Persists the enriched envelope and returns it. Strict: fails if no credentials resolve.
- **`client()`** — `Layer.Layer<GitHubClient, ActionStateError, ActionState>`. Reads the persisted envelope and delegates to `GitHubClientLive.fromToken`. Strict: fails with `ActionStateError` if nothing was provisioned.
- **`read()`** — `Effect<InstallationToken, ActionStateError, ActionState>`. Reads the persisted envelope from `ActionState`. Available in any phase after `provision`.
- **`botIdentity()`** — `Effect<BotIdentity, ActionStateError, ActionState>`. Reads the token via `read()` and derives a `BotIdentity` via `formatBotIdentity`. Produces a verified identity (with numeric user-ID email prefix) when `appSlug` and `appUserId` were resolved; falls back to `github-actions[bot]` otherwise.
- **`dispose()`** — `Effect<void, GitHubAppError | ActionStateError, ActionState | GitHubApp>`. Reads the envelope via `ActionState.getOptional` and revokes it via `GitHubApp.revokeToken`. Deliberately a **no-op when nothing was persisted** — `post` steps run even when `pre`/`main` failed, so a cleanup step must not crash because there is nothing to revoke.

`provision` and `dispose` require `GitHubApp` in their requirements channel exactly as `client` requires `ActionState` — the namespace exposes every dependency rather than hiding some. A consumer provides a `GitHubApp` layer alongside the helper: `GitHubAppLive` composed with `OctokitAuthAppLive` in production, or `GitHubAppTest` when unit-testing their own `pre.ts`/`post.ts` against a mock token.

---

## Current State

All 37 service modules and 6 namespace/utility objects are fully defined with interfaces, error types, and live layer implementations. All services also have test layer implementations. The runtime layer (`src/runtime/`) provides native implementations of the GitHub Actions protocol, eliminating all `@actions/*` dependencies. The attestation cluster (`Attest`, `OidcTokenIssuer`, `SigstoreSigner`, `Sbom`) and three new GitHub API services (`GitHubContent`, `GitHubCommit`, `GitHubArtifactMetadata`) landed in this cycle.

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
