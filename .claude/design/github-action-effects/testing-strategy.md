---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-19
last-synced: 2026-03-19
completeness: 90
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
dependencies. The `./testing` subpath export makes importing test infrastructure
straightforward without pulling in optional peer dependencies.

---

## Testing Subpath Export

**Import path:** `@savvy-web/github-action-effects/testing`

The `./testing` subpath export in `package.json` re-exports everything from
the main entry point **except**:

- The 6 platform wrapper Live layers: `ActionsCoreLive`, `ActionsGitHubLive`,
  `ActionsCacheLive`, `ActionsExecLive`, `ActionsToolCacheLive`,
  `OctokitAuthAppLive`
- `ActionsPlatformLive`
- The `Action` namespace (which statically imports `ActionsCoreLive`)

This prevents test environments from importing optional peer dependencies
(`@actions/cache`, `@actions/exec`, etc.) that may not be installed. All
services, Test layers, schemas, errors, and utility namespaces are available
via `./testing`.

**Included in `./testing`:**

- `ActionRunOptions`, `CoreServices`, `InputConfig`, `ParsedInputs` type exports
- All error classes
- All Test layers (`ActionLoggerTest`, `ActionInputsTest`, etc.)
- All Live layers that depend on services rather than @actions/* directly
- All schemas, services, and utility namespaces
- `ActionsCore`, `ActionsGitHub`, `ActionsCache`, `ActionsExec`,
  `ActionsToolCache`, `OctokitAuthApp` service interfaces (but NOT their Live
  layers)
- `ActionsPlatform` type alias
- `AppAuth`, `GitHubOctokit`, `AnnotationProperties`, `ActionsExecOptions`
  interfaces

---

## Testing Tiers

### Tier 1: Unit Tests with Test Layers

In-memory test layers replace real platform calls. No `@actions/core` imported.

```typescript
import { ActionLoggerTest, ActionInputsTest }
  from "@savvy-web/github-action-effects/testing"
```

### Tier 2: Integration Tests with Mock Wrapper Services

Live layers are used but with mock wrapper services substituted for the
`@actions/*` Live layers:

```typescript
import { ActionLoggerLive, ActionInputsLive, ActionsCore }
  from "@savvy-web/github-action-effects/testing"

// Provide a mock ActionsCore instead of ActionsCoreLive
const mockCore = Layer.succeed(ActionsCore, { getInput: () => "test", ... })
```

This approach tests the Live layer logic (schema validation, error mapping,
DI wiring) without requiring the real `@actions/core` package to be present.

---

## Unit Tests

**Location:** `src/**/*.test.ts`

**Framework:** Vitest with forks pool (Effect-TS compatibility)

**Approach:** Each service has a `Test` layer with in-memory backing. Tests
exercise services through the Effect runtime with test layers, never touching
real `@actions/core` APIs. Test layers use the namespace object pattern for
ergonomic test setup.

---

## Coverage Requirements

- 80% threshold for lines, functions, statements, branches
- v8 coverage provider

---

## Test File Organization

Test files are co-located with their implementation:

```text
src/services/ActionInputs.ts       — service interface
src/services/ActionInputs.test.ts  — service tests via test layer
src/layers/ActionInputsLive.ts     — live layer
src/layers/ActionInputsLive.test.ts — live layer tests with mocked deps
src/layers/ActionInputsTest.ts     — test layer (no test file needed)
```

---

## What is Tested

### Core Action I/O

**ActionInputs** -- Schema validation (valid/invalid), input laziness via
`Effect.sync`, multiline/boolean/optional variants, `parseAllInputs`
config-driven batch reading with cross-validation.

**ActionLogger** -- Buffer capture on success/failure, two-channel behavior
(always debug, conditionally info), three annotation types
(`annotationError`/`annotationWarning`/`annotationNotice`) via test layer
`type` field, FiberRef log level propagation.

**ActionOutputs** -- Output setting captured by test layer, live layer
`core.setOutput()`/`core.exportVariable()`/`core.addPath()`/`core.summary`
interactions, setFailed, setSecret.

**ActionState** -- save/get/getOptional with Schema encode/decode, phase
ordering errors, live layer core.saveState()/core.getState() interactions.

**ActionEnvironment** -- get/getOptional for individual env vars, github/runner
lazy accessors with schema validation, missing var errors, test layer reads
from provided record.

**ActionCache** -- save/restore/withCache bracket, CacheHit with hit/miss
and matchedKey, cache errors, test layer in-memory Map.

### Git Operations

**GitBranch** -- create/exists/delete/getSha/reset operations, error mapping
from GitHubClientError, test layer in-memory branch state.

**GitCommit** -- createTree/createCommit/updateRef/commitFiles, Git Data API
interactions, test layer in-memory state. Both createTree and commitFiles
support file deletions via `sha: null` entries (TreeEntryDeletion /
FileChangeDeletion).

**GitTag** -- create/delete/list/resolve operations, prefix filtering, test
layer in-memory tag state.

### GitHub API

**GitHubClient** -- REST callback, GraphQL query execution, pagination
(page incrementing, empty-page termination, maxPages), repo context from
GITHUB_REPOSITORY, error wrapping with HTTP status extraction, retryable
flag for 429/5xx, test layer recorded responses.

**GitHubGraphQL** -- query/mutation delegation to GitHubClient.graphql(),
error mapping to GitHubGraphQLError, test layer recorded responses.

**GitHubRelease** -- create/uploadAsset/getByTag/list operations, test layer
in-memory release state.

**GitHubIssue** -- list/close/comment/getLinkedIssues, REST + GraphQL
integration, test layer in-memory issue state.

**GitHubApp** -- generateToken/revokeToken/withToken bracket, JWT-based
auth, test layer in-memory token state.

**CheckRun** -- create/update/complete/withCheckRun bracket, failure case
completes with "failure" and re-raises cause, annotations capped at 50,
test layer CheckRunRecord array.

**PullRequest** -- get/list/create/update/getOrCreate/merge/addLabels/
requestReviewers, auto-merge via GraphQL, test layer in-memory PR state.

**PullRequestComment** -- create/upsert/find/delete, marker pattern
`<!-- savvy-web:KEY -->`, test layer per-PR comment storage with
instance-scoped ID counter.

**RateLimiter** -- checkRest/checkGraphQL/withRateLimit guard/withRetry,
rate limit threshold checking, test layer configurable state.

**WorkflowDispatch** -- dispatch/dispatchAndWait/getRunStatus, polling
behavior, test layer dispatch records.

### Build Tooling

**CommandRunner** -- exec/execCapture/execJson/execLines, exit codes,
timeout handling, cwd/env options, test layer response matching.

**NpmRegistry** -- getLatestVersion/getDistTags/getPackageInfo/getVersions,
npm view --json parsing, test layer in-memory metadata.

**PackagePublish** -- setupAuth/pack/publish/verifyIntegrity/
publishToRegistries, .npmrc writing, multi-registry support, test layer
in-memory publish state.

**PackageManagerAdapter** -- detect/install/getCachePaths/getLockfilePaths/exec,
PM detection logic, frozen lockfile, test layer in-memory state.

**WorkspaceDetector** -- detect/listPackages/getPackage, pnpm-workspace.yaml
and package.json workspaces parsing, test layer in-memory state.

**ToolInstaller** -- install/isCached/installAndAddToPath/installBinary/
installBinaryAndAddToPath, download/extract/cache lifecycle, single binary
installation with chmod, test layer in-memory tool cache.

**ChangesetAnalyzer** -- parseAll/hasChangesets/generate, changeset YAML
frontmatter parsing, test layer in-memory state.

**ConfigLoader** -- loadJson/loadJsonc/loadYaml/exists, schema validation
of loaded configs, test layer in-memory config state.

**DryRun** -- isDryRun/guard, mutation interception, test layer always-dry
with recorded labels.

### Utilities

**GithubMarkdown** -- Pure function output matches expected markdown strings.

**SemverResolver** -- compare/satisfies/latestInRange/increment/parse with
valid and invalid inputs.

**AutoMerge** -- enable/disable GraphQL mutations.

**ErrorAccumulator** -- Sequential and concurrent accumulation, success/
failure collection.

**ReportBuilder** -- Fluent builder API, markdown rendering, multi-target
output (summary/comment/checkRun).

### Schemas

**LogLevel** -- Parsing and round-trip validation, auto resolution.

---

## Integration Tests

Deferred until initial services are stable. Will use `nektos/act` via the
action-builder's `persistLocal` feature to run actions in Docker containers.

---

## Current State

Unit tests cover all 29 domain services, 4 namespace/utility objects, and key
schemas. The 6 platform wrapper services are tested indirectly through the Live
layers that depend on them (e.g., `ActionInputsLive.test.ts` mocks `ActionsCore`).
Coverage meets the 80% threshold. Integration tests are deferred pending service
stabilization.

## Rationale

In-memory test layers allow fast, deterministic testing without GitHub API
credentials or runner infrastructure. The co-located test file pattern keeps
tests discoverable alongside their implementations, and the forks pool ensures
compatibility with Effect-TS runtime requirements.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interfaces being tested
- [layers.md](./layers.md) -- Test layer implementations used in tests
