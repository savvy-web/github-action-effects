---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-20
last-synced: 2026-03-20
completeness: 95
related:
  - ./index.md
  - ./services.md
  - ./layers.md
dependencies: []
---

# Testing Strategy

Testing approach, coverage requirements, and test layer patterns for
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [layers.md](./layers.md) for test layer implementations.

---

## Overview

This document describes the testing strategy for the library, covering unit
test organization, coverage requirements, and what each service tests. All
tests use Effect test layers with in-memory backing to avoid real platform
dependencies. Since there are no `@actions/*` packages, tests run without
any GitHub Actions runtime installed.

---

## Testing Subpath Export

**Import path:** `@savvy-web/github-action-effects/testing`

The `./testing` subpath export in `package.json` re-exports everything from
the main entry point **except**:

- `GitHubClientLive` (imports `@octokit/rest`)
- `OctokitAuthAppLive` (imports `@octokit/auth-app`)
- `Action` namespace (imports `ActionsRuntime` which pulls in runtime modules)

This prevents test environments from importing `@octokit/rest` or
`@octokit/auth-app` when those packages may not be installed.

**Included in `./testing`:**

- `ActionRunOptions`, `CoreServices` type exports
- All error classes (including `RuntimeEnvironmentError`)
- All Test layers (e.g., `ActionLoggerTest`, `ActionCacheTest`, etc.)
- All Live layers except `GitHubClientLive` and `OctokitAuthAppLive`
- All schemas, services, and utility namespaces
- `OctokitAuthApp` and `AppAuth` service interfaces (but NOT `OctokitAuthAppLive`)
- Runtime modules: `ActionsConfigProvider`, `ActionsLogger`, `ActionsRuntime`

---

## Testing Tiers

### Tier 1: Unit Tests with Test Layers

In-memory test layers replace real platform calls. No external packages imported.

```typescript
import { ActionLoggerTest, ActionCacheTest }
  from "@savvy-web/github-action-effects/testing"
```

### Tier 2: Live Layer Tests with Mocked Dependencies

Live layers are tested with their actual logic but mocked dependencies:

```typescript
import { ActionOutputsLive }
  from "@savvy-web/github-action-effects/testing"

// Provide a mock FileSystem and set env vars for testing
const testFs = /* in-memory FileSystem mock */
```

Since Live layers no longer depend on `@actions/*` wrapper services but
instead use Node.js built-ins (WorkflowCommand, RuntimeFile, spawn, fetch),
Live layer tests mock at the Node.js level (env vars, filesystem) rather
than at a wrapper service level.

---

## Unit Tests

**Location:** `src/**/*.test.ts`

**Framework:** Vitest with forks pool (Effect-TS compatibility)

**Approach:** Each service has a `Test` layer with in-memory backing. Tests
exercise services through the Effect runtime with test layers, never touching
real GitHub APIs or workflow commands. Test layers use the namespace object
pattern for ergonomic test setup.

---

## Coverage Requirements

- 80% threshold for lines, functions, statements, branches
- v8 coverage provider

---

## Test File Organization

Test files are co-located with their implementation:

```text
src/services/ActionOutputs.ts         — service interface
src/services/ActionOutputs.test.ts    — service tests via test layer
src/layers/ActionOutputsLive.ts       — live layer
src/layers/ActionOutputsLive.test.ts  — live layer tests with mocked deps
src/layers/ActionOutputsTest.ts       — test layer (no test file needed)

src/runtime/WorkflowCommand.ts        — runtime module
src/runtime/WorkflowCommand.test.ts   — pure function tests
src/runtime/RuntimeFile.ts            — runtime module
src/runtime/RuntimeFile.test.ts       — tests with mock filesystem
src/runtime/ActionsConfigProvider.ts  — runtime module
src/runtime/ActionsConfigProvider.test.ts — tests with mock env vars
src/runtime/ActionsLogger.ts          — runtime module
src/runtime/ActionsLogger.test.ts     — tests with captured stdout
src/runtime/ActionsRuntime.ts         — runtime module
src/runtime/ActionsRuntime.test.ts    — integration test
```

---

## What is Tested

### Runtime Layer

**WorkflowCommand** -- `escapeData`, `escapeProperty`, `format`, and `issue`
functions with various special characters and command types.

**RuntimeFile** -- `prepareValue` for single-line and multiline values,
`append` with mock FileSystem and env vars.

**ActionsConfigProvider** -- Config resolution from `INPUT_*` env vars,
key transformation (uppercase, spaces to underscores, hyphens preserved),
empty value handling.

**ActionsLogger** -- Log level mapping (Debug to `::debug::`, Info to stdout,
Warning to `::warning::`, Error to `::error::`), annotation forwarding.

**ActionsRuntime** -- Integration test verifying all layers compose correctly.

### Core Action I/O

**ActionLogger** -- Group markers (`::group::` / `::endgroup::`), buffer
capture on success/failure, log level-dependent buffering behavior.

**ActionOutputs** -- Output setting via RuntimeFile, live layer
interactions with GITHUB_OUTPUT/GITHUB_ENV/GITHUB_PATH files,
setFailed via WorkflowCommand, setSecret via `::add-mask::`.

**ActionState** -- save/get/getOptional with Schema encode/decode, phase
ordering errors, live layer interactions with GITHUB_STATE file and
STATE_* env vars.

**ActionEnvironment** -- get/getOptional for individual env vars, github/runner
lazy accessors with schema validation, missing var errors.

**ActionCache** -- save/restore with the internal cache protocol, archive
creation/extraction, chunked upload, cache miss handling. Test layer
in-memory Map.

### Git Operations

**GitBranch** -- create/exists/delete/getSha/reset operations, error mapping
from GitHubClientError, test layer in-memory branch state.

**GitCommit** -- createTree/createCommit/updateRef/commitFiles, file deletions
via `sha: null` entries.

**GitTag** -- create/delete/list/resolve operations, prefix filtering.

### GitHub API

**GitHubClient** -- REST callback, GraphQL query execution, pagination
(page incrementing, empty-page termination, maxPages), repo context from
GITHUB_REPOSITORY, error wrapping with HTTP status extraction, retryable
flag for 429/5xx, HTML error page detection.

**GitHubGraphQL** -- query/mutation delegation to GitHubClient.graphql(),
error mapping.

**GitHubRelease** -- create/uploadAsset/getByTag/list operations.

**GitHubIssue** -- list/close/comment/getLinkedIssues, REST + GraphQL.

**GitHubApp** -- generateToken/revokeToken/botIdentity/withToken bracket,
installation resolution.

**CheckRun** -- create/update/complete/withCheckRun bracket, annotations
capped at 50.

**PullRequest** -- get/list/create/update/getOrCreate/merge/addLabels/
requestReviewers, auto-merge via GraphQL.

**PullRequestComment** -- create/upsert/find/delete, marker pattern.

**RateLimiter** -- checkRest/checkGraphQL/withRateLimit/withRetry.

**WorkflowDispatch** -- dispatch/dispatchAndWait/getRunStatus.

### Build Tooling

**CommandRunner** -- exec/execCapture/execJson/execLines, exit codes,
timeout handling.

**NpmRegistry** -- getLatestVersion/getDistTags/getPackageInfo/getVersions.

**PackagePublish** -- setupAuth/pack/publish/verifyIntegrity/
publishToRegistries.

**PackageManagerAdapter** -- detect/install/getCachePaths/getLockfilePaths/exec.

**WorkspaceDetector** -- detect/listPackages/getPackage.

**ToolInstaller** -- find/download/extractTar/extractZip/cacheDir/cacheFile,
native fetch downloads, tar/unzip extraction.

**ChangesetAnalyzer** -- parseAll/hasChangesets/generate.

**ConfigLoader** -- loadJson/loadJsonc/loadYaml/exists.

**DryRun** -- isDryRun/guard, mutation interception.

**TokenPermissionChecker** -- check/assertSufficient/assertExact/
warnOverPermissioned.

### Utilities

**GithubMarkdown** -- Pure function output matches expected markdown strings.

**SemverResolver** -- compare/satisfies/latestInRange/increment/parse.

**AutoMerge** -- enable/disable GraphQL mutations.

**ErrorAccumulator** -- Sequential and concurrent accumulation.

**ReportBuilder** -- Fluent builder API, markdown rendering, multi-target output.

### Schemas

**LogLevel** -- Parsing and round-trip validation, auto resolution.

---

## Integration Tests

Deferred until initial services are stable. Will use `nektos/act` via the
action-builder's `persistLocal` feature to run actions in Docker containers.

---

## Current State

Unit tests cover all 29 services, the 4 runtime modules, 4 namespace/utility
objects, and key schemas. Coverage meets the 80% threshold. Integration tests
are deferred pending service stabilization.

## Rationale

In-memory test layers allow fast, deterministic testing without GitHub API
credentials or runner infrastructure. The co-located test file pattern keeps
tests discoverable alongside their implementations, and the forks pool ensures
compatibility with Effect-TS runtime requirements. Since all `@actions/*`
packages are removed, tests have no dependency on the GitHub Actions runner
environment.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interfaces being tested
- [layers.md](./layers.md) -- Test layer implementations used in tests
