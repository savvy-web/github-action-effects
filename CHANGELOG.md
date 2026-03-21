# @savvy-web/pnpm-module-template

## 0.11.3

### Bug Fixes

* [`50f4caa`](https://github.com/savvy-web/github-action-effects/commit/50f4caa1863449d84b97e936be8496df8f4d78bf) Fix ActionCacheLive save/restore failing on GitHub Actions runners with V2 cache service enabled (`ACTIONS_CACHE_SERVICE_V2=True`).

- Replace V1 REST protocol (`_apis/artifactcache/` at `ACTIONS_CACHE_URL`) with V2 Twirp RPC at `ACTIONS_RESULTS_URL`
- Restore uses `GetCacheEntryDownloadURL` → Azure Blob download via `@azure/storage-blob`
- Save uses `CreateCacheEntry` → Azure Blob upload → `FinalizeCacheEntryUpload`
- Version hash updated to match `@actions/cache` format (`paths|gzip|1.0`)
- Add `@azure/storage-blob` as direct dependency for reliable Azure Blob uploads/downloads
- Add exponential backoff retry for Twirp RPC calls on transient errors

## 0.11.2

### Bug Fixes

* [`3192780`](https://github.com/savvy-web/github-action-effects/commit/31927803cb5cd21511d6a295ef63806e18cd9098) Use `path.delimiter` instead of hardcoded `:` in `ActionOutputs.addPath()` so Windows PATH entries use `;`
* Add `shell: true` to `spawn()` on Windows in `CommandRunner` so `.cmd`/`.bat` files like `corepack.cmd` are resolved

## 0.11.1

### Bug Fixes

* [`7105768`](https://github.com/savvy-web/github-action-effects/commit/7105768c494c16e0aba7c9ea463a0b671e7ec85a) Fix ToolInstaller.download() hanging on Windows GitHub Actions runners by replacing fetch/undici with node:https direct streaming. Add Windows PowerShell zip extraction support for extractZip().

- Replace `globalThis.fetch` + `Readable.fromWeb()` with `node:https`/`node:http` and `stream.pipeline()` for reliable cross-platform binary downloads
- Add 3-minute socket timeout matching `@actions/tool-cache` behavior
- Add manual HTTP redirect following (up to 10 hops)
- Add retry with exponential backoff for transient errors (5xx, 408, 429, socket timeout, network errors)
- Add `User-Agent: github-action-effects` header
- Add Windows zip extraction via PowerShell `System.IO.Compression.ZipFile` (pwsh → powershell fallback)
- Add `-oq` flags to `unzip` on non-Windows for quiet overwrite behavior

## 0.11.0

### Features

* [`bcef2a2`](https://github.com/savvy-web/github-action-effects/commit/bcef2a2aa3e8cc7040165171669afa6034862087) Replace all `@actions/*` packages with native ESM implementations.

- Add runtime layer: `WorkflowCommand`, `RuntimeFile`,
  `ActionsConfigProvider`, `ActionsLogger`, `ActionsRuntime.Default`
- Inputs via Effect `Config` API backed by custom ConfigProvider
  (replaces `ActionInputs` service)
- Logging via Effect `Logger` emitting GitHub workflow commands
  (replaces `@actions/core` logging)
- Rewrite `ActionOutputsLive`, `ActionStateLive` with `RuntimeFile`
- Rewrite `CommandRunnerLive` with `node:child_process` spawn
- Rewrite `GitHubClientLive` with direct `@octokit/rest`
  (self-contained Layer, no longer a factory function)
- Rewrite `ToolInstallerLive` with low-level primitives
  (find, download, extractTar, extractZip, cacheDir, cacheFile)
- Rewrite `ActionCacheLive` with native cache protocol via `fetch`
- Reduce `ActionLogger` to `group` + `withBuffer`
  (annotations handled by Effect Logger)
- Simplify `Action.run` to use `ActionsRuntime.Default`
- Add `@octokit/rest` and `@octokit/auth-app` as direct dependencies
- Remove all `@actions/*` peer and dev dependencies

### Other

* [`bcef2a2`](https://github.com/savvy-web/github-action-effects/commit/bcef2a2aa3e8cc7040165171669afa6034862087) Closes #51

## 0.10.0

### Breaking Changes

* [`ff327e0`](https://github.com/savvy-web/github-action-effects/commit/ff327e02c9e3eeff205c54b4c8912ece843457b7) Remove `OtelExporterLive`, `OtelTelemetryLive`, `InMemoryTracer`,
  `ActionTelemetry`, `ActionTelemetryLive`, `ActionTelemetryTest`,
  `TelemetryReport`, `GitHubOtelAttributes`, and all OTel schemas
* Remove `Effect.withSpan` instrumentation from all service layers
* Remove `timings()` method from `ReportBuilder`
* Remove 12 `@opentelemetry/*` dependencies
* `Action.run()` no longer reads `otel-*` inputs

### Features

* [`ff327e0`](https://github.com/savvy-web/github-action-effects/commit/ff327e02c9e3eeff205c54b4c8912ece843457b7) Add `cacheFile` to `ActionsToolCache` service (closes #46)
* Add `installBinary` and `installBinaryAndAddToPath` to `ToolInstaller`
  for single-binary tools like Biome CLI (closes #40)
* Add `BinaryInstallOptions` type export

### Other

* [`ff327e0`](https://github.com/savvy-web/github-action-effects/commit/ff327e02c9e3eeff205c54b4c8912ece843457b7) Fixes #47.

## 0.9.0

### Breaking Changes

* [`64b6a04`](https://github.com/savvy-web/github-action-effects/commit/64b6a049057d9a6384a83d576efff4025915ee28) `Action.run()` signature changed from `run(program, layer?)` to `run(program, options?)` where options is `{ layer?, platform? }`. Live layer types now include wrapper service requirements (e.g., `Layer.Layer<ActionInputs, never, ActionsCore>`).

### Features

* [`64b6a04`](https://github.com/savvy-web/github-action-effects/commit/64b6a049057d9a6384a83d576efff4025915ee28) Add `./testing` subpath export and platform abstraction for @actions/\* packages.

### Bug Fixes

* [`6dcae85`](https://github.com/savvy-web/github-action-effects/commit/6dcae852802f778490b600bbb9f8fa57b29f7e27) Replace dynamic `import()` with static imports in Live layers for ncc bundling compatibility.

ToolInstallerLive and GitHubAppLive previously used dynamic `import()` for `@actions/tool-cache`, `@actions/core`, and `@octokit/auth-app`. This broke `@vercel/ncc` bundling because ncc cannot follow dynamic imports, requiring consumers to add bare import hints in their entry points. All Live layers now use static imports consistently, so ncc resolves every dependency chain automatically without manual workarounds.

### Other

* [`64b6a04`](https://github.com/savvy-web/github-action-effects/commit/64b6a049057d9a6384a83d576efff4025915ee28) **Platform abstraction:** Six new wrapper services (ActionsCore, ActionsGitHub, ActionsCache, ActionsExec, ActionsToolCache, OctokitAuthApp) abstract @actions/\* packages behind Effect DI. All Live layers now consume these wrappers instead of importing @actions/\* directly. ActionsPlatformLive bundles all six for convenience.

**Testing subpath:** `@savvy-web/github-action-effects/testing` provides all service tags, Live layers, test layers, errors, schemas, and utils without triggering any @actions/\* module resolution. Eliminates \~20 lines of vi.mock boilerplate per consumer test file.

## 0.8.0

### Breaking Changes

* [`bcc26cc`](https://github.com/savvy-web/github-action-effects/commit/bcc26cccfdf3bffa9b1bd9472e7b1009d8711c11) Removed all `*Base` error exports (e.g., `ActionInputErrorBase`, `GitHubClientErrorBase`)
* Service types are now class-based `Context.Tag` instances; code that used the old interface type as a type annotation should use `typeof ServiceName.Service` instead

### Refactoring

* [`bcc26cc`](https://github.com/savvy-web/github-action-effects/commit/bcc26cccfdf3bffa9b1bd9472e7b1009d8711c11) Migrate services from `Context.GenericTag` to class-based `Context.Tag` and simplify error declarations.

**Services:** All 30 service definitions now use `class extends Context.Tag("github-action-effects/ServiceName")` instead of the deprecated `interface + Context.GenericTag` pattern.

**Errors:** All 28 error types now use inline `Data.TaggedError` class declarations instead of the separate `Base` export pattern.

**SemverResolver:** Updated to use the new `semver-effect` API (`SemVer.parse`, `Range.parse`, instance bump methods).

### Dependencies

* | [`bcc26cc`](https://github.com/savvy-web/github-action-effects/commit/bcc26cccfdf3bffa9b1bd9472e7b1009d8711c11) | Dependency     | Type  | Action | From    | To |
  | :-------------------------------------------------------------------------------------------------------------- | :------------- | :---- | :----- | :------ | -- |
  | @effect/cluster                                                                                                 | peerDependency | added | —      | ^0.57.0 |    |
  | @effect/rpc                                                                                                     | peerDependency | added | —      | ^0.74.0 |    |
  | @effect/sql                                                                                                     | peerDependency | added | —      | ^0.50.0 |    |

## 0.7.0

### Features

* [`363246a`](https://github.com/savvy-web/github-action-effects/commit/363246a4ba14dc60a633fe36ec3e08f9bf276ef6) Telemetry timing reports are now only written to step summaries when
  `log-level` is set to `debug` (or `auto` with `RUNNER_DEBUG=1`),
  reducing clutter in action output for most users.

### Refactoring

* [`363246a`](https://github.com/savvy-web/github-action-effects/commit/363246a4ba14dc60a633fe36ec3e08f9bf276ef6) Replace imperative parsing libraries with pure Effect implementations.
  SemverResolver now uses `semver-effect`, ConfigLoaderLive uses
  `jsonc-effect` and `yaml-effect`, and WorkspaceDetectorLive uses
  `yaml-effect`. All three provide typed errors natively, eliminating
  manual `Effect.try` wrappers. `jsonc-parser` and `yaml` are no longer
  required as peer dependencies.

### Dependencies

* | [`363246a`](https://github.com/savvy-web/github-action-effects/commit/363246a4ba14dc60a633fe36ec3e08f9bf276ef6) | Dependency     | Type    | Action | From   | To |
  | :-------------------------------------------------------------------------------------------------------------- | :------------- | :------ | :----- | :----- | -- |
  | semver-effect                                                                                                   | dependency     | added   | —      | ^0.1.0 |    |
  | jsonc-effect                                                                                                    | dependency     | added   | —      | ^0.2.0 |    |
  | yaml-effect                                                                                                     | dependency     | added   | —      | ^0.1.5 |    |
  | semver                                                                                                          | dependency     | removed | ^7.7.4 | —      |    |
  | @types/semver                                                                                                   | devDependency  | removed | ^7.7.1 | —      |    |
  | jsonc-parser                                                                                                    | peerDependency | removed | ^3.3.1 | —      |    |
  | yaml                                                                                                            | peerDependency | removed | ^2.8.2 | —      |    |

- | [`89d7a8b`](https://github.com/savvy-web/github-action-effects/commit/89d7a8b9248f8058ecfbdca9bb6073d2ff5113d9) | Dependency     | Type    | Action   | From     | To |
  | :-------------------------------------------------------------------------------------------------------------- | :------------- | :------ | :------- | :------- | -- |
  | @effect/opentelemetry                                                                                           | dependency     | updated | ^0.61.0  | ^0.62.0  |    |
  | @effect/cluster                                                                                                 | devDependency  | added   | —        | ^0.57.0  |    |
  | @effect/platform                                                                                                | devDependency  | updated | ^0.94.0  | ^0.95.0  |    |
  | @effect/platform-node                                                                                           | devDependency  | updated | ^0.104.0 | ^0.105.0 |    |
  | @effect/rpc                                                                                                     | devDependency  | added   | —        | ^0.74.0  |    |
  | @effect/sql                                                                                                     | devDependency  | added   | —        | ^0.50.0  |    |
  | effect                                                                                                          | devDependency  | updated | ^3.19.19 | ^3.20.0  |    |
  | @savvy-web/changesets                                                                                           | devDependency  | updated | ^0.4.2   | ^0.5.1   |    |
  | @savvy-web/commitlint                                                                                           | devDependency  | updated | ^0.4.0   | ^0.4.1   |    |
  | @savvy-web/lint-staged                                                                                          | devDependency  | updated | ^0.5.1   | ^0.6.0   |    |
  | @savvy-web/rslib-builder                                                                                        | devDependency  | updated | ^0.16.0  | ^0.18.1  |    |
  | @savvy-web/vitest                                                                                               | devDependency  | updated | ^0.2.0   | ^0.2.1   |    |
  | @actions/cache                                                                                                  | peerDependency | updated | ^4.0.0   | ^6.0.0   |    |
  | @actions/tool-cache                                                                                             | peerDependency | updated | ^3.0.0   | ^4.0.0   |    |

## 0.6.3

### Bug Fixes

* [`ccbbf97`](https://github.com/savvy-web/github-action-effects/commit/ccbbf97e6c531283f9a20f5b0b23f7dbaa27d84f) Retry GitBranch operations on transient 5xx errors with exponential backoff (#24)
* Auto-buffer action output at info level and flush on failure (#25)
* Enrich CommandRunnerError.message with command, args, and stderr context (#26)

## 0.6.2

### Bug Fixes

* [`509d2a2`](https://github.com/savvy-web/github-action-effects/commit/509d2a2a7a633f01bfe4051ef53508bc6f545deb) Fix `NpmRegistry.getPackageInfo` returning undefined for `integrity` and `tarball` fields due to `npm view` using flat dot-notation keys (`"dist.integrity"`) instead of nested objects. Fixes #21.

## 0.6.1

### Bug Fixes

* [`87e2ce3`](https://github.com/savvy-web/github-action-effects/commit/87e2ce33648daceeb399d2c217b47cdf767d4cdc) Fix GitHubApp.withToken failing with "installationId option is required" by auto-discovering the installation ID when not explicitly provided. The fix authenticates as the app (JWT), lists installations, and matches by GITHUB\_REPOSITORY owner. Fixes #18.

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
