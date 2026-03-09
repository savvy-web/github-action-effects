# @savvy-web/github-action-effects

[![npm version](https://img.shields.io/npm/v/@savvy-web/github-action-effects)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org/)

Composable [Effect](https://effect.website) services for building Node.js 24 GitHub Actions with schema-validated inputs, structured logging, GitHub API operations, package publishing, OpenTelemetry tracing, and more -- without the boilerplate.

## Features

- **Schema-validated inputs/outputs** -- read, parse, and validate action inputs and outputs with Effect Schema
- **Structured logging** -- three-tier logger (info/verbose/debug) with buffer-on-failure and collapsible groups
- **GitHub API services** -- releases, issues, PRs, check runs, branches, tags, commits, and GraphQL via Octokit
- **Package publishing** -- npm registry queries, multi-registry publish, workspace detection, changeset analysis
- **OpenTelemetry integration** -- opt-in tracing and metrics with auto-configured OTLP export
- **In-memory test layers** -- every service ships with a test layer for fast, deterministic tests

## Installation

```bash
npm install @savvy-web/github-action-effects effect @actions/core @effect/platform @effect/platform-node
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

`Action.run` provides all core service layers (including `NodeContext.layer` for `FileSystem`, `Path`, `Terminal`, `CommandExecutor`, and `WorkerManager` from `@effect/platform`), installs the Effect logger, auto-configures OTel tracing, and catches errors with `core.setFailed` automatically.

## Services

| Service | Description | Required Peer Deps |
| --- | --- | --- |
| ActionInputs | Schema-validated input reading (string, JSON, multiline, boolean, secret) | `@actions/core` |
| ActionLogger | Collapsible groups, buffer-on-failure, file/line annotations | `@actions/core` |
| ActionOutputs | Typed outputs, step summaries, env vars, PATH, setFailed, setSecret | `@actions/core` |
| ActionState | Schema-serialized state transfer across pre/main/post phases | `@actions/core` |
| ActionEnvironment | Typed access to GITHUB_*and RUNNER_* environment variables | `@actions/core` |
| ActionCache | Save/restore/withCache bracket for GitHub Actions cache | `@actions/cache` |
| ActionTelemetry | Record numeric metrics, annotate spans | -- |
| GitHubClient | Octokit REST and GraphQL with pagination | `@actions/github` |
| GitHubGraphQL | Typed GraphQL queries and mutations | `@actions/github` |
| GitHubRelease | Create releases, upload assets, list/get by tag | `@actions/github` |
| GitHubIssue | List, close, comment, get linked issues from PRs | `@actions/github` |
| GitHubApp | GitHub App token generation and revocation with bracket pattern | `@octokit/auth-app` |
| CheckRun | Create, update, complete check runs with annotations | `@actions/github` |
| PullRequest | Get, list, create, update, merge PRs; getOrCreate, labels, reviewers | `@actions/github` |
| PullRequestComment | Create, upsert (sticky), find, delete PR comments | `@actions/github` |
| GitTag | Create, delete, list, resolve tags via Git Data API | `@actions/github` |
| GitBranch | Create, delete, exists, getSha, reset branches | `@actions/github` |
| GitCommit | Create trees, commits, update refs, commitFiles convenience (supports file deletions) | `@actions/github` |
| CommandRunner | Structured shell exec with capture, JSON parsing, line splitting | `@actions/exec` |
| ConfigLoader | Load and validate JSON, JSONC, YAML config files | `jsonc-parser`, `yaml` |
| DryRun | Mutation guard that skips side effects with a fallback value | -- |
| NpmRegistry | Query npm for versions, dist-tags, package info | -- |
| PackagePublish | Auth setup, pack, publish, verify integrity, multi-registry | -- |
| PackageManagerAdapter | Auto-detect npm/pnpm/yarn/bun/deno, install, exec | -- |
| WorkspaceDetector | Detect monorepo type, list packages, get package by name/path | -- |
| ChangesetAnalyzer | Parse changeset files, check existence, generate new changesets | -- |
| TokenPermissionChecker | Check, assert, or warn about GitHub token permission gaps | `@actions/github` |
| RateLimiter | Rate limit awareness with guard and exponential backoff retry | `@actions/github` |
| WorkflowDispatch | Trigger workflows, poll until completion, get run status | `@actions/github` |
| ToolInstaller | Download, extract, cache, and add tool binaries to PATH | `@actions/tool-cache` |

## Utility Namespaces

| Namespace | Description |
| --- | --- |
| `GithubMarkdown` | Pure GFM builders: tables, headings, details, checklists, status icons, code blocks |
| `AutoMerge` | Enable/disable PR auto-merge via GraphQL |
| `SemverResolver` | Compare, satisfy, increment, parse semver versions with Effect error handling |
| `ErrorAccumulator` | Process all items collecting successes and failures without short-circuiting |
| `GitHubOtelAttributes` | Map GITHUB_*/RUNNER_* env vars to OTel semantic convention resource attributes |
| `ReportBuilder` | Fluent builder for markdown reports -- render to summary, PR comment, or check run |
| `TelemetryReport` | Render span timings and metrics as GFM tables |

## OpenTelemetry

`Action.run` auto-reads four optional inputs for OTel configuration:

| Input | Default | Description |
| --- | --- | --- |
| `otel-enabled` | `"auto"` | `"enabled"`, `"disabled"`, or `"auto"` (enabled when endpoint is set) |
| `otel-endpoint` | `""` | OTLP endpoint URL (falls back to `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| `otel-protocol` | `"grpc"` | `"grpc"`, `"http/protobuf"`, or `"http/json"` |
| `otel-headers` | `""` | Comma-separated `key=value` pairs for OTLP headers |

When no endpoint is configured, tracing falls back to an in-memory tracer and a timing summary is appended to the step summary automatically.

## Testing

Every service has a companion test layer. No mocking required.

```typescript
import { Effect, Layer, Schema } from "effect";
import {
  Action,
  ActionInputsTest,
  ActionOutputsTest,
  ActionLoggerTest,
} from "@savvy-web/github-action-effects";

const outputState = ActionOutputsTest.empty();
const TestLayer = Layer.mergeAll(
  ActionInputsTest({ "package-name": "my-pkg" }),
  ActionOutputsTest.layer(outputState),
  ActionLoggerTest.layer(ActionLoggerTest.empty()),
);

await Effect.gen(function* () {
  const { packageName } = yield* Action.parseInputs({
    packageName: { schema: Schema.String, required: true },
  });
  const outputs = yield* ActionOutputs;
  yield* outputs.set("result", packageName);
}).pipe(Effect.provide(TestLayer), Effect.runPromise);

expect(outputState.outputs).toContainEqual({ name: "result", value: "my-pkg" });
```

## Documentation

- [Example Action](./docs/example-action.md) -- end-to-end tutorial
- [Services Guide](./docs/services.md) -- detailed guide for each service
- [Architecture](./docs/architecture.md) -- API reference and layer composition
- [Testing](./docs/testing.md) -- testing with in-memory layers
- [OpenTelemetry](./docs/otel.md) -- OTel configuration and tracing guide
- [Patterns](./docs/patterns.md) -- dry-run mode, error accumulation, permission checking, and more

## License

[MIT](LICENSE)
