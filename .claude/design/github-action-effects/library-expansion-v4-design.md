# Library Expansion v4: Targeted Gap-Fillers — Design

> **Status: COMPLETED.** All 6 services from this design have been
> implemented and are documented in [services.md](./services.md),
> [layers.md](./layers.md), and [errors-and-schemas.md](./errors-and-schemas.md).
> This document is retained as historical context for the design decisions.

**Date:** 2026-03-08

**Goal:** Add 6 focused abstractions that fill concrete gaps identified by
analyzing 5 production GitHub Actions (workflow-release-action,
workflow-runtime-action, workflow-control-action, pnpm-config-dependency-action,
silk-sync-action).

**Principle:** Composable services, not a framework. Each abstraction has
multiple observed consumers. No business logic — only reusable primitives.

## Cross-Action Analysis

Five production GitHub Actions were analyzed to identify common patterns not yet
covered by the library (v0.4.0):

| Action | LOC | Uses Effect? | Key Patterns |
| --- | --- | --- | --- |
| workflow-release-action | ~17k | No | 3-phase lifecycle, multi-registry publish, check runs, PR comments, branch mgmt |
| workflow-runtime-action | ~2k | No | Tool installation, cache mgmt, PM detection, devEngines parsing |
| workflow-control-action | ~1.5k | No | Phase detection, changeset parsing, lightweight pre-flight checks |
| pnpm-config-dependency-action | ~3k | Yes (v0.3.0) | Git Data API commits, branch mgmt, npm queries, changeset generation |
| silk-sync-action | ~2k | Yes (v0.3.0) | Pagination, rate limiting, dry-run mode, org discovery, label/settings sync |

### Patterns Already Covered (v0.4.0)

GitHubApp, GitBranch, GitCommit, ChangesetAnalyzer, CheckRun,
PullRequestComment, RateLimiter, ConfigLoader, ToolInstaller,
PackageManagerAdapter, ActionLogger, ActionTelemetry, ReportBuilder,
TelemetryReport, CommandRunner, ActionInputs, ActionOutputs, ActionState,
ActionEnvironment, ActionCache.

### Identified Gaps

1. REST API pagination — manual while-loops in silk-sync and release-action
1. GraphQL support — silk-sync needs Projects V2 mutations, auto-merge
1. Dry-run mode — scattered if-checks in silk-sync and release-action
1. NPM registry queries — duplicated across pnpm-config, release-action, runtime-action
1. Error accumulation — hand-rolled in all three complex actions
1. Workspace detection — reimplemented with workspace-tools in three actions

## Architecture Decisions

### AD-1: Pagination as GitHubClient method, not separate service

Pagination is inherently tied to the GitHubClient's Octokit instance and auth
context. Adding it as a method on the existing service avoids a new dependency
graph.

### AD-2: GraphQL as separate service depending on GitHubClient

GraphQL has fundamentally different semantics (single endpoint, query strings,
nested error arrays). A separate service keeps the interface clean and allows
independent testing. It depends on GitHubClient for token/auth access.

### AD-3: DryRun as a service with guard pattern

Rather than wrapping entire services, DryRun provides a `guard()` method that
actions use explicitly at mutation call sites. This avoids the complexity of
service interception while making dry-run opt-in per operation.

### AD-4: ErrorAccumulator as utility namespace, not service

Error accumulation is a pure computation pattern — it doesn't need dependency
injection or state. A namespace object (like GithubMarkdown) with helper
functions keeps the API lightweight.

### AD-5: NpmRegistry uses CommandRunner, not HTTP

Using `npm view --json` via CommandRunner leverages the user's npm auth config
(.npmrc) automatically. Direct HTTP would require reimplementing auth for
private registries.

### AD-6: WorkspaceDetector uses FileSystem, not workspace-tools

Avoid the `workspace-tools` dependency. Workspace detection is
straightforward — read pnpm-workspace.yaml or package.json workspaces field,
glob for packages. Using @effect/platform FileSystem keeps it testable with
mock layers.

## Service Designs

### 1. GitHubClient.paginate (method addition)

Add to existing GitHubClient interface:

```typescript
readonly paginate: <T>(
  label: string,
  fn: (octokit: unknown, page: number) => Promise<{ data: T[] }>,
  options?: { perPage?: number; maxPages?: number },
) => Effect.Effect<Array<T>, GitHubClientError>;
```

Handles page incrementing, empty-page termination, result concatenation.
Default perPage: 100, maxPages: unlimited. Instrumented with Effect.withSpan.

Consumers: silk-sync (labels, issues, repos, org properties), release-action
(PRs, commits).

### 2. GitHubGraphQL service

New service for GitHub's GraphQL API:

```typescript
export interface GitHubGraphQL {
  readonly query: <T>(
    operation: string,
    query: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<T, GitHubGraphQLError>;

  readonly mutation: <T>(
    operation: string,
    query: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<T, GitHubGraphQLError>;
}
```

Error: `GitHubGraphQLError` with fields
`{ operation, reason, errors: Array<{ message: string; type?: string }> }`.

Live layer depends on GitHubClient for auth token. Test layer records
queries/mutations in state.

Consumers: silk-sync (project mutations, repo linking), release-action
(auto-merge), any action needing Projects V2.

### 3. DryRun service

Cross-cutting concern for mutation interception:

```typescript
export interface DryRun {
  readonly isDryRun: Effect.Effect<boolean>;
  readonly guard: <A, E, R>(
    label: string,
    effect: Effect.Effect<A, E, R>,
    fallback: A,
  ) => Effect.Effect<A, E, R>;
}
```

`guard()` checks isDryRun. If active: logs `[DRY-RUN] {label}` via
ActionLogger, returns fallback. If not: executes the effect normally.

Two layers:

* `DryRunLive(enabled: boolean)` — reads from constructor param
* `DryRunTest` — always dry, records guarded labels in state

Consumers: silk-sync, release-action, any action with --dry-run support.

### 4. NpmRegistry service

Query npm registry for package metadata:

```typescript
export interface NpmRegistry {
  readonly getLatestVersion: (
    pkg: string,
  ) => Effect.Effect<string, NpmRegistryError>;
  readonly getDistTags: (
    pkg: string,
  ) => Effect.Effect<Record<string, string>, NpmRegistryError>;
  readonly getPackageInfo: (
    pkg: string,
    version?: string,
  ) => Effect.Effect<NpmPackageInfo, NpmRegistryError>;
  readonly getVersions: (
    pkg: string,
  ) => Effect.Effect<Array<string>, NpmRegistryError>;
}
```

Schema: `NpmPackageInfo` —
`{ name, version, distTags, integrity?, tarball? }`.

Error: `NpmRegistryError` —
`{ pkg, operation: "view" | "search" | "versions", reason }`.

Live layer depends on CommandRunner. Runs `npm view <pkg> --json`, parses
output.

Consumers: pnpm-config (dep updates), release-action (version checks),
runtime-action (version lookups).

### 5. ErrorAccumulator utility namespace

Pure computation helpers for "process all, collect failures":

```typescript
export const ErrorAccumulator = {
  forEachAccumulate: <A, B, E, R>(
    items: Iterable<A>,
    fn: (item: A) => Effect.Effect<B, E, R>,
  ) => Effect.Effect<
    { successes: Array<B>; failures: Array<{ item: A; error: E }> },
    never,
    R
  >,

  forEachAccumulateConcurrent: <A, B, E, R>(
    items: Iterable<A>,
    fn: (item: A) => Effect.Effect<B, E, R>,
    concurrency: number,
  ) => Effect.Effect<
    { successes: Array<B>; failures: Array<{ item: A; error: E }> },
    never,
    R
  >,
} as const;
```

Return type has `never` error channel — all errors captured in failures
array. Internally uses Effect.forEach with Effect.either.

Consumers: silk-sync (per-repo sync), release-action (multi-package publish),
pnpm-config (per-dep updates).

### 6. WorkspaceDetector service

Detect monorepo structure and list packages:

```typescript
export interface WorkspaceDetector {
  readonly detect: () => Effect.Effect<
    WorkspaceInfo,
    WorkspaceDetectorError
  >;
  readonly listPackages: () => Effect.Effect<
    Array<WorkspacePackage>,
    WorkspaceDetectorError
  >;
  readonly getPackage: (
    nameOrPath: string,
  ) => Effect.Effect<WorkspacePackage, WorkspaceDetectorError>;
}
```

Schemas:

* `WorkspaceInfo` —
  `{ root, type: "single" | "pnpm" | "yarn" | "npm" | "bun", patterns: Array<string> }`
* `WorkspacePackage` —
  `{ name, version, path, private, dependencies }`

Error: `WorkspaceDetectorError` —
`{ operation: "detect" | "list" | "get", reason }`.

Live layer depends on FileSystem + CommandRunner. Reads pnpm-workspace.yaml
or package.json workspaces, globs for packages, reads each package.json.

Consumers: release-action (package detection), pnpm-config (workspace
scanning), runtime-action (workspace detection).

## Dependency Graph

```text
GitHubGraphQL ──depends──> GitHubClient
DryRun ──depends──> ActionLogger
NpmRegistry ──depends──> CommandRunner
WorkspaceDetector ──depends──> FileSystem + CommandRunner
GitHubClient.paginate ── (method on existing service, no new deps)
ErrorAccumulator ── (pure utility, no deps)
```

## Testing Strategy

Each service follows the established pattern:

* Service interface in services/
* Live layer in layers/ with Effect.withSpan instrumentation
* Test layer in layers/ with namespace object (.empty()/.layer())
* Service tests via test layer
* Live layer tests with mocked dependencies

## Release

Ship as v0.5.0 (minor, breaking changes limited to GitHubClient interface
addition). Single changeset covering all 6 additions.
