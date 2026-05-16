# Services guide

This guide walks through each service in `@savvy-web/github-action-effects` with a usage example. For architecture and layer composition, see [architecture](./07-architecture.md). For testing, see [testing](./08-testing.md).

## Inputs via Config API

Inputs are read using Effect's `Config` API, backed by `ActionsConfigProvider` which reads `INPUT_*` environment variables.

```typescript
import { Config, Effect, Redacted } from "effect"

const program = Effect.gen(function* () {
  // Required string input
  const name = yield* Config.string("package-name")

  // Optional with default
  const branch = yield* Config.string("branch").pipe(Config.withDefault("main"))

  // Integer input
  const count = yield* Config.integer("count").pipe(Config.withDefault(10))

  // Boolean input
  const dryRun = yield* Config.boolean("dry-run").pipe(Config.withDefault(false))

  // Redacted input — Config.redacted wraps the value so it is not printed
  const token = yield* Config.redacted("token")
  const raw = Redacted.value(token) // unwrap when you need the plain string
})
```

## Core services

These services are provided automatically by `ActionsRuntime.Default` and `Action.run`.

### ActionLogger

`ActionLogger` adds two operations on top of the built-in Effect logger: collapsible log groups and buffer-on-failure logging. It has exactly two methods, `group` and `withBuffer`.

```typescript
import { Effect } from "effect"
import { ActionLogger } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger

  // Collapsible log group in the Actions UI
  const result = yield* logger.group("Build", Effect.gen(function* () {
    yield* Effect.log("Compiling...")
    yield* Effect.log("Done")
    return 42
  }))

  // Buffer-on-failure: captures verbose logs, flushes only on error
  yield* logger.withBuffer("analysis", Effect.gen(function* () {
    yield* Effect.log("Step 1...")
    yield* Effect.log("Step 2...")
    // If this succeeds, buffered logs are discarded
    // If this fails, buffered logs flush for debugging
  }))
})
```

Workflow annotations are not a method on `ActionLogger`. Log through Effect at warning or error level instead — the `ActionsLogger` installed by `ActionsRuntime.Default` maps `Effect.logWarning` to a `::warning::` command and `Effect.logError` to a `::error::` command. Log annotations such as `file` and `line` become command properties, so an annotation lands inline on the PR diff.

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // A warning annotation pinned to a file and line
  yield* Effect.logWarning("Deprecated API").pipe(
    Effect.annotateLogs({ file: "src/helpers.ts", line: "42" }),
  )

  // An error annotation
  yield* Effect.logError("Check failed").pipe(
    Effect.annotateLogs({ file: "src/index.ts", line: "10" }),
  )
})
```

### ActionOutputs

Set outputs, write summaries, export variables.

```typescript
import { Effect, Schema } from "effect"
import { ActionOutputs } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs

  // String output
  yield* outputs.set("status", "success")

  // Schema-validated JSON output
  yield* outputs.setJson("report", { total: 10, passed: 9 }, ReportSchema)

  // Step summary (markdown)
  yield* outputs.summary("## Results\n\nAll checks passed.")

  // Environment variable for subsequent steps
  yield* outputs.exportVariable("MY_TOKEN", token)

  // Add to PATH
  yield* outputs.addPath("/usr/local/bin/custom-tool")

  // Mask a runtime value in logs
  yield* outputs.setSecret(generatedToken)

  // Mark action as failed
  yield* outputs.setFailed("Something went wrong")
})
```

## State and environment

### ActionState

Transfer typed data across action phases (pre/main/post).

```typescript
import { Effect, Schema } from "effect"
import { Action, ActionState } from "@savvy-web/github-action-effects"

const TimingSchema = Schema.Struct({ startedAt: Schema.Number })

// pre.ts -- save state
const pre = Effect.gen(function* () {
  const state = yield* ActionState
  yield* state.save("timing", { startedAt: Date.now() }, TimingSchema)
})

Action.run(pre)

// post.ts -- read state
const post = Effect.gen(function* () {
  const state = yield* ActionState
  const timing = yield* state.get("timing", TimingSchema)
  yield* Effect.log(`Elapsed: ${Date.now() - timing.startedAt}ms`)
})

Action.run(post)
```

### ActionEnvironment

Read GitHub Actions environment variables with typed contexts.

```typescript
import { Effect } from "effect"
import { ActionEnvironment } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const env = yield* ActionEnvironment

  // Read a required env var
  const ref = yield* env.get("GITHUB_REF")

  // Read optional env var
  const debug = yield* env.getOptional("RUNNER_DEBUG")

  // Structured GitHub context (all GITHUB_* vars, validated)
  const github = yield* env.github
  // github.repository, github.sha, github.ref, etc.

  // Structured runner context (all RUNNER_* vars, validated)
  const runner = yield* env.runner
})
```

## GitHub API services

These services use `@octokit/rest` directly (a regular dependency).

### GitHubClient

Low-level Octokit wrapper for REST and GraphQL calls.

```typescript
import { Effect } from "effect"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient

  // REST API call
  const release = yield* client.rest("getLatestRelease", (octokit) =>
    octokit.repos.getLatestRelease({ owner: "org", repo: "repo" })
  )

  // Paginated REST call
  const issues = yield* client.paginate("listIssues", (octokit, page, perPage) =>
    octokit.issues.listForRepo({ owner: "org", repo: "repo", page, per_page: perPage })
  )

  // Repository context
  const { owner, repo } = yield* client.repo
}).pipe(Effect.provide(GitHubClientLive.fromEnv))
```

`GitHubClientLive` is a namespace of three layer constructors, not a bare layer:

- `GitHubClientLive.fromEnv` — a `Layer<GitHubClient, GitHubClientError>` that reads the ambient `process.env.GITHUB_TOKEN`, the repo-scoped workflow token.
- `GitHubClientLive.fromToken(token)` — a `Layer<GitHubClient>` built from an explicit token, a plain `string` or a `Redacted`, with no `process.env` dependency.
- `GitHubClientLive.fromApp({ clientId, privateKey, installationId? })` — a `Layer<GitHubClient, GitHubAppError>` that generates a fresh installation token from GitHub App credentials each time the layer is built.

For the pre/main/post pattern where one token is shared across phases, use the [`GitHubToken`](#githubtoken) namespace instead of `fromApp`.

### GitHubRelease

Create and manage GitHub releases.

```typescript
import { Effect } from "effect"
import { GitHubRelease, GitHubReleaseLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const releases = yield* GitHubRelease

  const release = yield* releases.create({
    tag: "v1.0.0",
    name: "Version 1.0.0",
    body: "## Changes\n\n- Feature A\n- Fix B",
    generateReleaseNotes: true,
  })

  yield* releases.uploadAsset(
    release.id,
    "checksums.txt",
    checksumData,
    "text/plain",
  )

  const existing = yield* releases.getByTag("v0.9.0")
  const all = yield* releases.list({ perPage: 10 })
})
```

### GitHubIssue

Manage issues and linked PR issues.

```typescript
import { Effect } from "effect"
import { GitHubIssue, GitHubIssueLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const issues = yield* GitHubIssue

  const openBugs = yield* issues.list({
    state: "open",
    labels: ["bug"],
  })

  yield* issues.close(42, "completed")
  yield* issues.comment(42, "Fixed in v1.0.0")

  // Get issues linked to a PR via closing references
  const linked = yield* issues.getLinkedIssues(123)
})
```

### CheckRun

Create check runs with annotations for PR feedback.

```typescript
import { Effect } from "effect"
import { CheckRun, CheckRunLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const checkRun = yield* CheckRun

  // Bracket pattern: auto-completes on success/failure
  yield* checkRun.withCheckRun("lint", headSha, (id) =>
    Effect.gen(function* () {
      yield* checkRun.update(id, {
        title: "Lint Results",
        summary: "Found 3 warnings",
        annotations: [
          {
            path: "src/index.ts",
            start_line: 10,
            end_line: 10,
            annotation_level: "warning",
            message: "Unused import",
          },
        ],
      })
    })
  )
})
```

### PullRequest

Full pull request lifecycle management: get, list, create, update, merge and the idempotent `getOrCreate` pattern.

```typescript
import { Effect } from "effect"
import { PullRequest, PullRequestLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const pr = yield* PullRequest

  // Get a single PR
  const info = yield* pr.get(123)

  // List open PRs targeting main
  const prs = yield* pr.list({ base: "main", state: "open" })

  // Create a PR with optional auto-merge
  const created = yield* pr.create({
    title: "chore: update deps",
    body: "Automated dependency update",
    head: "deps/update",
    base: "main",
    autoMerge: "squash",
  })

  // Idempotent: find existing PR for head->base or create one
  const { created: isNew } = yield* pr.getOrCreate({
    head: "release/v1",
    base: "main",
    title: "Release v1.0.0",
    body: "Release notes",
  })

  // Merge a PR
  yield* pr.merge(created.number, { method: "squash" })

  // Add labels and request reviewers
  yield* pr.addLabels(created.number, ["automated", "dependencies"])
  yield* pr.requestReviewers(created.number, {
    reviewers: ["octocat"],
    teamReviewers: ["core-team"],
  })
})
```

### PullRequestComment

Create and manage PR comments with sticky (upsert) support.

```typescript
import { Effect } from "effect"
import { PullRequestComment, PullRequestCommentLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const prComment = yield* PullRequestComment

  // Upsert a sticky comment (identified by hidden HTML marker)
  yield* prComment.upsert(123, "build-report", "## Build Report\n\nAll passed.")

  // Find existing comment by marker
  const existing = yield* prComment.find(123, "build-report")

  // Create a one-off comment
  yield* prComment.create(123, "Manual comment")
})
```

### GitTag, GitBranch, GitCommit

Low-level Git Data API operations.

```typescript
import { Effect } from "effect"
import {
  GitTag, GitTagLive,
  GitBranch, GitBranchLive,
  GitCommit, GitCommitLive,
} from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const tags = yield* GitTag
  const branches = yield* GitBranch
  const commits = yield* GitCommit

  // Tags
  yield* tags.create("v1.0.0", sha)
  const allTags = yield* tags.list("v1.")
  const tagSha = yield* tags.resolve("v1.0.0")

  // Branches
  yield* branches.create("release/v1", sha)
  const exists = yield* branches.exists("release/v1")
  yield* branches.reset("main", newSha)

  // Commits (verified via Git Data API)
  const commitSha = yield* commits.commitFiles("main", "chore: update", [
    { path: "package.json", content: newContent },
    { path: "obsolete.config.js", sha: null },  // delete a file
  ])
})
```

### GitHubApp

GitHub App authentication: generate, use and revoke installation tokens. `GitHubAppLive` requires an `OctokitAuthApp` layer, so compose it with `OctokitAuthAppLive`.

```typescript
import { Effect, Layer } from "effect"
import {
  GitHubApp,
  GitHubAppLive,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive)

const program = Effect.gen(function* () {
  const app = yield* GitHubApp

  // Generate an installation token explicitly
  const installation = yield* app.generateToken(clientId, privateKey)
  // installation.token, installation.expiresAt, installation.installationId
  yield* Effect.log(`Generated token for installation ${installation.installationId}`)

  // ... use installation.token for API calls ...

  // Revoke it when done
  yield* app.revokeToken(installation.token)

  // Or use the bracket form: the callback receives the bare token string,
  // and the token is always revoked afterwards, even on failure
  yield* app.withToken(clientId, privateKey, (token) =>
    Effect.gen(function* () {
      yield* Effect.log("Using installation token for API calls")
    })
  )
}).pipe(Effect.provide(appLayer))
```

For the three-phase pre/main/post pattern, prefer the [`GitHubToken`](#githubtoken) namespace, which provisions one token in `pre` and revokes it in `post`.

### GitHubGraphQL

Typed GraphQL queries and mutations.

```typescript
import { Effect } from "effect"
import { GitHubGraphQL, GitHubGraphQLLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const gql = yield* GitHubGraphQL

  const data = yield* gql.query<{ repository: { id: string } }>(
    "getRepoId",
    `query { repository(owner: "org", name: "repo") { id } }`,
  )
})
```

### OctokitAuthApp

`OctokitAuthApp` wraps `@octokit/auth-app`. `GitHubAppLive` depends on it, so in practice you provide `OctokitAuthAppLive` as the layer underneath `GitHubAppLive` rather than reaching for `OctokitAuthApp` directly.

```typescript
import { Layer } from "effect"
import {
  GitHubAppLive,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

// OctokitAuthAppLive satisfies the OctokitAuthApp requirement of GitHubAppLive
const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive)
```

`OctokitAuthAppLive` is a bare `Layer<OctokitAuthApp>` — provide it as-is. Use the service tag directly only when you need raw `createAppAuth` access.

## GitHub App token lifecycle

### GitHubToken

`GitHubToken` is a top-level namespace, like `Action`, not an injected service. It coordinates one GitHub App installation token across the three action phases: `provision` in `pre`, `client` in `main`, `dispose` in `post`. It persists the token to `ActionState` internally, so you do not define a token schema yourself.

```typescript
import { Effect, Layer } from "effect"
import {
  Action,
  GitHubAppLive,
  GitHubClient,
  GitHubToken,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive)

// pre.ts — provision and persist the installation token
Action.run(
  GitHubToken.provision({
    permissions: { contents: "write", pull_requests: "write" },
  }).pipe(Effect.provide(appLayer)),
)

// main.ts — build a GitHubClient from the persisted token
const main = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
}).pipe(Effect.provide(GitHubToken.client()))

Action.run(main)

// post.ts — revoke the token
Action.run(GitHubToken.dispose().pipe(Effect.provide(appLayer)))
```

The three members:

- `provision(options?)` — generates an installation token and saves it. `clientId` defaults to the `app-client-id` action input and `privateKey` to `app-private-key`; pass them in `options` to override. With `permissions` set, the generated token is verified to grant those scopes before it is persisted — a missing scope fails with `TokenPermissionError` and revokes the rejected token. Returns the `InstallationToken`. Requires a `GitHubApp` layer and `ActionState`.
- `client()` — a `Layer<GitHubClient, ActionStateError, ActionState>` that reads the persisted token and builds a `GitHubClient` from it.
- `dispose()` — revokes the persisted token. A no-op if none was persisted. Requires a `GitHubApp` layer and `ActionState`.

`provision` and `dispose` require a `GitHubApp` layer in context. Compose it once as `Layer.provide(GitHubAppLive, OctokitAuthAppLive)` and provide it to each effect. In tests, provide `GitHubAppTest.layer(GitHubAppTest.empty())` instead.

## Command execution

### CommandRunner

Structured shell command execution with capture and parsing.

```typescript
import { Effect, Schema } from "effect"
import { CommandRunner, CommandRunnerLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const runner = yield* CommandRunner

  // Run and get exit code
  yield* runner.exec("npm", ["install"], { cwd: "/app" })

  // Capture stdout/stderr
  const output = yield* runner.execCapture("git", ["status"])

  // Parse JSON output with schema validation
  const pkg = yield* runner.execJson(
    "npm", ["view", "effect", "--json"],
    Schema.Struct({ name: Schema.String, version: Schema.String }),
  )

  // Get stdout as lines
  const files = yield* runner.execLines("git", ["diff", "--name-only"])
})
```

## Package management

### NpmRegistry

Query npm registry for package information.

```typescript
import { Effect } from "effect"
import { NpmRegistry, NpmRegistryLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const npm = yield* NpmRegistry

  const latest = yield* npm.getLatestVersion("effect")
  const tags = yield* npm.getDistTags("effect")
  const versions = yield* npm.getVersions("effect")
  const info = yield* npm.getPackageInfo("effect", "3.0.0")
})
```

### PackagePublish

Publish packages to one or more registries.

```typescript
import { Effect } from "effect"
import { PackagePublish, PackagePublishLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish

  yield* publisher.setupAuth("https://registry.npmjs.org/", npmToken)

  const { tarball, digest } = yield* publisher.pack("./dist/npm")

  yield* publisher.publish("./dist/npm", {
    registry: "https://registry.npmjs.org/",
    tag: "latest",
    access: "public",
    provenance: true,
  })

  // Or publish to multiple registries at once
  yield* publisher.publishToRegistries("./dist/npm", [
    { registry: "https://registry.npmjs.org/", token: npmToken },
    { registry: "https://npm.pkg.github.com/", token: ghToken },
  ])

  // Verify integrity after publishing
  const ok = yield* publisher.verifyIntegrity("my-pkg", "1.0.0", digest)
})
```

### WorkspaceDetector

Detect and query monorepo workspaces.

```typescript
import { Effect } from "effect"
import { WorkspaceDetector, WorkspaceDetectorLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const workspaces = yield* WorkspaceDetector

  const info = yield* workspaces.detect()
  // info.type: "pnpm" | "npm" | "yarn" | "single"

  const packages = yield* workspaces.listPackages()
  const pkg = yield* workspaces.getPackage("@scope/my-package")
})
```

### PackageManagerAdapter

Unified interface for npm, pnpm, yarn, bun, and deno.

```typescript
import { Effect } from "effect"
import { PackageManagerAdapter, PackageManagerAdapterLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const pm = yield* PackageManagerAdapter

  const info = yield* pm.detect()
  // info.name: "npm" | "pnpm" | "yarn" | "bun" | "deno"

  yield* pm.install({ frozen: true, cwd: "/app" })
  const cachePaths = yield* pm.getCachePaths()
  const lockfiles = yield* pm.getLockfilePaths()
})
```

### ChangesetAnalyzer

Work with changeset files for versioning.

```typescript
import { Effect } from "effect"
import { ChangesetAnalyzer, ChangesetAnalyzerLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const changesets = yield* ChangesetAnalyzer

  const hasAny = yield* changesets.hasChangesets()
  const all = yield* changesets.parseAll()

  yield* changesets.generate(
    [{ name: "@scope/pkg", bump: "minor" }],
    "Added new feature X",
  )
})
```

## Infrastructure services

### ActionCache

GitHub Actions cache using V2 Twirp RPC protocol at ACTIONS_RESULTS_URL with Azure Blob Storage (`@azure/storage-blob`) for uploads/downloads.

```typescript
import { Effect } from "effect"
import { ActionCache, ActionCacheLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const cache = yield* ActionCache

  // Bracket: restore, run, save if miss
  yield* cache.withCache(
    "node-modules-v1",
    ["node_modules"],
    Effect.gen(function* () {
      yield* Effect.log("Installing dependencies...")
      // install logic
    }),
    ["node-modules-"], // restore key prefixes
  )
})
```

### TokenPermissionChecker

Verify GitHub token permissions before using them.

```typescript
import { Effect } from "effect"
import { TokenPermissionChecker, TokenPermissionCheckerLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const checker = yield* TokenPermissionChecker

  // Fail if permissions are missing
  yield* checker.assertSufficient({
    contents: "write",
    "pull-requests": "write",
  })

  // Or just warn about over-permissioned tokens
  yield* checker.warnOverPermissioned({
    contents: "read",
  })
})
```

### DryRun

Guard mutations with a dry-run flag.

```typescript
import { Effect } from "effect"
import { DryRun, DryRunLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const dryRun = yield* DryRun

  const isDry = yield* dryRun.isDryRun

  // Skip the effect in dry-run mode, return fallback value
  yield* dryRun.guard(
    "publish",
    publisher.publish("./dist"),
    undefined, // fallback
  )
})
```

### RateLimiter

Guard API calls with rate limit awareness.

```typescript
import { Effect } from "effect"
import { RateLimiter, RateLimiterLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter

  // Guard: waits if rate limit is low
  yield* limiter.withRateLimit(apiCall)

  // Retry with exponential backoff
  yield* limiter.withRetry(flakyApiCall, {
    maxRetries: 3,
    baseDelay: 1000,
  })
})
```

### ConfigLoader

Load and validate configuration files.

```typescript
import { Effect, Schema } from "effect"
import { ConfigLoader, ConfigLoaderLive } from "@savvy-web/github-action-effects"

const MyConfig = Schema.Struct({
  version: Schema.Number,
  features: Schema.Array(Schema.String),
})

const program = Effect.gen(function* () {
  const loader = yield* ConfigLoader

  const exists = yield* loader.exists("config.json")
  const config = yield* loader.loadJson("config.json", MyConfig)
  const jsonc = yield* loader.loadJsonc("tsconfig.json", TsConfigSchema)
  const yaml = yield* loader.loadYaml("config.yml", MyConfig)
})
```

### WorkflowDispatch

Trigger and monitor GitHub Actions workflows.

```typescript
import { Effect } from "effect"
import { WorkflowDispatch, WorkflowDispatchLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const dispatch = yield* WorkflowDispatch

  // Fire and forget
  yield* dispatch.dispatch("deploy.yml", "main", { environment: "staging" })

  // Trigger and wait for completion
  const conclusion = yield* dispatch.dispatchAndWait(
    "deploy.yml",
    "main",
    { environment: "production" },
    { intervalMs: 15000, timeoutMs: 600000 },
  )
})
```

### ToolInstaller

Download, cache and install tool binaries using `node:https`/`node:http` and `child_process`. It handles archived tools (tar.gz, tar.xz, zip) and standalone binary files alike. Downloads follow redirects, time out a stuck socket and retry with exponential backoff; zip extraction works cross-platform (PowerShell on Windows, `unzip` elsewhere).

```typescript
import { Effect } from "effect"
import { ToolInstaller, ToolInstallerLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const tools = yield* ToolInstaller

  const isCached = yield* tools.isCached("my-tool", "1.0.0")

  // Download, extract an archive, cache, and add to PATH
  yield* tools.installAndAddToPath(
    "my-tool",
    "1.0.0",
    "https://github.com/org/my-tool/releases/download/v1.0.0/my-tool-linux-x64.tar.gz",
    { archiveType: "tar.gz", binSubPath: "bin" },
  )

  // Download a standalone binary, cache, chmod, and add to PATH
  yield* tools.installBinaryAndAddToPath(
    "biome",
    "1.9.0",
    "https://github.com/biomejs/biome/releases/download/cli%2Fv1.9.0/biome-linux-x64",
    { binaryName: "biome" },
  )
})
```

## Utility namespaces

These are top-level namespace objects, not injected services. Call them directly — there is no service tag to `yield*` first.

### ErrorAccumulator

Process every item in a collection and collect both successes and failures, instead of short-circuiting on the first error. The result's error channel is `never`; failures land in the `failures` array.

```typescript
import { Effect } from "effect"
import { ErrorAccumulator } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const result = yield* ErrorAccumulator.forEachAccumulate(
    ["pkg-a", "pkg-b", "pkg-c"],
    (pkg) => publishPackage(pkg), // may fail for some packages
  )
  yield* Effect.log(`Published ${result.successes.length}, failed ${result.failures.length}`)

  // Concurrent variant with a parallelism limit
  const concurrent = yield* ErrorAccumulator.forEachAccumulateConcurrent(
    ["pkg-a", "pkg-b", "pkg-c"],
    (pkg) => publishPackage(pkg),
    4, // max 4 in flight
  )
})
```

### AutoMerge

Enable or disable pull request auto-merge through the GitHub GraphQL API. Both operations need a `GitHubGraphQL` layer and take the PR's GraphQL node ID, not its number.

```typescript
import { Effect } from "effect"
import {
  AutoMerge,
  GitHubGraphQL,
  GitHubGraphQLLive,
} from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  // prNodeId comes from the GraphQL API, not the PR number
  yield* AutoMerge.enable(prNodeId, "SQUASH")
  yield* AutoMerge.disable(prNodeId)
}).pipe(Effect.provide(GitHubGraphQLLive))
```

### SemverResolver

Compare and manipulate semantic versions with Effect error handling. Each operation fails with `SemverResolverError` on invalid input.

```typescript
import { Effect } from "effect"
import { SemverResolver } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const cmp = yield* SemverResolver.compare("1.0.0", "2.0.0")
  // -1

  const ok = yield* SemverResolver.satisfies("1.5.0", "^1.0.0")
  // true

  const best = yield* SemverResolver.latestInRange(
    ["1.0.0", "1.1.0", "2.0.0"],
    "^1.0.0",
  )
  // "1.1.0"

  const next = yield* SemverResolver.increment("1.0.0", "minor")
  // "1.1.0"

  const parts = yield* SemverResolver.parse("1.2.3-beta.1")
  // { major: 1, minor: 2, patch: 3, prerelease: "beta.1" }
})
```

### ReportBuilder

Build a markdown report with a fluent, immutable builder, then send it to a step summary, a PR comment or a check run.

```typescript
import { Effect } from "effect"
import { ReportBuilder } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const report = ReportBuilder.create("Build report")
    .stat("Duration", "1.5s")
    .stat("Packages", 12)
    .section("Details", "All packages compiled successfully.")
    .details("Full log", longLogOutput)

  // Render to a markdown string
  const md = report.toMarkdown()

  // Or send it somewhere — each target needs the matching layer
  yield* report.toSummary() // requires ActionOutputs
  yield* report.toComment(prNumber, "build-report") // requires PullRequestComment
  yield* report.toCheckRun(checkRunId) // requires CheckRun
})
```
