# Services guide

This guide walks through each service in `@savvy-web/github-action-effects` with a usage example. For architecture and layer composition, see [architecture](./14-architecture.md). For testing, see [testing](./16-testing.md).

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

### ActionInput

`ActionInput` is a namespace of `Config` combinators for GitHub-faithful input parsing. They read through the same `ActionsConfigProvider`, so they compose with `Config.withDefault`, `Config.option` and the rest.

```typescript
import { Config, Effect } from "effect"
import { ActionInput } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  // YAML 1.2 Core Schema boolean — accepts ONLY true/True/TRUE and
  // false/False/FALSE, matching @actions/core.getBooleanInput
  const dryRun = yield* ActionInput.boolean("dry-run").pipe(Config.withDefault(false))

  // Multiline input: split on \n, drop empty lines, trim each line
  const paths = yield* ActionInput.multiline("paths").pipe(Config.withDefault([]))
})
```

Prefer `ActionInput.boolean` over Effect's `Config.boolean` for GitHub parity. `Config.boolean` also accepts JS-flavored truthy values like `yes`/`on`/`1` (which GitHub's own composite-action runtime rejects) and rejects `True` (which GitHub accepts). `ActionInput.boolean` fails with `ConfigError.InvalidData` on anything outside the YAML 1.2 Core Schema set.

## Core services

These services are provided automatically by `ActionsRuntime.Default` and `Action.run`.

### ActionLogger

`ActionLogger` adds three operations on top of the built-in Effect logger: collapsible log groups, buffer-on-failure logging and `::notice::` annotations. Its methods are `group`, `withBuffer` and `notice`.

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

  // Notice annotation — there is no Effect log level between Info and Warning,
  // so notice is its own method. Optional properties pin it to a file/line.
  yield* logger.notice("Cache restored from a previous run")
  yield* logger.notice("Generated file is stale", { file: "dist/index.js", startLine: 1 })
})
```

`notice` mirrors `@actions/core.notice` and emits a `::notice::` workflow command. `Effect.logInfo` writes plain stdout, so a notice annotation needs this dedicated path. Workflow warning and error annotations, by contrast, are not methods on `ActionLogger`. Log through Effect at warning or error level instead — the `ActionsLogger` installed by `ActionsRuntime.Default` maps `Effect.logWarning` to a `::warning::` command and `Effect.logError` to a `::error::` command. Log annotations such as `file` and `line` become command properties, so an annotation lands inline on the PR diff.

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

  // True when RUNNER_DEBUG === "1" (mirrors @actions/core.isDebug)
  const debugging = yield* env.isDebug
})
```

Beyond the raw and structured contexts, `ActionEnvironment` exposes the parsed webhook event the way `@actions/github`'s `context` does. These three accessors read `GITHUB_EVENT_PATH` and so require `FileSystem` in context (`ActionsRuntime.Default` provides it):

```typescript
import { Effect } from "effect"
import { ActionEnvironment } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const env = yield* ActionEnvironment

  // Parsed GITHUB_EVENT_PATH payload, schema-decoded into a WebhookPayload.
  // Common fields are typed; unknown keys are preserved. Empty {} when the
  // event file is absent (matching @actions/github).
  const payload = yield* env.payload
  const prTitle = payload.pull_request?.number

  // { owner, repo } from GITHUB_REPOSITORY, falling back to payload.repository
  const { owner, repo } = yield* env.repo

  // { owner, repo, number } where number resolves from issue ?? pull_request ?? top-level
  const { number } = yield* env.issue
})
```

`WebhookPayload` is also exported as a value (the Effect Schema) and a type, so you can decode an event body yourself or annotate a handler. Decoding preserves unknown keys, mirroring the toolkit's open `[key: string]: any` payload shape.

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

  // Paginated REST call — eager, collects every page into one array
  const issues = yield* client.paginate("listIssues", (octokit, page, perPage) =>
    octokit.issues.listForRepo({ owner: "org", repo: "repo", page, per_page: perPage })
  )

  // Repository context
  const { owner, repo } = yield* client.repo
}).pipe(Effect.provide(GitHubClientLive.fromEnv()))
```

`GitHubClientLive` is a namespace of three layer constructors, not a bare layer. All three are functions:

- `GitHubClientLive.fromEnv()` — a `Layer<GitHubClient, GitHubClientError>` that reads the ambient `process.env.GITHUB_TOKEN`, the repo-scoped workflow token. Call it with no arguments, or pass `ResilienceOptions` to tune retries.
- `GitHubClientLive.fromToken(token)` — a `Layer<GitHubClient>` built from an explicit token with no `process.env` dependency. The token must be a `Redacted<string>` — wrap a bare string with `Redacted.make(...)` at the call site.
- `GitHubClientLive.fromApp({ clientId, privateKey, installationId? })` — a `Layer<GitHubClient, GitHubAppError, HttpClient.HttpClient>` that mints an installation token from GitHub App credentials. `privateKey` is a `Redacted<string>`. It is a scoped layer: the minted token is revoked on scope close, so a bare `Effect.provide` must be wrapped in `Effect.scoped` (the `ActionsRuntime.Default` / `Action.run` path already scopes for you). It composes `GitHubAppLive` and `OctokitAuthAppLive` internally, leaving only `HttpClient.HttpClient` to provide — use `FetchHttpClient.layer` or `ActionsRuntime.Default`.

```typescript
import { Effect, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
}).pipe(
  Effect.provide(GitHubClientLive.fromToken(Redacted.make(process.env.MY_TOKEN ?? ""))),
)

// fromApp is scoped — wrap in Effect.scoped and provide an HttpClient.
const appProgram = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
}).pipe(
  Effect.provide(
    GitHubClientLive.fromApp({ clientId, privateKey: Redacted.make(pem) }),
  ),
  Effect.provide(FetchHttpClient.layer),
  Effect.scoped,
)
```

For the pre/main/post pattern where one token is shared across phases, use the [`GitHubToken`](#githubtoken) namespace instead of `fromApp`.

#### Streaming pagination

`paginate` collects every page into one array before it returns. `paginateStream` instead yields a `Stream` of items one page at a time, so a consumer can stop early with `Stream.takeWhile` or `Stream.take` without fetching or buffering the rest. Prefer it for large or early-terminating scans.

```typescript
import { Effect, Stream } from "effect"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient

  // Walk issues newest-first, stopping at the first one closed before a cutoff.
  const recent = yield* client.paginateStream<{ number: number; closed_at: string | null }>(
    "listIssues",
    (octokit, page, perPage) =>
      octokit.issues.listForRepo({ owner: "org", repo: "repo", state: "all", page, per_page: perPage }),
  ).pipe(
    Stream.takeWhile((issue) => issue.closed_at === null || issue.closed_at > "2026-01-01"),
    Stream.runCollect,
  )
  yield* Effect.log(`scanned ${recent.length} recent issues`)
  // scanned <n> recent issues (depends on the repo)
}).pipe(Effect.provide(GitHubClientLive.fromEnv()))
```

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

`GitHubAppLive` also requires `HttpClient.HttpClient` for its API calls. Compose `OctokitAuthAppLive` underneath and provide an HTTP client — `FetchHttpClient.layer` or `ActionsRuntime.Default`. The secret-bearing parameters (`privateKey` and any token argument) are `Redacted<string>`; wrap raw values with `Redacted.make`.

```typescript
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "@effect/platform"
import {
  GitHubApp,
  GitHubAppLive,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

const appLayer = Layer.provide(
  Layer.provide(GitHubAppLive, OctokitAuthAppLive),
  FetchHttpClient.layer,
)

const program = Effect.gen(function* () {
  const app = yield* GitHubApp

  // privateKey is a Redacted<string>
  const privateKey = Redacted.make(pem)

  // Generate an installation token explicitly
  const installation = yield* app.generateToken(clientId, privateKey)
  // installation.expiresAt, installation.installationId
  // installation.token is a Redacted<string> — unwrap with Redacted.value to use it
  yield* Effect.log(`Generated token for installation ${installation.installationId}`)

  // ... unwrap installation.token at the API boundary only ...

  // Revoke it when done — revokeToken takes the Redacted token directly
  yield* app.revokeToken(installation.token)

  // Resolve the App's public identity (slug, bot user ID, display name).
  // Pass the installation token as the third argument to authenticate the
  // /users/{slug}[bot] lookup (5000 req/hr); omit it to run unauthenticated (60 req/hr).
  const identity = yield* app.resolveAppIdentity(clientId, privateKey, installation.token)
  // identity.appSlug, identity.appUserId, identity.appName

  // Derive a commit-attribution identity.
  // With appSlug + appUserId, the email uses GitHub's verified-attribution format.
  const bot = app.botIdentity({ appSlug: identity.appSlug, appUserId: identity.appUserId })
  // bot.name  → "<appSlug>[bot]"
  // bot.email → "<appUserId>+<appSlug>[bot]@users.noreply.github.com"

  // Without source fields, falls back to the well-known github-actions[bot] identity
  const fallback = app.botIdentity()
  // fallback.name  → "github-actions[bot]"
  // fallback.email → "41898282+github-actions[bot]@users.noreply.github.com"

  // Or use the bracket form: the callback receives the Redacted token,
  // and the token is always revoked afterwards, even on failure
  yield* app.withToken(clientId, privateKey, (token) =>
    Effect.gen(function* () {
      // token is Redacted<string> — unwrap with Redacted.value at the wire boundary
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

### GitHubContent

Read a repository file's decoded UTF-8 contents at a ref. `ref` is optional; omitting it uses the default branch. Reading a path that is not a file (missing, a directory or a submodule) fails with `GitHubContentError`.

```typescript
import { Effect } from "effect"
import { GitHubContent, GitHubContentLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const content = yield* GitHubContent

  const pkgJson = yield* content.getFile("package.json")
  const atRef = yield* content.getFile("package.json", "v1.2.3")
  // both return the file as a decoded string
  const parsed = JSON.parse(pkgJson) as { version: string }
  yield* Effect.log(`version: ${parsed.version}`)
})
```

### GitHubCommit

Read the GitHub commit graph through the REST API. `get(ref)` returns a `CommitDetail` (sha, message, author, parents); `list(ref)` returns paginated `CommitSummary` entries; `compare(base, head)` returns the commits and changed files between two refs.

```typescript
import { Effect } from "effect"
import { GitHubCommit, GitHubCommitLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const commits = yield* GitHubCommit

  const head = yield* commits.get("main")
  // head: { sha, message, author, parents: [{ sha }, ...] }
  yield* Effect.log(`${head.sha.slice(0, 7)} ${head.message}`)

  const diff = yield* commits.compare("v1.0.0", "main")
  // diff.commits: CommitSummary[]   diff.files: { filename, status }[]
})
```

`GitHubCommit` is the REST commit graph — `repos.getCommit` / `listCommits` / `compareCommits`. Do not confuse it with `GitCommit`, which is the Git Data API for *creating* verified commits and updating refs. The names are close; the services are different. Use `GitHubCommit` to read history, `GitCommit` to write it.

### GitHubArtifactMetadata

Create a GitHub Packages artifact-metadata storage record linking an attestation to a published artifact. `createStorageRecord` returns the created record IDs. `GitHubArtifactMetadataError` carries a `retryable` flag so callers can back off on rate limits and 5xx responses.

```typescript
import { Effect } from "effect"
import { GitHubArtifactMetadata, GitHubArtifactMetadataLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const metadata = yield* GitHubArtifactMetadata

  const ids = yield* metadata.createStorageRecord({
    name: "pkg:npm/@scope/pkg@1.2.3",
    digest: artifactSha256Hex,
    version: "1.2.3",
    registryUrl: "https://npm.pkg.github.com/",
    artifactUrl: "https://github.com/owner/pkg/packages/123",
    repo: "pkg",
  })
  yield* Effect.log(`created ${ids.length} storage record(s)`)
})
```

### OctokitAuthApp

`OctokitAuthApp` wraps `@octokit/auth-app`. `GitHubAppLive` depends on it, so in practice you provide `OctokitAuthAppLive` as the layer underneath `GitHubAppLive` rather than reaching for `OctokitAuthApp` directly.

```typescript
import { Layer } from "effect"
import { FetchHttpClient } from "@effect/platform"
import {
  GitHubAppLive,
  OctokitAuthAppLive,
} from "@savvy-web/github-action-effects"

// OctokitAuthAppLive satisfies the OctokitAuthApp requirement of GitHubAppLive;
// FetchHttpClient.layer satisfies its HttpClient.HttpClient requirement.
const appLayer = Layer.provide(
  Layer.provide(GitHubAppLive, OctokitAuthAppLive),
  FetchHttpClient.layer,
)
```

`OctokitAuthAppLive` is a bare `Layer<OctokitAuthApp>` — provide it as-is. `GitHubAppLive` also needs `HttpClient.HttpClient`; under `Action.run` / `ActionsRuntime.Default` it is already in context, so a hand-composed `appLayer` only needs the explicit `FetchHttpClient.layer` when wired outside that path. Use the `OctokitAuthApp` service tag directly only when you need raw `createAppAuth` access.

## GitHub App token lifecycle

### GitHubToken

`GitHubToken` is a top-level namespace, like `Action`, not an injected service. It coordinates one GitHub App installation token across the three action phases: `provision` in `pre`, `client` in `main`, `dispose` in `post`. Two additional accessors — `read` and `botIdentity` — are available in any phase after `provision`. The namespace persists the token to `ActionState` internally, so you do not define a token schema yourself.

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

Use `read` and `botIdentity` in any phase that runs after `provision`:

```typescript
import { Effect } from "effect"
import { Action, ActionState, GitHubToken } from "@savvy-web/github-action-effects"

// main.ts — read the full token envelope and derive a commit identity
const main = Effect.gen(function* () {
  const token = yield* GitHubToken.read()
  // token.appSlug, token.appUserId, token.appName (populated best-effort)

  const identity = yield* GitHubToken.botIdentity()
  // identity.name  → "<appSlug>[bot]" or "github-actions[bot]"
  // identity.email → "<appUserId>+<appSlug>[bot]@users.noreply.github.com" or fallback
}).pipe(Effect.provide(GitHubToken.client()))

Action.run(main)
```

The five members:

- `provision(options?)` — generates an installation token and saves it. `clientId` defaults to the `app-client-id` action input and `privateKey` to `app-private-key`; pass them in `options` to override. With `permissions` set, the generated token is verified to grant those scopes before it is persisted — a missing scope fails with `TokenPermissionError` and revokes the rejected token. Also resolves the App's public identity (slug, bot user ID, name) best-effort and stores those fields on the token. Returns the `InstallationToken`. Requires a `GitHubApp` layer and `ActionState`.
- `client()` — a `Layer<GitHubClient, ActionStateError, ActionState>` that reads the persisted token and builds a `GitHubClient` from it.
- `read()` — an `Effect<InstallationToken, ActionStateError, ActionState>` that returns the full persisted token envelope, including the optional `appSlug`, `appUserId` and `appName` fields. Requires `ActionState`.
- `botIdentity()` — an `Effect<BotIdentity, ActionStateError, ActionState>` that derives a commit-attribution identity from the persisted token. When `appSlug` and `appUserId` were resolved, the email uses the `<userId>+<slug>[bot]@users.noreply.github.com` format GitHub recognises for verified attribution; otherwise it falls back to the well-known `github-actions[bot]` identity. Requires `ActionState`.
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

Registry tokens are `Redacted<string>` — `setupAuth` and each `RegistryTarget.token` take a redacted value, so wrap raw tokens with `Redacted.make`.

```typescript
import { Effect, Redacted } from "effect"
import { PackagePublish, PackagePublishLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish

  const npmToken = Redacted.make(process.env.NPM_TOKEN ?? "")
  const ghToken = Redacted.make(process.env.GITHUB_TOKEN ?? "")

  yield* publisher.setupAuth("https://registry.npmjs.org/", npmToken)

  const { tarballPath, digest, sha256Hex } = yield* publisher.pack("./dist/npm")

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

For the recommended `pack` → probe → `publishTarball` chain, the two `PackResult` digests and the `publishIdempotent` deprecation, see [publishing packages](./11-publishing.md).

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

## Attestation services

These four services produce signed software attestations. The full wired layer stack and the provenance / SBOM walkthroughs live in [generating SLSA attestations](./10-slsa-attestations.md); the recaps below are the per-service surface.

### Attest

End-to-end attestation: build an in-toto statement, sign it via `SigstoreSigner`, and upload the Sigstore bundle to GitHub's attestation store. `provenance` and `sbom` are the two convenience entry points; `listForSubject` reads existing attestations for a digest so a re-run stays idempotent.

```typescript
import { Effect } from "effect"
import { Attest, CYCLONEDX_BOM } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const attest = yield* Attest

  // Reuse-or-write: list first, write only when absent.
  const existing = yield* attest.listForSubject(tarballSha256Hex, { predicateType: CYCLONEDX_BOM })
  if (existing.length === 0) {
    const record = yield* attest.sbom({
      rootName: "@scope/pkg",
      rootVersion: "1.2.3",
      subjectSha256: tarballSha256Hex,
      dependencies: [{ name: "effect", version: "3.18.4" }],
    })
    yield* Effect.log(`attestation: ${record.attestationUrl}`)
    // e.g. https://github.com/{owner}/{repo}/attestations/{id} (varies)
  }
})
```

`Attest.provenance` / `.sbom` / `.attest` require `SigstoreSigner | OidcTokenIssuer | GitHubClient`; `.sbom` also requires `Sbom` when it builds the BOM. `listForSubject`'s `predicateType` filter is applied client-side — see the [attestations guide](./10-slsa-attestations.md#idempotent-recovery).

### Sbom

Generate a CycloneDX 1.5 BOM from a resolved dependency graph, serialize it to canonical JSON, or write it to disk.

```typescript
import { Effect } from "effect"
import { Sbom, SbomLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const sbom = yield* Sbom

  const bom = yield* sbom.generate({
    rootName: "@scope/pkg",
    rootVersion: "1.2.3",
    supplier: { name: "Acme, Inc." },
    dependencies: [{ name: "effect", version: "3.18.4" }],
  })
  const json = yield* sbom.serializeJson(bom)
  // json is the canonical CycloneDX JSON form
})
```

### SigstoreSigner

Sign an in-toto statement into a Sigstore DSSE bundle — the structure GitHub's attestations API accepts. `signStatement` requires `OidcTokenIssuer` because Fulcio issues the signing certificate against an OIDC token. Most callers reach `SigstoreSigner` indirectly through `Attest`.

```typescript
import { Effect } from "effect"
import { SigstoreSigner } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const signer = yield* SigstoreSigner
  const bundle = yield* signer.signStatement(statement)
  // bundle is ready to POST as the `bundle` field of the attestation upload
})
```

### OidcTokenIssuer

Request a GitHub Actions OIDC token. The runner exposes the token-service endpoint only when the workflow has `id-token: write`. `getToken(audience)` returns a `Redacted<string>` — unwrap with `Redacted.value` only where you must.

```typescript
import { Effect, Redacted } from "effect"
import { OidcTokenIssuer, SIGSTORE_OIDC_AUDIENCE } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const issuer = yield* OidcTokenIssuer
  const token = yield* issuer.getToken(SIGSTORE_OIDC_AUDIENCE)
  const raw = Redacted.value(token) // unwrap only to feed the pure JWT decoder
})
```

## Step-buffered logging

### Step

`Step` is a top-level namespace, not an injected service. `withStep` runs an Effect with debug/info logs buffered, emitting one summary line on success and spilling the buffer under a `❌` header on failure. `success` sets that summary line; `collapse` reduces N parallel steps to one line; `groupStep` wraps an effect in both a log group and a step.

```typescript
import { Effect } from "effect"
import { Step } from "@savvy-web/github-action-effects"

const program = Step.withStep("resolve versions", Effect.gen(function* () {
  yield* Effect.logDebug("reading workspace manifest")  // buffered on success
  yield* Step.success("7 packages")
  return 7
}))
// On success, one line: ✅ resolve versions: 7 packages
```

See [step-buffered logging patterns](./09-step-logging.md) for `defaultSummary`, `collapse`, `groupStep` and the failure-spill behaviour.

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

`ActionCacheLive` requires `HttpClient.HttpClient` for the Twirp RPCs (provide `FetchHttpClient.layer` or use `ActionsRuntime.Default`). It reads `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN`, which the runner injects only into action (`uses:`) contexts — so the cache works inside a bundled JS action, not a `run:` step. The same constraint applies to `Artifact` below.

### Artifact

Upload, list, download and delete GitHub Actions artifacts — `@actions/artifact` v2 parity over the results backend (Twirp + Azure Block Blob), with no dependency on `@actions/artifact`. `getArtifact` returns `Option.none()` on a miss rather than throwing.

```typescript
import { Effect, Option } from "effect"
import { Artifact, ArtifactLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const artifacts = yield* Artifact

  // Zip files relative to a root dir and upload under a name (unique per run)
  const { id, size } = yield* artifacts.uploadArtifact(
    "build-output",
    ["dist/index.js", "dist/index.js.map"],
    "dist",
    { retentionDays: 7, compressionLevel: 6 },
  )
  yield* Effect.log(`uploaded artifact ${id} (${size} bytes)`)

  // List, look up by name, download by id, delete by name
  const all = yield* artifacts.listArtifacts()
  const found = yield* artifacts.getArtifact("build-output")
  if (Option.isSome(found)) {
    const { downloadPath } = yield* artifacts.downloadArtifact(found.value.id)
    yield* Effect.log(`downloaded to ${downloadPath}`)
  }
  yield* artifacts.deleteArtifact("build-output")
})
```

`ArtifactLive` requires `HttpClient.HttpClient`. Like `ActionCache`, it depends on the runner-injected `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN` and so **must run inside a bundled JS action, not a `run:` step** — those variables are absent from `run:` shell contexts. Pass a `FindBy` (token, run id, owner, repo) to list/get/download/delete across runs or repos through the public REST API instead.

### Glob

Resolve glob patterns and compute `@actions/glob`-compatible file hashes, backed by `node:fs.globSync` with no `@actions/glob` dependency. `glob` returns absolute paths in sorted order; `hashFiles` returns a SHA-256 hash-of-hashes wrapped in an `Option`.

```typescript
import { Effect, Option } from "effect"
import { Glob, GlobLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const glob = yield* Glob

  // Newline- or comma-separated patterns; `!` excludes, `#` comments, `~` HOME.
  const files = yield* glob.glob("src/**/*.ts\n!src/**/*.test.ts")
  yield* Effect.log(`matched ${files.length} files`)

  // Hash-of-hashes over matched files, in sorted glob order. Files outside the
  // workspace root are skipped. Option.none() when nothing matched — the
  // toolkit returns "", which you can recover verbatim:
  const hash = yield* glob.hashFiles("**/package-lock.json")
  const key = `deps-${Option.getOrElse(hash, () => "")}`
})
```

`hashFiles` matches `@actions/glob`'s algorithm exactly: each matched file is streamed through its own SHA-256, and the binary digests are folded — in sorted order — into one accumulating SHA-256 whose hex digest is returned. `GlobOptions`' `followSymbolicLinks`, `implicitDescendants`, `matchDirectories` and `omitBrokenSymbolicLinks` are accepted for parity but are documented no-ops, since `node:fs.globSync` does not expose those controls.

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

### RegistryClassifier

Pure functions that classify a registry URL by parsing it and matching the hostname. Substring matching on URLs is a security issue, so these never use it — `http://evil-npmjs.org` does not pass as npm.

```typescript
import { RegistryClassifier } from "@savvy-web/github-action-effects"

RegistryClassifier.getRegistryType("https://npm.pkg.github.com/")
// → "github-packages"

RegistryClassifier.getRegistryDisplayName("https://registry.npmjs.org/")
// → "npm"

RegistryClassifier.generatePackageViewUrl("https://registry.npmjs.org/", "@scope/pkg")
// → "https://www.npmjs.com/package/@scope/pkg"
```

`getRegistryType` resolves to `"npm"`, `"github-packages"`, `"jsr"` or `"custom"`, with a null or undefined registry resolving to `"npm"` (the publishing default). The predicates `isNpmRegistry`, `isGitHubPackagesRegistry`, `isJsrRegistry` and `isCustomRegistry` answer the same question one registry at a time. See [publishing packages](./11-publishing.md#registry-classification) for how the publish flow uses it.

### PathUtils

Pure path-separator normalizers, matching `@actions/core`'s path utilities. Plain synchronous functions — no Effect, no context.

```typescript
import { PathUtils } from "@savvy-web/github-action-effects"

PathUtils.toPosixPath("a\\b")
// → "a/b"

PathUtils.toWin32Path("a/b")
// → "a\\b"

PathUtils.toPlatformPath("a/b\\c")
// → "a/b/c" on POSIX, "a\\b\\c" on Windows
```

### IoUtil

Locate a binary on `PATH`, mirroring `@actions/io`'s `which` / `findInPath`. `which` and `findInPath` have a `never` error channel — a miss is `Option.none()` / `[]`, not a failure — while `whichOrFail` puts the not-found case in the typed error channel as `IoError`. All three read `FileSystem` from context. See [filesystem I/O](./15-filesystem-io.md) for the full behavior table and the `cp`/`mv`/`rmRF`/`mkdirP` → `FileSystem` recipe.

```typescript
import { Effect, Option } from "effect"
import { IoUtil } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const git = yield* IoUtil.which("git")        // Option<string>, never fails
  if (Option.isNone(git)) {
    yield* Effect.logWarning("git not found on PATH")
  }

  const node = yield* IoUtil.whichOrFail("node") // string, fails with IoError on miss
  const all = yield* IoUtil.findInPath("python")  // every match across PATH, [] on none
})
```

### GithubMarkdown

Pure GitHub-Flavored Markdown builders. The full method table lives in [architecture](./14-architecture.md#githubmarkdown-namespace); two builders worth calling out are `image` and `quote`, which match `@actions/core`'s step-summary `addImage` / `addQuote`.

```typescript
import { GithubMarkdown } from "@savvy-web/github-action-effects"

GithubMarkdown.image("https://example.com/logo.png", "Logo", { width: "120" })
// → <img src="https://example.com/logo.png" alt="Logo" width="120">

GithubMarkdown.quote("All checks passed", "https://example.com/run/123")
// → <blockquote cite="https://example.com/run/123">All checks passed</blockquote>
```

Attribute and text values are interpolated raw, not HTML-escaped — exactly as `@actions/core` does, since GitHub sanitizes step-summary HTML server-side. If you embed the output elsewhere with untrusted input, escape it yourself.
