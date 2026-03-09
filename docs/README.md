# github-action-effects Documentation

Effect-based utility library for building GitHub Actions with schema-validated
inputs, structured logging, typed outputs, GitHub API operations, package
publishing, OpenTelemetry tracing, and composable test layers.

## Installation

```bash
npm install @savvy-web/github-action-effects
```

Required peer dependencies:

```bash
npm install effect @actions/core @effect/platform @effect/platform-node
```

Optional peer dependencies (install as needed):

```bash
# GitHub API services (GitHubClient, GitHubRelease, CheckRun, etc.)
npm install @actions/github

# Shell command execution (CommandRunner)
npm install @actions/exec

# GitHub Actions cache (ActionCache)
npm install @actions/cache

# Tool binary installation (ToolInstaller)
npm install @actions/tool-cache

# GitHub App authentication (GitHubApp)
npm install @octokit/auth-app

# OpenTelemetry export
npm install @effect/opentelemetry @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/resources

# Config file loading (ConfigLoader)
npm install jsonc-parser yaml
```

## Table of Contents

- [Example Action](./example-action.md) -- End-to-end walkthrough building a
  GitHub Action
- [Services Guide](./services.md) -- Detailed guide for each service with usage
  examples
- [Architecture](./architecture.md) -- API reference, layer composition, and
  logging pipeline
- [Testing Guide](./testing.md) -- Testing with in-memory test layers
- [OpenTelemetry](./otel.md) -- OTel configuration, tracing, and metrics
- [Patterns](./patterns.md) -- Common patterns: dry-run, error accumulation,
  permission checking, workspace detection

## Services at a Glance

### Core Services (provided by Action.run)

| Service | Purpose |
| --- | --- |
| ActionInputs | Schema-validated input reading (get, getOptional, getSecret, getJson, getMultiline, getBoolean) |
| ActionLogger | Structured logging with group, withBuffer, annotationError/Warning/Notice |
| ActionOutputs | Typed outputs (set, setJson, summary, exportVariable, addPath, setFailed, setSecret) |

### Extended Services (provide via additional layers)

| Service | Purpose |
| --- | --- |
| ActionState | Schema-serialized state for multi-phase actions (save, get, getOptional) |
| ActionEnvironment | Typed access to GITHUB_*and RUNNER_* env vars |
| ActionCache | Save/restore with withCache bracket pattern |
| ActionTelemetry | Record metrics, annotate spans |
| GitHubClient | Octokit REST/GraphQL with pagination |
| GitHubGraphQL | Typed GraphQL queries and mutations |
| GitHubRelease | Create releases, upload assets, list/get by tag |
| GitHubIssue | List, close, comment, get linked issues |
| GitHubApp | GitHub App token lifecycle with bracket pattern |
| CheckRun | Create, update, complete check runs with annotations |
| PullRequest | PR lifecycle: get, list, create, update, merge, getOrCreate, labels, reviewers |
| PullRequestComment | Sticky (upsert) PR comments with marker keys |
| GitTag | CRUD for tags via Git Data API |
| GitBranch | CRUD for branches via Git Data API |
| GitCommit | Create trees, commits, update refs (supports file deletions via `sha: null`) |
| CommandRunner | Structured shell execution with capture and JSON parsing |
| ConfigLoader | Load and validate JSON, JSONC, YAML config files |
| DryRun | Mutation guard with fallback values |
| NpmRegistry | Query npm for versions, dist-tags, package info |
| PackagePublish | Auth, pack, publish, verify, multi-registry |
| PackageManagerAdapter | Auto-detect and use npm/pnpm/yarn/bun/deno |
| WorkspaceDetector | Detect monorepo type and list packages |
| ChangesetAnalyzer | Parse and generate changeset files |
| TokenPermissionChecker | Check/assert GitHub token permissions |
| RateLimiter | Rate limit guard with exponential backoff |
| WorkflowDispatch | Trigger workflows and poll until completion |
| ToolInstaller | Download, extract, cache tool binaries |

## Namespace Objects

| Namespace | Purpose |
| --- | --- |
| `Action` | Top-level helpers: `run`, `parseInputs`, `makeLogger`, `setLogLevel`, `resolveLogLevel` |
| `GithubMarkdown` | Pure GFM builder functions: `table`, `heading`, `bold`, `details`, `checklist`, etc. |
| `AutoMerge` | Enable/disable PR auto-merge via GraphQL |
| `SemverResolver` | Semver comparison, range satisfaction, increment, parse |
| `ErrorAccumulator` | Process items collecting all successes and failures |
| `GitHubOtelAttributes` | Map GitHub env vars to OTel resource attributes |
| `ReportBuilder` | Fluent builder for markdown reports |
| `TelemetryReport` | Render span timings and metrics as GFM |

## See Also

See the [project README](../README.md) for a quick-start example.

For build tooling and the action runner, see the companion package
`@savvy-web/github-action-builder`.
