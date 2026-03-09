---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-09
last-synced: 2026-03-09
completeness: 85
related:
  - ./index.md
  - ./services.md
  - ./layers.md
dependencies: []
---

# Integration Points

## Overview

Peer dependencies, external integrations, and how services compose in
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [layers.md](./layers.md) for layer dependency graph.

---

## Peer Dependencies

### Required Peers

**effect** -- Core dependency. Services use `Context.GenericTag`, `Layer`,
`Schema`, `Data.TaggedError`, `FiberRef`, `Logger`, and `Tracer`.

**@effect/platform and @effect/platform-node** -- `Action.run()` provides
`NodeContext.layer` from `@effect/platform-node`, giving programs access to
`FileSystem`, `Path`, `Terminal`, `CommandExecutor`, and `WorkerManager`.
Several services (ConfigLoader, ChangesetAnalyzer, WorkspaceDetector,
PackagePublish) depend on `FileSystem` from `@effect/platform`.

**@actions/core** -- Primary integration for input reading, output setting,
logging, annotations, state, and secrets. All interactions wrapped in Effect
services.

### Optional Peers

| Package | Used By | Purpose |
| --- | --- | --- |
| `@actions/github` | GitHubClient | Authenticated Octokit provider |
| `@actions/exec` | CommandRunner | Shell command execution |
| `@actions/cache` | ActionCache | Cache save/restore |
| `@actions/tool-cache` | ToolInstaller | Tool download, extract, cache |
| `@octokit/auth-app` | GitHubApp | GitHub App JWT authentication |
| `semver` | SemverResolver | Semver comparison and resolution |
| `jsonc-parser` | ConfigLoader.loadJsonc | JSONC config file support |
| `yaml` | ConfigLoader.loadYaml | YAML config file support |

All optional peers are marked `optional: true` in `peerDependenciesMeta`.

### Regular Dependencies (Bundled)

| Package | Used By | Purpose |
| --- | --- | --- |
| `@effect/opentelemetry` | OtelExporterLive, OtelTelemetryLive | Effect tracer to OTel bridge |
| `@opentelemetry/api` | OtelTelemetryLive | OTel API types |
| `@opentelemetry/exporter-trace-otlp-grpc` | OtelExporterLive | gRPC trace export |
| `@opentelemetry/exporter-trace-otlp-proto` | OtelExporterLive | HTTP/protobuf trace export |
| `@opentelemetry/exporter-trace-otlp-http` | OtelExporterLive | HTTP/JSON trace export |
| `@opentelemetry/exporter-metrics-otlp-grpc` | OtelExporterLive | gRPC metric export |
| `@opentelemetry/exporter-metrics-otlp-proto` | OtelExporterLive | HTTP/protobuf metric export |
| `@opentelemetry/exporter-metrics-otlp-http` | OtelExporterLive | HTTP/JSON metric export |
| `@opentelemetry/resources` | OtelExporterLive | OTel resource definitions |
| `@opentelemetry/sdk-metrics` | OtelExporterLive | OTel metrics SDK |
| `@opentelemetry/sdk-trace-node` | OtelExporterLive | OTel tracing SDK |

OTel packages are regular `dependencies` (not optional peers) because
`@vercel/ncc` cannot resolve dynamic `import()` calls. Static imports with
bundled dependencies ensure reliable ncc compilation.

---

## Service Dependency Graph

```text
Tier 0 — No service dependencies (standalone):
  ActionInputs, ActionLogger, ActionOutputs, ActionState,
  ActionEnvironment, ActionCache, CommandRunner, DryRun,
  ActionTelemetry, GitHubApp

Tier 1 — Single service dependency:
  NpmRegistry               -> CommandRunner
  ChangesetAnalyzer         -> FileSystem
  ConfigLoader              -> FileSystem
  GitHubClient(token)       -> @actions/github (peer dep, not a service)
  ToolInstaller             -> @actions/tool-cache (peer dep, not a service)

Tier 2 — GitHubClient dependents:
  GitHubGraphQL             -> GitHubClient
  GitBranch                 -> GitHubClient
  GitCommit                 -> GitHubClient
  GitTag                    -> GitHubClient
  GitHubRelease             -> GitHubClient
  GitHubIssue               -> GitHubClient + GitHubGraphQL
  CheckRun                  -> GitHubClient
  PullRequestComment        -> GitHubClient
  RateLimiter               -> GitHubClient
  WorkflowDispatch          -> GitHubClient
  PackageManagerAdapter     -> CommandRunner + FileSystem
  WorkspaceDetector         -> FileSystem + CommandRunner

Tier 3 — Multi-service dependencies:
  PackagePublish            -> CommandRunner + NpmRegistry + FileSystem
  TokenPermissionChecker    -> GitHubApp
  AutoMerge (utility)       -> GitHubGraphQL

Utilities (no service dependencies):
  GithubMarkdown, SemverResolver, ErrorAccumulator,
  GitHubOtelAttributes, ReportBuilder, TelemetryReport
```

### Layer Provision for Tier 2+

```text
GitHubClientLive(token)
  -> CheckRunLive              (requires GitHubClient in context)
  -> PullRequestCommentLive    (requires GitHubClient in context)
  -> GitHubGraphQLLive         (requires GitHubClient in context)
  -> GitBranchLive             (requires GitHubClient in context)
  -> GitCommitLive             (requires GitHubClient in context)
  -> GitTagLive                (requires GitHubClient in context)
  -> GitHubReleaseLive         (requires GitHubClient in context)
  -> GitHubIssueLive           (requires GitHubClient + GitHubGraphQL)
  -> RateLimiterLive           (requires GitHubClient in context)
  -> WorkflowDispatchLive      (requires GitHubClient in context)

Test layers for all Tier 2 services do NOT depend on GitHubClient --
they operate entirely in-memory.
```

---

## Optional Integrations

### @savvy-web/github-action-builder

Actions built with the builder benefit from this library but it is not
required. Any Node.js 24 action can use these services.

### OpenTelemetry

When OTel is enabled (via `otel-enabled` input or `OTEL_EXPORTER_OTLP_ENDPOINT`
env var), `Action.run()` automatically wires up the `@effect/opentelemetry`
tracer bridge via static imports. `GitHubOtelAttributes.fromEnvironment()` maps
GitHub environment variables to OTel semantic conventions for resource
attributes. OTel packages are regular dependencies (not optional peers) to
ensure reliable ncc bundling. See
[otel-exporter-inputs.md](./otel-exporter-inputs.md) for details.

## Current State

All peer dependencies and service tiers are documented with a complete dependency graph. Optional integrations for OpenTelemetry and the action builder are specified with their activation conditions.

## Rationale

Separating required from optional peer dependencies and organizing services into dependency tiers ensures consumers only install what they need, while the tiered graph makes layer composition predictable and testable at each level.

## Related Documentation

- [Architecture Index](./index.md) -- overall architecture and design overview
- [Services](./services.md) -- service interface definitions
- [Layers](./layers.md) -- layer dependency graph and composition
- [OTel Exporter Inputs](./otel-exporter-inputs.md) -- OpenTelemetry exporter configuration
