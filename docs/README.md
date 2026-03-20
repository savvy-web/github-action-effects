# github-action-effects Documentation

Effect-based utility library for building GitHub Actions with structured
logging, typed outputs, GitHub API operations, package publishing, and
composable test layers. Zero `@actions/*` dependencies -- all platform
interactions use native ESM implementations of the GitHub Actions runtime
protocol.

## Installation

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
```

Required peer dependencies:

```bash
npm install effect @effect/platform @effect/platform-node
```

## Table of Contents

- [Example Action](./example-action.md) -- End-to-end walkthrough building a
  GitHub Action
- [Advanced Action](./advanced-action.md) -- Three-stage app (pre/main/post)
  with GitHub App auth, state, and log levels
- [Services Guide](./services.md) -- Detailed guide for each service with usage
  examples
- [Architecture](./architecture.md) -- Runtime layer, layer composition, and
  logging pipeline
- [Peer Dependencies](./peer-dependencies.md) -- Required peer
  dependencies
- [Testing Guide](./testing.md) -- Testing with in-memory test layers
- [Patterns](./patterns.md) -- Common patterns: dry-run, error accumulation,
  permission checking, workspace detection
- [Error Handling](./error-handling.md) -- `Action.formatCause`, `Action.run`
  error handling, and the `[Tag] message` format

## How Inputs Work

Inputs use Effect's `Config` API, backed by `ActionsConfigProvider` which reads
`INPUT_*` environment variables:

```typescript
import { Config, Effect } from "effect"

const program = Effect.gen(function* () {
  const name = yield* Config.string("package-name")  // reads INPUT_PACKAGE-NAME
  const count = yield* Config.integer("count")        // reads INPUT_COUNT
  const debug = yield* Config.boolean("debug").pipe(Config.withDefault(false))
})
```

## Services at a Glance

### Core Services (provided by ActionsRuntime.Default / Action.run)

| Service | Purpose |
| --- | --- |
| ActionLogger | Structured logging with group, withBuffer, annotationError/Warning/Notice |
| ActionOutputs | Typed outputs (set, setJson, summary, exportVariable, addPath, setFailed, setSecret) |
| ActionState | Schema-serialized state for multi-phase actions (save, get, getOptional) |
| ActionEnvironment | Typed access to GITHUB_*and RUNNER_* env vars |

### Extended Services (provide via additional layers)

| Service | Purpose |
| --- | --- |
| ActionCache | Save/restore with withCache bracket pattern |
| GitHubClient | Octokit REST/GraphQL with pagination (uses @octokit/rest directly) |
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
| ToolInstaller | Download, extract, cache tool binaries (archives and standalone binaries) |

## Namespace Objects

| Namespace | Purpose |
| --- | --- |
| `Action` | Top-level helpers: `run`, `formatCause`, `resolveLogLevel` |
| `GithubMarkdown` | Pure GFM builder functions: `table`, `heading`, `bold`, `details`, `checklist`, etc. |
| `AutoMerge` | Enable/disable PR auto-merge via GraphQL |
| `SemverResolver` | Semver comparison, range satisfaction, increment, parse |
| `ErrorAccumulator` | Process items collecting all successes and failures |
| `ReportBuilder` | Fluent builder for markdown reports |

## See Also

See the [project README](../README.md) for a quick-start example.

For build tooling and the action runner, see the companion package
`@savvy-web/github-action-builder`.
