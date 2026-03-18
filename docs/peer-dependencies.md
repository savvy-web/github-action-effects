# Peer Dependencies

`@savvy-web/github-action-effects` uses peer dependencies so that
`@vercel/ncc` (via `@savvy-web/github-action-builder`) can resolve a single
copy of each package from your action's `package.json`. This avoids version
duplication and ensures compatibility between your action code and the library.

## Required Peers

These must be installed for the library to function. `Action.run` depends on
all of them.

| Package | Range | Purpose |
| --- | --- | --- |
| `effect` | `^3.19.0` | Core dependency -- services, layers, schemas, errors, tracing |
| `@actions/core` | `^3.0.0` | Input reading, output setting, logging, annotations, state, secrets |
| `@effect/platform` | `>=0.94.0` | `FileSystem`, `Path`, and platform abstractions used by multiple services |
| `@effect/platform-node` | `>=0.104.0` | `NodeContext.layer` provided by `Action.run` -- gives `FileSystem`, `Path`, `Terminal`, `CommandExecutor`, `WorkerManager` |

Install all required peers at once:

```bash
npm install effect @actions/core @effect/platform @effect/platform-node
```

## Optional Peers

Install only the packages needed by the services you use. Each optional peer
is marked `optional: true` in `peerDependenciesMeta`, so package managers
will not warn about missing ones.

### @actions/github (`^9.0.0`)

Provides an authenticated Octokit instance for GitHub API calls.

**Services that require it:**

- GitHubClient -- Octokit REST and GraphQL with pagination
- GitHubGraphQL -- typed GraphQL queries and mutations
- GitHubRelease -- release CRUD and asset upload
- GitHubIssue -- issue management and PR linking
- CheckRun -- check run CRUD with annotations
- PullRequest -- PR lifecycle (get, list, create, update, merge, getOrCreate)
- PullRequestComment -- sticky (upsert) PR comments
- GitTag -- tag CRUD via Git Data API
- GitBranch -- branch CRUD via Git Data API
- GitCommit -- tree/commit creation, ref updates, file deletions
- RateLimiter -- rate limit guard with exponential backoff
- WorkflowDispatch -- trigger and poll workflows
- TokenPermissionChecker -- check/assert token permissions

**Install:**

```bash
npm install @actions/github
```

### @actions/exec (`^3.0.0`)

Wraps child process execution with stdout/stderr capture.

**Services that require it:**

- CommandRunner -- structured shell execution with capture, JSON parsing, line splitting

**Install:**

```bash
npm install @actions/exec
```

### @actions/cache (`^6.0.0`)

GitHub Actions cache save and restore.

**Services that require it:**

- ActionCache -- save/restore with `withCache` bracket pattern

**Install:**

```bash
npm install @actions/cache
```

### @actions/tool-cache (`^4.0.0`)

Download, extract, and cache tool binaries.

**Services that require it:**

- ToolInstaller -- download, extract, cache, and add tool binaries to PATH

**Install:**

```bash
npm install @actions/tool-cache
```

### @octokit/auth-app (`>=8.0.0`)

GitHub App JWT authentication for installation tokens.

**Services that require it:**

- GitHubApp -- App token generation and revocation with bracket pattern

**Install:**

```bash
npm install @octokit/auth-app
```

## Regular Dependencies (Not Peers)

OpenTelemetry packages are included as regular `dependencies` of this library.
You do not need to install them separately.

| Package | Purpose |
| --- | --- |
| `@effect/opentelemetry` | Effect tracer to OTel bridge |
| `@opentelemetry/api` | OTel API types |
| `@opentelemetry/sdk-trace-node` | OTel tracing SDK |
| `@opentelemetry/sdk-metrics` | OTel metrics SDK |
| `@opentelemetry/resources` | OTel resource definitions |
| `@opentelemetry/exporter-trace-otlp-grpc` | gRPC trace export |
| `@opentelemetry/exporter-trace-otlp-http` | HTTP/JSON trace export |
| `@opentelemetry/exporter-trace-otlp-proto` | HTTP/protobuf trace export |
| `@opentelemetry/exporter-metrics-otlp-grpc` | gRPC metric export |
| `@opentelemetry/exporter-metrics-otlp-http` | HTTP/JSON metric export |
| `@opentelemetry/exporter-metrics-otlp-proto` | HTTP/protobuf metric export |

These are regular dependencies (not optional peers) because `@vercel/ncc`
cannot resolve dynamic `import()` calls. Static imports with bundled
dependencies ensure reliable ncc compilation.

Additional regular dependencies for config file parsing:

| Package | Purpose |
| --- | --- |
| `jsonc-effect` | JSONC config file support (ConfigLoader) |
| `yaml-effect` | YAML config file support (ConfigLoader) |
| `semver-effect` | Semver comparison and resolution (SemverResolver) |

## Service Dependency Tiers

Services are organized into tiers based on what they depend on. This helps
you understand which peer dependencies to install for a given set of services.

```text
Tier 0 -- No optional peer deps (only effect + @actions/core):
  ActionInputs, ActionLogger, ActionOutputs, ActionState,
  ActionEnvironment, DryRun, ActionTelemetry, NpmRegistry

Tier 1 -- Single optional peer:
  CommandRunner             -> @actions/exec
  ActionCache               -> @actions/cache
  ToolInstaller             -> @actions/tool-cache
  GitHubApp                 -> @octokit/auth-app

Tier 2 -- @actions/github (all GitHub API services):
  GitHubClient, GitHubGraphQL, GitHubRelease, GitHubIssue,
  CheckRun, PullRequest, PullRequestComment, GitTag,
  GitBranch, GitCommit, RateLimiter, WorkflowDispatch,
  TokenPermissionChecker

Services from @effect/platform (provided by Action.run via NodeContext.layer):
  ConfigLoader, ChangesetAnalyzer, WorkspaceDetector,
  PackagePublish, PackageManagerAdapter
```

## Typical Installation

A minimal action that reads inputs and writes outputs:

```bash
npm install @savvy-web/github-action-effects effect @actions/core @effect/platform @effect/platform-node
```

An action that also creates GitHub releases and runs shell commands:

```bash
npm install @savvy-web/github-action-effects effect @actions/core @effect/platform @effect/platform-node @actions/github @actions/exec
```

A full-featured action with GitHub App auth, caching, and tool installation:

```bash
npm install @savvy-web/github-action-effects effect @actions/core @effect/platform @effect/platform-node @actions/github @actions/exec @actions/cache @actions/tool-cache @octokit/auth-app
```
