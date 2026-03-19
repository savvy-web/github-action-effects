# Services Guide

This guide covers each service in `@savvy-web/github-action-effects` with
usage examples. For API-level method signatures, see
[architecture.md](./architecture.md). For testing, see
[testing.md](./testing.md).

## Core Services

These three services are provided automatically by `Action.run`.

### ActionInputs

Read and validate action inputs with Effect Schema.

```typescript
import { Effect, Schema } from "effect";
import { ActionInputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs;

  // Required string input
  const name = yield* inputs.get("package-name", Schema.String);

  // Optional input with Option return
  const branch = yield* inputs.getOptional("branch", Schema.String);

  // Boolean input (accepts "true"/"false", case-insensitive)
  const dryRun = yield* inputs.getBoolean("dry-run");

  // Optional boolean with default
  const verbose = yield* inputs.getBooleanOptional("verbose", false);

  // Secret input (masked in logs)
  const token = yield* inputs.getSecret("token", Schema.String);

  // JSON input (parsed and validated)
  const config = yield* inputs.getJson("config", Schema.Struct({
    threshold: Schema.Number,
  }));

  // Multiline input (newline-delimited, comments filtered)
  const packages = yield* inputs.getMultiline("packages", Schema.String);
});
```

#### Batch Reading with Action.parseInputs

For actions with many inputs, read them all at once:

```typescript
import { Effect, Schema } from "effect";
import { Action } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* Action.parseInputs({
    "app-id": { schema: Schema.NumberFromString },
    "branch": { schema: Schema.String, default: "main" },
    "config": { schema: ConfigSchema, json: true },
    "packages": { schema: Schema.String, multiline: true },
    "token": { schema: Schema.String, secret: true },
    "dry-run": { schema: Schema.Boolean, default: false },
  });

  // inputs is fully typed: { "app-id": number, branch: string, ... }
});
```

An optional second argument provides cross-validation:

```typescript
const inputs = yield* Action.parseInputs(config, (parsed) => {
  if (parsed.branch === "main" && parsed["dry-run"]) {
    return Effect.fail(new ActionInputError({
      inputName: "dry-run",
      reason: "Cannot dry-run on main branch",
    }));
  }
  return Effect.succeed(parsed);
});
```

### ActionLogger

Structured logging beyond the built-in Effect logger.

```typescript
import { Effect } from "effect";
import { ActionLogger } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger;

  // Collapsible log group in the Actions UI
  const result = yield* logger.group("Build", Effect.gen(function* () {
    yield* Effect.log("Compiling...");
    yield* Effect.log("Done");
    return 42;
  }));

  // Buffer-on-failure: captures verbose logs, flushes only on error
  yield* logger.withBuffer("analysis", Effect.gen(function* () {
    yield* Effect.log("Step 1...");
    yield* Effect.log("Step 2...");
    // If this succeeds, buffered logs are discarded
    // If this fails, buffered logs flush for debugging
  }));

  // File/line annotations (appear inline on PR diffs)
  yield* logger.annotationError("Check failed", {
    file: "src/index.ts",
    startLine: 10,
  });
  yield* logger.annotationWarning("Deprecated API", {
    file: "src/helpers.ts",
    startLine: 42,
  });
  yield* logger.annotationNotice("New feature available");
});
```

### ActionOutputs

Set outputs, write summaries, export variables.

```typescript
import { Effect, Schema } from "effect";
import { ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs;

  // String output
  yield* outputs.set("status", "success");

  // Schema-validated JSON output
  yield* outputs.setJson("report", { total: 10, passed: 9 }, ReportSchema);

  // Step summary (markdown)
  yield* outputs.summary("## Results\n\nAll checks passed.");

  // Environment variable for subsequent steps
  yield* outputs.exportVariable("MY_TOKEN", token);

  // Add to PATH
  yield* outputs.addPath("/usr/local/bin/custom-tool");

  // Mask a runtime value in logs
  yield* outputs.setSecret(generatedToken);

  // Mark action as failed
  yield* outputs.setFailed("Something went wrong");
});
```

## State and Environment

### ActionState

Transfer typed data across action phases (pre/main/post).

```typescript
import { Effect, Schema } from "effect";
import { Action, ActionState, ActionStateLive } from "@savvy-web/github-action-effects";

const TimingSchema = Schema.Struct({ startedAt: Schema.Number });

// pre.ts -- save state
const pre = Effect.gen(function* () {
  const state = yield* ActionState;
  yield* state.save("timing", { startedAt: Date.now() }, TimingSchema);
});

Action.run(pre, ActionStateLive);

// post.ts -- read state
const post = Effect.gen(function* () {
  const state = yield* ActionState;
  const timing = yield* state.get("timing", TimingSchema);
  yield* Effect.log(`Elapsed: ${Date.now() - timing.startedAt}ms`);
});

Action.run(post, ActionStateLive);
```

### ActionEnvironment

Read GitHub Actions environment variables with typed contexts.

```typescript
import { Effect } from "effect";
import { ActionEnvironment, ActionEnvironmentLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const env = yield* ActionEnvironment;

  // Read a required env var
  const ref = yield* env.get("GITHUB_REF");

  // Read optional env var
  const debug = yield* env.getOptional("RUNNER_DEBUG");

  // Structured GitHub context (all GITHUB_* vars, validated)
  const github = yield* env.github;
  // github.repository, github.sha, github.ref, etc.

  // Structured runner context (all RUNNER_* vars, validated)
  const runner = yield* env.runner;
});
```

## GitHub API Services

These services require `@actions/github` as a peer dependency.

### GitHubClient

Low-level Octokit wrapper for REST and GraphQL calls.

```typescript
import { Effect } from "effect";
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const client = yield* GitHubClient;

  // REST API call
  const release = yield* client.rest("getLatestRelease", (octokit) =>
    octokit.repos.getLatestRelease({ owner: "org", repo: "repo" })
  );

  // Paginated REST call
  const issues = yield* client.paginate("listIssues", (octokit, page, perPage) =>
    octokit.issues.listForRepo({ owner: "org", repo: "repo", page, per_page: perPage })
  );

  // Repository context
  const { owner, repo } = yield* client.repo;
});
```

### GitHubRelease

Create and manage GitHub releases.

```typescript
import { Effect } from "effect";
import { GitHubRelease, GitHubReleaseLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const releases = yield* GitHubRelease;

  const release = yield* releases.create({
    tag: "v1.0.0",
    name: "Version 1.0.0",
    body: "## Changes\n\n- Feature A\n- Fix B",
    generateReleaseNotes: true,
  });

  yield* releases.uploadAsset(
    release.id,
    "checksums.txt",
    checksumData,
    "text/plain",
  );

  const existing = yield* releases.getByTag("v0.9.0");
  const all = yield* releases.list({ perPage: 10 });
});
```

### GitHubIssue

Manage issues and linked PR issues.

```typescript
import { Effect } from "effect";
import { GitHubIssue, GitHubIssueLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const issues = yield* GitHubIssue;

  const openBugs = yield* issues.list({
    state: "open",
    labels: ["bug"],
  });

  yield* issues.close(42, "completed");
  yield* issues.comment(42, "Fixed in v1.0.0");

  // Get issues linked to a PR via closing references
  const linked = yield* issues.getLinkedIssues(123);
});
```

### CheckRun

Create check runs with annotations for PR feedback.

```typescript
import { Effect } from "effect";
import { CheckRun, CheckRunLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const checkRun = yield* CheckRun;

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
      });
    })
  );
});
```

### PullRequest

Full pull request lifecycle management: get, list, create, update, merge,
and the idempotent `getOrCreate` pattern.

```typescript
import { Effect } from "effect";
import { PullRequest, PullRequestLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const pr = yield* PullRequest;

  // Get a single PR
  const info = yield* pr.get(123);

  // List open PRs targeting main
  const prs = yield* pr.list({ base: "main", state: "open" });

  // Create a PR with optional auto-merge
  const created = yield* pr.create({
    title: "chore: update deps",
    body: "Automated dependency update",
    head: "deps/update",
    base: "main",
    autoMerge: "squash",
  });

  // Idempotent: find existing PR for head->base or create one
  const { created: isNew } = yield* pr.getOrCreate({
    head: "release/v1",
    base: "main",
    title: "Release v1.0.0",
    body: "Release notes",
  });

  // Merge a PR
  yield* pr.merge(created.number, { method: "squash" });

  // Add labels and request reviewers
  yield* pr.addLabels(created.number, ["automated", "dependencies"]);
  yield* pr.requestReviewers(created.number, {
    reviewers: ["octocat"],
    teamReviewers: ["core-team"],
  });
});
```

### PullRequestComment

Create and manage PR comments with sticky (upsert) support.

```typescript
import { Effect } from "effect";
import { PullRequestComment, PullRequestCommentLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const prComment = yield* PullRequestComment;

  // Upsert a sticky comment (identified by hidden HTML marker)
  yield* prComment.upsert(123, "build-report", "## Build Report\n\nAll passed.");

  // Find existing comment by marker
  const existing = yield* prComment.find(123, "build-report");

  // Create a one-off comment
  yield* prComment.create(123, "Manual comment");
});
```

### GitTag, GitBranch, GitCommit

Low-level Git Data API operations.

```typescript
import { Effect } from "effect";
import {
  GitTag, GitTagLive,
  GitBranch, GitBranchLive,
  GitCommit, GitCommitLive,
} from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const tags = yield* GitTag;
  const branches = yield* GitBranch;
  const commits = yield* GitCommit;

  // Tags
  yield* tags.create("v1.0.0", sha);
  const allTags = yield* tags.list("v1.");
  const tagSha = yield* tags.resolve("v1.0.0");

  // Branches
  yield* branches.create("release/v1", sha);
  const exists = yield* branches.exists("release/v1");
  yield* branches.reset("main", newSha);

  // Commits (verified via Git Data API)
  const commitSha = yield* commits.commitFiles("main", "chore: update", [
    { path: "package.json", content: newContent },
    { path: "obsolete.config.js", sha: null },  // delete a file
  ]);
});
```

### GitHubApp

GitHub App authentication with automatic token revocation.

```typescript
import { Effect } from "effect";
import { GitHubApp, GitHubAppLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const app = yield* GitHubApp;

  // Bracket pattern: token is always revoked, even on failure
  yield* app.withToken(appId, privateKey, (token) =>
    Effect.gen(function* () {
      // Use token for API calls
      yield* Effect.log(`Token expires at ${token}`);
    })
  );
});
```

### GitHubGraphQL

Typed GraphQL queries and mutations.

```typescript
import { Effect } from "effect";
import { GitHubGraphQL, GitHubGraphQLLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const gql = yield* GitHubGraphQL;

  const data = yield* gql.query<{ repository: { id: string } }>(
    "getRepoId",
    `query { repository(owner: "org", name: "repo") { id } }`,
  );
});
```

## Command Execution

### CommandRunner

Structured shell command execution with capture and parsing.

```typescript
import { Effect, Schema } from "effect";
import { CommandRunner, CommandRunnerLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const runner = yield* CommandRunner;

  // Run and get exit code
  yield* runner.exec("npm", ["install"], { cwd: "/app" });

  // Capture stdout/stderr
  const output = yield* runner.execCapture("git", ["status"]);

  // Parse JSON output with schema validation
  const pkg = yield* runner.execJson(
    "npm", ["view", "effect", "--json"],
    Schema.Struct({ name: Schema.String, version: Schema.String }),
  );

  // Get stdout as lines
  const files = yield* runner.execLines("git", ["diff", "--name-only"]);
});
```

## Package Management

### NpmRegistry

Query npm registry for package information.

```typescript
import { Effect } from "effect";
import { NpmRegistry, NpmRegistryLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const npm = yield* NpmRegistry;

  const latest = yield* npm.getLatestVersion("effect");
  const tags = yield* npm.getDistTags("effect");
  const versions = yield* npm.getVersions("effect");
  const info = yield* npm.getPackageInfo("effect", "3.0.0");
});
```

### PackagePublish

Publish packages to one or more registries.

```typescript
import { Effect } from "effect";
import { PackagePublish, PackagePublishLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish;

  yield* publisher.setupAuth("https://registry.npmjs.org/", npmToken);

  const { tarball, digest } = yield* publisher.pack("./dist/npm");

  yield* publisher.publish("./dist/npm", {
    registry: "https://registry.npmjs.org/",
    tag: "latest",
    access: "public",
    provenance: true,
  });

  // Or publish to multiple registries at once
  yield* publisher.publishToRegistries("./dist/npm", [
    { registry: "https://registry.npmjs.org/", token: npmToken },
    { registry: "https://npm.pkg.github.com/", token: ghToken },
  ]);

  // Verify integrity after publishing
  const ok = yield* publisher.verifyIntegrity("my-pkg", "1.0.0", digest);
});
```

### WorkspaceDetector

Detect and query monorepo workspaces.

```typescript
import { Effect } from "effect";
import { WorkspaceDetector, WorkspaceDetectorLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const workspaces = yield* WorkspaceDetector;

  const info = yield* workspaces.detect();
  // info.type: "pnpm" | "npm" | "yarn" | "single"

  const packages = yield* workspaces.listPackages();
  const pkg = yield* workspaces.getPackage("@scope/my-package");
});
```

### PackageManagerAdapter

Unified interface for npm, pnpm, yarn, bun, and deno.

```typescript
import { Effect } from "effect";
import { PackageManagerAdapter, PackageManagerAdapterLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const pm = yield* PackageManagerAdapter;

  const info = yield* pm.detect();
  // info.name: "npm" | "pnpm" | "yarn" | "bun" | "deno"

  yield* pm.install({ frozen: true, cwd: "/app" });
  const cachePaths = yield* pm.getCachePaths();
  const lockfiles = yield* pm.getLockfilePaths();
});
```

### ChangesetAnalyzer

Work with changeset files for versioning.

```typescript
import { Effect } from "effect";
import { ChangesetAnalyzer, ChangesetAnalyzerLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const changesets = yield* ChangesetAnalyzer;

  const hasAny = yield* changesets.hasChangesets();
  const all = yield* changesets.parseAll();

  yield* changesets.generate(
    [{ name: "@scope/pkg", bump: "minor" }],
    "Added new feature X",
  );
});
```

## Infrastructure Services

### ActionCache

GitHub Actions cache with bracket pattern.

```typescript
import { Effect } from "effect";
import { ActionCache, ActionCacheLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const cache = yield* ActionCache;

  // Bracket: restore, run, save if miss
  yield* cache.withCache(
    "node-modules-v1",
    ["node_modules"],
    Effect.gen(function* () {
      yield* Effect.log("Installing dependencies...");
      // install logic
    }),
    ["node-modules-"], // restore key prefixes
  );
});
```

### TokenPermissionChecker

Verify GitHub token permissions before using them.

```typescript
import { Effect } from "effect";
import { TokenPermissionChecker, TokenPermissionCheckerLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const checker = yield* TokenPermissionChecker;

  // Fail if permissions are missing
  yield* checker.assertSufficient({
    contents: "write",
    "pull-requests": "write",
  });

  // Or just warn about over-permissioned tokens
  yield* checker.warnOverPermissioned({
    contents: "read",
  });
});
```

### DryRun

Guard mutations with a dry-run flag.

```typescript
import { Effect } from "effect";
import { DryRun, DryRunLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const dryRun = yield* DryRun;

  const isDry = yield* dryRun.isDryRun;

  // Skip the effect in dry-run mode, return fallback value
  yield* dryRun.guard(
    "publish",
    publisher.publish("./dist"),
    undefined, // fallback
  );
});
```

### RateLimiter

Guard API calls with rate limit awareness.

```typescript
import { Effect } from "effect";
import { RateLimiter, RateLimiterLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter;

  // Guard: waits if rate limit is low
  yield* limiter.withRateLimit(apiCall);

  // Retry with exponential backoff
  yield* limiter.withRetry(flakyApiCall, {
    maxRetries: 3,
    baseDelay: 1000,
  });
});
```

### ConfigLoader

Load and validate configuration files.

```typescript
import { Effect, Schema } from "effect";
import { ConfigLoader, ConfigLoaderLive } from "@savvy-web/github-action-effects";

const MyConfig = Schema.Struct({
  version: Schema.Number,
  features: Schema.Array(Schema.String),
});

const program = Effect.gen(function* () {
  const loader = yield* ConfigLoader;

  const exists = yield* loader.exists("config.json");
  const config = yield* loader.loadJson("config.json", MyConfig);
  const jsonc = yield* loader.loadJsonc("tsconfig.json", TsConfigSchema);
  const yaml = yield* loader.loadYaml("config.yml", MyConfig);
});
```

### WorkflowDispatch

Trigger and monitor GitHub Actions workflows.

```typescript
import { Effect } from "effect";
import { WorkflowDispatch, WorkflowDispatchLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const dispatch = yield* WorkflowDispatch;

  // Fire and forget
  yield* dispatch.dispatch("deploy.yml", "main", { environment: "staging" });

  // Trigger and wait for completion
  const conclusion = yield* dispatch.dispatchAndWait(
    "deploy.yml",
    "main",
    { environment: "production" },
    { intervalMs: 15000, timeoutMs: 600000 },
  );
});
```

### ToolInstaller

Download, cache, and install tool binaries. Supports both archived tools
(tar.gz, tar.xz, zip) and standalone binary files.

```typescript
import { Effect } from "effect";
import { ToolInstaller, ToolInstallerLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const tools = yield* ToolInstaller;

  const isCached = yield* tools.isCached("my-tool", "1.0.0");

  // Download, extract an archive, cache, and add to PATH
  yield* tools.installAndAddToPath(
    "my-tool",
    "1.0.0",
    "https://github.com/org/my-tool/releases/download/v1.0.0/my-tool-linux-x64.tar.gz",
    { archiveType: "tar.gz", binSubPath: "bin" },
  );

  // Download a standalone binary, cache, chmod, and add to PATH
  yield* tools.installBinaryAndAddToPath(
    "biome",
    "1.9.0",
    "https://github.com/biomejs/biome/releases/download/cli%2Fv1.9.0/biome-linux-x64",
    { binaryName: "biome" },
  );
});
```
