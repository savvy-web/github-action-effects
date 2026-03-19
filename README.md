# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org/)

Composable [Effect](https://effect.website) services for building Node.js 24 GitHub Actions with schema-validated inputs, structured logging, GitHub API operations, package publishing, and more -- without the boilerplate.

## Features

- **Schema-validated inputs/outputs** -- read, parse, and validate action inputs and outputs with Effect Schema
- **Structured logging** -- three-tier logger (info/verbose/debug) with buffer-on-failure and collapsible groups
- **GitHub API services** -- releases, issues, PRs, check runs, branches, tags, commits, and GraphQL via Octokit
- **Package publishing** -- npm registry queries, multi-registry publish, workspace detection, changeset analysis
- **In-memory test layers** -- every service ships with a test layer for fast, deterministic tests
- **Platform abstraction** -- `@actions/*` packages wrapped in Effect services for dependency injection and custom platform overrides
- **Test-friendly imports** -- `./testing` subpath provides everything without triggering `@actions/*` module resolution

## Installation

```bash
# @effect/cluster, @effect/rpc, and @effect/sql are transitive peers required
# by @effect/platform-node — they are not used directly by your action code.
npm install @savvy-web/github-action-effects effect @actions/core \
  @effect/platform @effect/platform-node \
  @effect/cluster @effect/rpc @effect/sql
```

## Quick Start

```typescript
import { Effect, Schema } from "effect";
import { Action, ActionInputs, ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const inputs = yield* ActionInputs;
  const outputs = yield* ActionOutputs;
  const name = yield* inputs.get("package-name", Schema.String);
  yield* outputs.set("result", `checked ${name}`);
});

Action.run(program);
```

`Action.run` provides all core service layers (including `NodeContext.layer` for `FileSystem`, `Path`, `Terminal`, `CommandExecutor`, and `WorkerManager` from `@effect/platform`), installs the Effect logger, and catches errors with `core.setFailed` automatically.

Pass additional layers or a custom platform via the options object:

```typescript
// Provide extra services
Action.run(program, { layer: Layer.mergeAll(ActionStateLive, DryRunLive) });

// Override the @actions/* platform (e.g., for testing or patched deps)
Action.run(program, { platform: myCustomPlatformLayer });
```

## Services

### Action Services (27)

| Service | Description |
| --- | --- |
| ActionInputs | Schema-validated input reading (string, JSON, multiline, boolean, secret) |
| ActionLogger | Collapsible groups, buffer-on-failure, file/line annotations |
| ActionOutputs | Typed outputs, step summaries, env vars, PATH, setFailed, setSecret |
| ActionState | Schema-serialized state transfer across pre/main/post phases |
| ActionEnvironment | Typed access to GITHUB_\* and RUNNER_\* environment variables |
| ActionCache | Save/restore/withCache bracket for GitHub Actions cache |
| GitHubClient | Octokit REST and GraphQL with pagination |
| GitHubGraphQL | Typed GraphQL queries and mutations |
| GitHubRelease | Create releases, upload assets, list/get by tag |
| GitHubIssue | List, close, comment, get linked issues from PRs |
| GitHubApp | GitHub App token generation and revocation with bracket pattern |
| CheckRun | Create, update, complete check runs with annotations |
| PullRequest | Get, list, create, update, merge PRs; getOrCreate, labels, reviewers |
| PullRequestComment | Create, upsert (sticky), find, delete PR comments |
| GitTag | Create, delete, list, resolve tags via Git Data API |
| GitBranch | Create, delete, exists, getSha, reset branches |
| GitCommit | Create trees, commits, update refs, commitFiles convenience (supports file deletions) |
| CommandRunner | Structured shell exec with capture, JSON parsing, line splitting |
| ConfigLoader | Load and validate JSON, JSONC, YAML config files |
| DryRun | Mutation guard that skips side effects with a fallback value |
| NpmRegistry | Query npm for versions, dist-tags, package info |
| PackagePublish | Auth setup, pack, publish, verify integrity, multi-registry |
| PackageManagerAdapter | Auto-detect npm/pnpm/yarn/bun/deno, install, exec |
| WorkspaceDetector | Detect monorepo type, list packages, get package by name/path |
| ChangesetAnalyzer | Parse changeset files, check existence, generate new changesets |
| TokenPermissionChecker | Check, assert, or warn about GitHub token permission gaps |
| RateLimiter | Rate limit awareness with guard and exponential backoff retry |
| WorkflowDispatch | Trigger workflows, poll until completion, get run status |
| ToolInstaller | Download, extract, cache, and add tool binaries to PATH |

### Platform Wrapper Services (6)

Live layers no longer import `@actions/*` directly. Instead, these wrapper services provide `@actions/*` packages via Effect dependency injection:

| Service | Wraps | Live Layer |
| --- | --- | --- |
| ActionsCore | `@actions/core` | ActionsCoreLive |
| ActionsGitHub | `@actions/github` | ActionsGitHubLive |
| ActionsCache | `@actions/cache` | ActionsCacheLive |
| ActionsExec | `@actions/exec` | ActionsExecLive |
| ActionsToolCache | `@actions/tool-cache` | ActionsToolCacheLive |
| OctokitAuthApp | `@octokit/auth-app` | OctokitAuthAppLive |

`ActionsPlatformLive` bundles all six for convenience. `Action.run()` provides it by default.

## Utility Namespaces

| Namespace | Description |
| --- | --- |
| `GithubMarkdown` | Pure GFM builders: tables, headings, details, checklists, status icons, code blocks |
| `AutoMerge` | Enable/disable PR auto-merge via GraphQL |
| `SemverResolver` | Compare, satisfy, increment, parse semver versions with Effect error handling |
| `ErrorAccumulator` | Process all items collecting successes and failures without short-circuiting |
| `ReportBuilder` | Fluent builder for markdown reports -- render to summary, PR comment, or check run |

## Testing

Import from the `./testing` subpath in test files -- it provides all service tags, test layers, errors, schemas, and utils without triggering any `@actions/*` module resolution.

```typescript
import { Effect, Layer, Schema } from "effect";
import {
  ActionInputs,
  ActionInputsTest,
  ActionOutputs,
  ActionOutputsTest,
  ActionLoggerTest,
} from "@savvy-web/github-action-effects/testing";

const outputState = ActionOutputsTest.empty();
const TestLayer = Layer.mergeAll(
  ActionInputsTest({ "package-name": "my-pkg" }),
  ActionOutputsTest.layer(outputState),
  ActionLoggerTest.layer(ActionLoggerTest.empty()),
);

await Effect.gen(function* () {
  const inputs = yield* ActionInputs;
  const outputs = yield* ActionOutputs;
  const name = yield* inputs.get("package-name", Schema.String);
  yield* outputs.set("result", name);
}).pipe(Effect.provide(TestLayer), Effect.runPromise);

expect(outputState.outputs).toContainEqual({ name: "result", value: "my-pkg" });
```

For integration testing with real Live layer logic, provide mock platform wrappers:

```typescript
import { ActionInputsLive, ActionsCore } from "@savvy-web/github-action-effects/testing";

const mockPlatform = Layer.succeed(ActionsCore, {
  getInput: vi.fn().mockReturnValue("test-value"),
  // ... other ActionsCore methods
});
const layer = ActionInputsLive.pipe(Layer.provide(mockPlatform));
```

## Documentation

- [Example Action](./docs/example-action.md) -- end-to-end tutorial
- [Advanced Action](./docs/advanced-action.md) -- three-stage app (pre/main/post) with GitHub App auth, state, and log levels
- [Services Guide](./docs/services.md) -- detailed guide for each service
- [Architecture](./docs/architecture.md) -- API reference and layer composition
- [Peer Dependencies](./docs/peer-dependencies.md) -- required and optional peer dependencies with service mapping
- [Testing](./docs/testing.md) -- testing with in-memory layers
- [Patterns](./docs/patterns.md) -- dry-run mode, error accumulation, permission checking, and more
- [Error Handling](./docs/error-handling.md) -- `Action.formatCause` and error handling patterns

## License

[MIT](LICENSE)
