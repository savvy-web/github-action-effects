# Library Expansion v5: Release, Publishing & Observability — Design

> **Status: COMPLETED.** All 8 abstractions from this design have been
> implemented and are documented in [services.md](./services.md),
> [layers.md](./layers.md), and [errors-and-schemas.md](./errors-and-schemas.md).
> This document is retained as historical context for the design decisions.

**Date:** 2026-03-08

**Goal:** Add 8 abstractions covering release management, package publishing,
token validation, and observability standardization. Builds on v0.5.0 services.

**Principle:** Composable services, not a framework. Each abstraction has
multiple observed consumers across 5 production GitHub Actions.

## Cross-Action Analysis (continued from v4)

Building on the v4 analysis, these gaps remain:

| Pattern | Actions Using It | Current State |
| --- | --- | --- |
| GitHub Releases (create, upload assets) | workflow-release-action | Manual Octokit calls |
| Issue management + linked issues | workflow-release-action, silk-sync-action | Scattered REST + GraphQL |
| Git tagging via refs API | workflow-release-action, pnpm-config-dependency-action | Inline Octokit calls |
| Semver comparison/resolution | workflow-release-action, pnpm-config-dependency-action | Direct semver calls |
| PR auto-merge toggle | workflow-release-action | Manual GraphQL mutations |
| Package publishing (npm + GPR) | workflow-release-action | Complex multi-step scripts |
| Token permission validation | All actions using GitHub Apps | No validation, silent failures |
| OTel context attributes | All actions with telemetry | Only serviceName/serviceVersion |

## Architecture Decisions

### AD-1: GitHubRelease, GitHubIssue, GitTag as full services

These have enough surface area (4+ methods each) and distinct error domains to
warrant full service/error/layer treatment.

### AD-2: SemverResolver and AutoMerge as utility namespaces

SemverResolver wraps the `semver` npm package in typed functions — no Effect
service needed. AutoMerge is only two GraphQL mutations — a namespace with
Effect functions depending on GitHubGraphQL keeps it lightweight.

### AD-3: PackagePublish as full service

Publishing involves filesystem operations (`.npmrc` writing, tarball creation),
shell commands (`npm pack`, `npm publish`), and cross-service verification
(NpmRegistry). This complexity warrants a service with proper error handling
and test layer.

### AD-4: TokenPermissionChecker as service with three enforcement modes

Supports three DX patterns:

- `assertSufficient(requirements)` — Fail if missing permissions. Standard
  enforcement.
- `assertExact(requirements)` — Fail if missing OR extra permissions. Strict
  least-privilege.
- `warnOverPermissioned(requirements)` — Never fail, warn on extras. Soft
  enforcement.

All methods return `PermissionCheckResult` with full granted/required/missing/
extra breakdown and log a summary table.

Permission levels are hierarchical: `admin > write > read`. A token with
`write` satisfies a `read` requirement.

Depends on GitHubApp — reads granted permissions from the token generation
response. Requires extending `InstallationToken` schema with a `permissions`
field.

### AD-5: OTel resource attributes via config extension + utility

Extend `OtelConfig` with optional `resourceAttributes`. Provide a utility
`GitHubOtelAttributes.fromEnvironment()` that maps `GITHUB_*` env vars to
official OTel semantic conventions (`cicd.*`, `vcs.*`). Resource attributes
are set once and inherited by all spans.

### AD-6: semver as optional peer dependency

The `semver` package is available in virtually all Node.js Actions
environments. Making it an optional peer dependency avoids bundling while
providing types.

## Service Designs

### 1. GitHubRelease service

```typescript
export interface GitHubRelease {
  readonly create: (options: {
    tag: string;
    name: string;
    body: string;
    draft?: boolean;
    prerelease?: boolean;
    generateReleaseNotes?: boolean;
  }) => Effect.Effect<{ id: number; uploadUrl: string }, GitHubReleaseError>;

  readonly uploadAsset: (
    releaseId: number,
    name: string,
    data: Uint8Array | string,
    contentType: string,
  ) => Effect.Effect<{ id: number; url: string }, GitHubReleaseError>;

  readonly getByTag: (
    tag: string,
  ) => Effect.Effect<{ id: number; name: string; body: string; draft: boolean; prerelease: boolean }, GitHubReleaseError>;

  readonly list: (options?: {
    perPage?: number;
    maxPages?: number;
  }) => Effect.Effect<Array<{ id: number; tag: string; name: string; draft: boolean; prerelease: boolean }>, GitHubReleaseError>;
}
```

Error: `GitHubReleaseError { operation, tag?, reason, retryable }`

Depends on: `GitHubClient` (REST + paginate)

### 2. GitHubIssue service

```typescript
export interface GitHubIssue {
  readonly list: (options?: {
    state?: "open" | "closed" | "all";
    labels?: Array<string>;
    milestone?: number;
    perPage?: number;
    maxPages?: number;
  }) => Effect.Effect<Array<{ number: number; title: string; state: string; labels: Array<string> }>, GitHubIssueError>;

  readonly close: (
    issueNumber: number,
    reason?: "completed" | "not_planned",
  ) => Effect.Effect<void, GitHubIssueError>;

  readonly comment: (
    issueNumber: number,
    body: string,
  ) => Effect.Effect<{ id: number }, GitHubIssueError>;

  readonly getLinkedIssues: (
    prNumber: number,
  ) => Effect.Effect<Array<{ number: number; title: string }>, GitHubIssueError>;
}
```

Error: `GitHubIssueError { operation, issueNumber?, reason, retryable }`

Depends on: `GitHubClient` (REST + paginate), `GitHubGraphQL` (linked issues)

### 3. GitTag service

```typescript
export interface GitTag {
  readonly create: (
    tag: string,
    sha: string,
  ) => Effect.Effect<void, GitTagError>;

  readonly delete: (
    tag: string,
  ) => Effect.Effect<void, GitTagError>;

  readonly list: (
    prefix?: string,
  ) => Effect.Effect<Array<{ tag: string; sha: string }>, GitTagError>;

  readonly resolve: (
    tag: string,
  ) => Effect.Effect<string, GitTagError>;
}
```

Error: `GitTagError { operation, tag?, reason }`

Depends on: `GitHubClient` (REST + paginate)

### 4. SemverResolver utility namespace

```typescript
export const SemverResolver = {
  compare: (a: string, b: string) => Effect.Effect<-1 | 0 | 1, SemverResolverError>,
  satisfies: (version: string, range: string) => Effect.Effect<boolean, SemverResolverError>,
  latestInRange: (versions: Array<string>, range: string) => Effect.Effect<string, SemverResolverError>,
  increment: (version: string, bump: "major" | "minor" | "patch" | "prerelease") => Effect.Effect<string, SemverResolverError>,
  parse: (version: string) => Effect.Effect<{
    major: number; minor: number; patch: number;
    prerelease?: string; build?: string;
  }, SemverResolverError>,
} as const;
```

Error: `SemverResolverError { operation, version, reason }`

No service dependency. Wraps the `semver` npm package. Each function returns
an Effect to handle invalid input gracefully.

### 5. AutoMerge utility namespace

```typescript
export const AutoMerge = {
  enable: (
    prNodeId: string,
    mergeMethod?: "MERGE" | "SQUASH" | "REBASE",
  ) => Effect.Effect<void, GitHubGraphQLError, GitHubGraphQL>,

  disable: (
    prNodeId: string,
  ) => Effect.Effect<void, GitHubGraphQLError, GitHubGraphQL>,
} as const;
```

No dedicated error — uses `GitHubGraphQLError` from the underlying service.

Depends on: `GitHubGraphQL`

### 6. PackagePublish service

```typescript
export interface PackagePublish {
  readonly setupAuth: (
    registry: string,
    token: string,
  ) => Effect.Effect<void, PackagePublishError>;

  readonly pack: (
    packageDir: string,
  ) => Effect.Effect<{ tarball: string; digest: string }, PackagePublishError>;

  readonly publish: (
    packageDir: string,
    options?: {
      registry?: string;
      tag?: string;
      access?: "public" | "restricted";
      provenance?: boolean;
    },
  ) => Effect.Effect<void, PackagePublishError>;

  readonly verifyIntegrity: (
    packageName: string,
    version: string,
    expectedDigest: string,
  ) => Effect.Effect<boolean, PackagePublishError>;

  readonly publishToRegistries: (
    packageDir: string,
    registries: Array<{
      registry: string;
      token: string;
      tag?: string;
      access?: "public" | "restricted";
    }>,
  ) => Effect.Effect<void, PackagePublishError>;
}
```

Error: `PackagePublishError { operation, pkg?, registry?, reason }`

Depends on: `CommandRunner`, `NpmRegistry`, `FileSystem` (@effect/platform)

### 7. TokenPermissionChecker service

```typescript
export interface TokenPermissionChecker {
  readonly check: (
    requirements: Record<string, PermissionLevel>,
  ) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

  readonly assertSufficient: (
    requirements: Record<string, PermissionLevel>,
  ) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

  readonly assertExact: (
    requirements: Record<string, PermissionLevel>,
  ) => Effect.Effect<PermissionCheckResult, TokenPermissionError>;

  readonly warnOverPermissioned: (
    requirements: Record<string, PermissionLevel>,
  ) => Effect.Effect<PermissionCheckResult, never>;
}
```

Schemas:

```typescript
const PermissionLevel = Schema.Literal("read", "write", "admin");

const PermissionCheckResult = Schema.Struct({
  granted: Schema.Record({ key: Schema.String, value: PermissionLevel }),
  required: Schema.Record({ key: Schema.String, value: PermissionLevel }),
  missing: Schema.Array(Schema.Struct({
    permission: Schema.String,
    required: PermissionLevel,
    granted: Schema.UndefinedOr(PermissionLevel),
  })),
  extra: Schema.Array(Schema.Struct({
    permission: Schema.String,
    level: PermissionLevel,
  })),
  satisfied: Schema.Boolean,
});
```

Error: `TokenPermissionError { missing: Array<{ permission, required, granted? }> }`

Depends on: `GitHubApp` — extends `InstallationToken` schema with
`permissions` field. Live layer reads permissions from the stored token
generation response.

### 8. OTel GitHub Resource Attributes

Extend `OtelConfig`:

```typescript
export interface OtelConfig {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly resourceAttributes?: Record<string, string>;
}
```

New utility namespace:

```typescript
export const GitHubOtelAttributes = {
  fromEnvironment: () => Record<string, string>,
} as const;
```

Environment variable mapping:

| Environment Variable | OTel Attribute |
| --- | --- |
| `GITHUB_WORKFLOW` | `cicd.pipeline.name` |
| `GITHUB_RUN_ID` | `cicd.pipeline.run.id` |
| `GITHUB_RUN_NUMBER` | `cicd.pipeline.run.counter` |
| `GITHUB_SERVER_URL/GITHUB_REPOSITORY` | `vcs.repository.url.full` |
| `GITHUB_REF` | `vcs.ref.head.name` |
| `GITHUB_SHA` | `vcs.ref.head.revision` |
| `GITHUB_ACTOR` | `enduser.id` |
| `RUNNER_NAME` | `cicd.worker.name` |
| `RUNNER_OS` | `cicd.worker.os` |

Usage: `OtelTelemetryLive({ resourceAttributes: GitHubOtelAttributes.fromEnvironment() })`

## Dependency Graph

```text
GitHubRelease ──depends──> GitHubClient
GitHubIssue ──depends──> GitHubClient + GitHubGraphQL
GitTag ──depends──> GitHubClient
AutoMerge ──depends──> GitHubGraphQL
PackagePublish ──depends──> CommandRunner + NpmRegistry + FileSystem
TokenPermissionChecker ──depends──> GitHubApp
SemverResolver ── (pure utility, wraps semver npm package)
GitHubOtelAttributes ── (pure utility, reads process.env)
OtelTelemetryLive ── (config extension, no new deps)
```

## Testing Strategy

Each service follows the established pattern:

- Service interface in `services/`
- Live layer in `layers/` with `Effect.withSpan` instrumentation
- Test layer in `layers/` with namespace object (`.empty()` / `.layer()`)
- Service tests via test layer
- Live layer tests with mocked dependencies

Utility namespaces (SemverResolver, AutoMerge, GitHubOtelAttributes) tested
directly without mock layers.

## Release

Ship as v0.6.0 (minor). Single changeset covering all 8 additions.
