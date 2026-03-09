# @savvy-web/pnpm-module-template

## 0.6.0

### Features

* [`d632223`](https://github.com/savvy-web/github-action-effects/commit/d6322233af73df9fe0a041baa8493e73cad2f412) Add `Action.formatCause` for robust error extraction from Effect causes
  with `[Tag] message` format and fallback chain that never returns empty

### Bug Fixes

* [`d632223`](https://github.com/savvy-web/github-action-effects/commit/d6322233af73df9fe0a041baa8493e73cad2f412) Fix `Action.run` silent failures by upgrading `catchAllCause` with
  diagnostic output (error message, JS stack trace, Effect span trace via
  `core.debug`). Fixes #15.

### Other

* [`d632223`](https://github.com/savvy-web/github-action-effects/commit/d6322233af73df9fe0a041baa8493e73cad2f412) Move OTel packages from optional peer dependencies to regular dependencies
  with static imports, eliminating dynamic `import()` failures in ncc bundles
* Remove unused `OtelExporterError` after OTel layer rewrite

## 0.5.0

### Features

* [`fba5094`](https://github.com/savvy-web/github-action-effects/commit/fba50941e3858c34187a360652b4f2a539294df3) Support file deletions in `GitCommit.createTree` and `commitFiles` via `sha: null` on `TreeEntry` and `FileChange` union types. Fixes #11.

## 0.4.0

### Breaking Changes

* [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) **ActionTelemetry refactored**: Removed `span()` and `getTimings()` methods. Use `Effect.withSpan()` for tracing instead. `ActionTelemetry` is now metrics-only (`metric`, `attribute`, `getMetrics`).
* **SpanData schema removed**: `SpanData` removed from `schemas/Telemetry.ts`. Use `CompletedSpan` from `InMemoryTracer` instead.

### Features

* [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) Add Tier 1 services — CommandRunner, ActionEnvironment, ActionCache — for structured shell execution, environment variable access, and cache operations.

- [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) **GitHubClient.paginate**: Paginated REST API calls with automatic page concatenation, empty-page termination, and configurable maxPages limit.
- **GitHubGraphQL**: Dedicated GraphQL service with operation naming, mutation/query distinction, and structured GraphQL error extraction. Delegates to GitHubClient.graphql with error mapping.
- **DryRun**: Cross-cutting dry-run mode with guard pattern for mutation interception. When enabled, guard() logs the operation and returns a fallback instead of executing.
- **NpmRegistry**: Query npm registry for package metadata (versions, dist-tags, package info, integrity hashes) via CommandRunner using `npm view --json`.
- **ErrorAccumulator**: Utility namespace for "process all, collect failures" patterns with sequential and concurrent variants.
- **WorkspaceDetector**: Detect monorepo workspace structure (pnpm, npm, yarn, bun, single) and list workspace packages via @effect/platform FileSystem.

* [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) ### Telemetry Overhaul

- **InMemoryTracer**: Custom Effect `Tracer` that captures completed spans in memory for GitHub-native output (step summaries, PR comments).
- **Effect.withSpan instrumentation**: All public service methods across 11 live layers are now instrumented with `Effect.withSpan` for automatic tracing.
- **OtelTelemetryLive**: Optional layer bridging Effect's Tracer to OpenTelemetry exporters. Requires `@effect/opentelemetry` and `@opentelemetry/api` as optional peer deps.
- **TelemetryReport**: Utility namespace for rendering span data as GitHub-flavored Markdown tables.
- **ReportBuilder**: Immutable fluent builder for composing structured Markdown reports with sections, stats, details, and timing data.
- **Action.run() auto-summary**: Automatically writes a timing summary to GitHub step summary after program completion.

* [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) **GitHubRelease**: Service for GitHub Releases API — create releases, upload assets, get by tag, list with pagination.
* **GitHubIssue**: Service for Issues API — list with filters, close, comment, and get linked issues via GraphQL.
* **GitTag**: Service for Git tag refs — create, delete, list with prefix filter, resolve tag to SHA.
* **SemverResolver**: Utility namespace for semver operations — compare, satisfies, latestInRange, increment, parse.
* **AutoMerge**: Utility namespace for PR auto-merge — enable/disable via GraphQL mutations.
* **PackagePublish**: Service for npm publishing workflow — registry auth setup, pack with digest, publish, integrity verification, multi-registry support.
* **TokenPermissionChecker**: Service for GitHub App token permission validation with three enforcement modes (assertSufficient, assertExact, warnOverPermissioned) and structured result reporting.
* **GitHubOtelAttributes**: Utility to map GitHub Actions environment variables to OpenTelemetry semantic convention resource attributes (cicd.*, vcs.*).
* **OtelConfig.resourceAttributes**: Extended OTel configuration to accept custom resource attributes.

- [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) **OTel Exporter Inputs**: Standardized OpenTelemetry exporter configuration for GitHub Actions. Four inputs (otel-enabled, otel-endpoint, otel-protocol, otel-headers) are automatically parsed by `Action.run()` with env var fallback (`OTEL_EXPORTER_OTLP_*`). Supports auto/enabled/disabled modes, grpc/http-protobuf/http-json protocols, and OTLP-format header parsing.
- **OtelExporterLive**: Layer that dynamically imports the correct OTLP trace and metric exporter packages based on protocol, with helpful error messages when packages are missing.
- **OtelExporterConfig**: Schema and resolution logic for OTel configuration with input-over-env-var precedence.

* [`53d50e9`](https://github.com/savvy-web/github-action-effects/commit/53d50e9ae2e7e3161ca008d672ace88d6086a304) Add Tier 2 services — GitHubClient, CheckRun, PullRequestComment — for authenticated GitHub API operations, check run management with bracket pattern, and idempotent sticky PR comments.

### New Services

* **GitHubApp**: GitHub App authentication lifecycle — generate installation tokens, revoke tokens, and bracket-style `withToken` for automatic cleanup. Requires `@octokit/auth-app` as optional peer dep.
* **RateLimiter**: GitHub API rate limit awareness — check remaining quota, wait-and-retry with configurable thresholds, exponential backoff retry.
* **ChangesetAnalyzer**: Parse, query, and generate changeset files with YAML frontmatter validation.
* **GitBranch**: Branch management via GitHub's Git Data API — create, delete, get SHA, and reset branches.
* **GitCommit**: Verified commits via GitHub's Git Data API — create trees, commits, and update refs for programmatic file changes.
* **ConfigLoader**: Schema-validated config file loading for JSON, JSONC, and YAML formats. JSONC requires `jsonc-parser`, YAML requires `yaml` as optional peer deps.
* **ToolInstaller**: Tool binary management — download, extract, cache, and add to PATH. Requires `@actions/tool-cache` as optional peer dep.
* **PackageManagerAdapter**: Unified package manager interface — detect PM from package.json or lockfiles, install dependencies, query cache paths, and execute PM commands. Supports npm, pnpm, yarn, bun, and deno.

## 0.3.0

### Breaking Changes

* [`30efe1c`](https://github.com/savvy-web/github-action-effects/commit/30efe1c067bb963889215a43b3d565e88831f391) `@effect/platform` and `@effect/platform-node` are now required peer dependencies.

### Features

* [`30efe1c`](https://github.com/savvy-web/github-action-effects/commit/30efe1c067bb963889215a43b3d565e88831f391) Provide Node.js platform services automatically in `Action.run()`.

`Action.run()` now merges `NodeContext.layer` from `@effect/platform-node` into its core layers. Programs run via `Action.run()` automatically have access to `FileSystem`, `Path`, `Terminal`, `CommandExecutor`, and `WorkerManager` without manually providing them.

## 0.2.0

### Features

* [`5d14ae8`](https://github.com/savvy-web/github-action-effects/commit/5d14ae8f3dfc0a360a037a8c1bdf3f83270a443b) **ActionState service**: New Effect service for typed state transfer between action phases (pre/main/post) using Schema encode/decode for complex object serialization
* **ActionInputs additions**: `getMultiline` for newline-delimited lists, `getBoolean`/`getBooleanOptional` for boolean inputs
* **ActionOutputs additions**: `setFailed` for marking action failure, `setSecret` for masking generated values in logs
* **Action namespace**: Groups top-level helpers under `Action.*` — `Action.run()`, `Action.parseInputs()`, `Action.makeLogger()`, `Action.setLogLevel()`, `Action.resolveLogLevel()`
* **GithubMarkdown namespace**: Groups GFM builder functions under `GithubMarkdown.*` — `GithubMarkdown.table()`, `GithubMarkdown.bold()`, etc.

## 0.1.0

### Features

* [`8635765`](https://github.com/savvy-web/github-action-effects/commit/8635765a949b36db3b8461fce713418243a85f61) **ActionInputs** service: schema-validated input reading with `get`, `getOptional`, `getSecret`, and `getJson` methods
* **ActionLogger** service: structured logging with three levels (info/verbose/debug), auto mode, two-channel routing (user-facing + GitHub debug), collapsible groups, and buffer-on-failure pattern
* **ActionOutputs** service: typed output setting with `set`, `setJson`, `summary`, `exportVariable`, and `addPath` methods
* **GFM builders**: pure functions for markdown tables, headings, details, lists, checklists, status icons, links, code blocks, and more
* **Schema definitions**: `ActionLogLevel`, `LogLevelInput`, `Status`, `ChecklistItem`, `CapturedOutput` with Effect Schema annotations
* **Test layers**: in-memory implementations for all services with namespace object pattern (`*.empty()` / `*.layer()`)
* **Error types**: `ActionInputError` and `ActionOutputError` using Effect's `Data.TaggedError` pattern

## 0.0.1

### Patch Changes

* ae454d3: Update dependencies:

  **Dependencies:**

  * @savvy-web/commitlint: ^0.2.0 → ^0.2.1
  * @savvy-web/lint-staged: ^0.1.3 → ^0.2.1
  * @savvy-web/rslib-builder: ^0.11.0 → ^0.12.0
