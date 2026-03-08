# Errors and Schemas

Error types, schema patterns, and data encoding for
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [services.md](./services.md) for service interfaces that use these types.

---

## Error Pattern

All errors use `Data.TaggedError` with explicit `Base` exports marked
`@internal` for api-extractor compatibility.

### Error Types

| Error | Service | Key Fields |
| --- | --- | --- |
| `ActionInputError` | ActionInputs | input name, raw value, schema validation issues |
| `ActionOutputError` | ActionOutputs | output name, reason |
| `ActionStateError` | ActionState | key name, reason (`"decode_failed"`, `"not_found"`), optional raw value |
| `ActionEnvironmentError` | ActionEnvironment | variable name, reason |
| `ActionCacheError` | ActionCache | key, operation (save/restore), reason |
| `CommandRunnerError` | CommandRunner | command, args, exitCode, stderr |
| `ConfigLoaderError` | ConfigLoader | path, operation, reason |
| `ChangesetError` | ChangesetAnalyzer | operation, reason |
| `GitHubClientError` | GitHubClient | operation, status (HTTP), reason, retryable (boolean) |
| `GitHubGraphQLError` | GitHubGraphQL | operation, reason, errors array |
| `GitHubAppError` | GitHubApp | operation, reason |
| `GitBranchError` | GitBranch | operation, name, reason |
| `GitCommitError` | GitCommit | operation, reason |
| `GitTagError` | GitTag | operation, tag, reason |
| `GitHubReleaseError` | GitHubRelease | operation, tag, reason, retryable |
| `GitHubIssueError` | GitHubIssue | operation, issueNumber, reason, retryable |
| `CheckRunError` | CheckRun | name, operation (create/update/complete), reason |
| `PullRequestCommentError` | PullRequestComment | prNumber, operation, reason |
| `RateLimitError` | RateLimiter | reason |
| `WorkflowDispatchError` | WorkflowDispatch | operation, workflow, reason |
| `NpmRegistryError` | NpmRegistry | pkg, operation, reason |
| `PackagePublishError` | PackagePublish | operation, pkg, registry, reason |
| `PackageManagerError` | PackageManagerAdapter | operation, reason |
| `WorkspaceDetectorError` | WorkspaceDetector | operation, reason |
| `ToolInstallerError` | ToolInstaller | operation, name, reason |
| `TokenPermissionError` | TokenPermissionChecker | missing permissions array |
| `SemverResolverError` | SemverResolver | operation, version, reason |
| `OtelExporterError` | OtelExporterLive | reason (config/import/parse failure) |

### Error Hierarchy

Services that depend on `GitHubClient` map underlying `GitHubClientError`
to their own domain-specific error type:

- `CheckRunError` wraps `GitHubClientError` with check-run-specific context
- `PullRequestCommentError` wraps with PR-specific context
- `GitHubReleaseError` wraps with release-specific context
- `GitHubIssueError` wraps with issue-specific context
- `GitBranchError` wraps with branch-specific context
- `GitCommitError` wraps with commit-specific context
- `GitTagError` wraps with tag-specific context
- `WorkflowDispatchError` wraps with dispatch-specific context
- `RateLimitError` wraps with rate-limit context

The `retryable` flag on `GitHubClientError` is `true` for 429 (rate limit)
and 5xx status codes, enabling consumers to implement retry logic.

---

## Schema Patterns

Schemas use `Schema.Struct` with annotations for validated types. Types are
inferred via `typeof X.Type`.

### Core Schemas

| Schema | Location | Purpose |
| --- | --- | --- |
| `ActionLogLevel` | `schemas/LogLevel.ts` | Log level enum (`"info"`, `"verbose"`, `"debug"`) |
| `LogLevelInput` | `schemas/LogLevel.ts` | Log level input with `"auto"` option |
| `GitHubContext` | `schemas/Environment.ts` | Validated GITHUB_* environment variables |
| `RunnerContext` | `schemas/Environment.ts` | Validated RUNNER_* environment variables |
| `Status` | `schemas/GithubMarkdown.ts` | Status values for GFM builders |
| `ChecklistItem` | `schemas/GithubMarkdown.ts` | Checklist item schema |
| `CapturedOutput` | `schemas/GithubMarkdown.ts` | Captured command output schema |
| `BumpType` | `schemas/Changeset.ts` | Bump type (`"major"`, `"minor"`, `"patch"`) |
| `Changeset` | `schemas/Changeset.ts` | Parsed changeset file |
| `ChangesetFile` | `schemas/Changeset.ts` | Changeset file with path |
| `FileChange` | `schemas/GitTree.ts` | File change for Git Data API commits |
| `TreeEntry` | `schemas/GitTree.ts` | Git tree entry |
| `PackageManagerName` | `schemas/PackageManager.ts` | PM name enum |
| `PackageManagerInfo` | `schemas/PackageManager.ts` | Detected PM info |
| `NpmPackageInfo` | `schemas/NpmPackage.ts` | npm registry package metadata |
| `RateLimitStatus` | `schemas/RateLimit.ts` | GitHub API rate limit status |
| `MetricData` | `schemas/Telemetry.ts` | Numeric metric observation |
| `PermissionLevel` | `schemas/TokenPermission.ts` | Token permission level (`"read"`, `"write"`, `"admin"`) |
| `PermissionGap` | `schemas/TokenPermission.ts` | Missing/insufficient permission |
| `ExtraPermission` | `schemas/TokenPermission.ts` | Over-scoped permission |
| `PermissionCheckResult` | `schemas/TokenPermission.ts` | Full permission check result |
| `OtelEnabled` | `schemas/OtelExporter.ts` | OTel enabled state (`"enabled"`, `"disabled"`, `"auto"`) |
| `OtelProtocol` | `schemas/OtelExporter.ts` | OTLP protocol (`"grpc"`, `"http/protobuf"`, `"http/json"`) |
| `WorkspaceType` | `schemas/Workspace.ts` | Workspace type enum |
| `WorkspaceInfo` | `schemas/Workspace.ts` | Detected workspace metadata |
| `WorkspacePackage` | `schemas/Workspace.ts` | Individual workspace package |
| `InstallationToken` | `services/GitHubApp.ts` | GitHub App installation token with permissions |

### Schema Utilities

| Utility | Location | Purpose |
| --- | --- | --- |
| `resolveOtelConfig` | `schemas/OtelExporter.ts` | Resolve OTel config from inputs + env vars |
| `parseOtelHeaders` | `schemas/OtelExporter.ts` | Parse OTLP header string to record |

### Shared Decode Helpers

`decodeInput` and `decodeJsonInput` are extracted to
`layers/internal/decodeInput.ts` and shared by both `ActionInputsLive` and
`ActionInputsTest`, eliminating duplication of schema validation logic.

`decodeState` is extracted to `layers/internal/decodeState.ts` and shared
by both `ActionStateLive` and `ActionStateTest`.

`environmentMaps` in `layers/internal/environmentMaps.ts` provides shared
environment variable mapping logic for `ActionEnvironmentLive` and
`ActionEnvironmentTest`.

---

## Data Flow

### Input Validation Flow

```text
action.yml inputs
  -> @actions/core.getInput()
  -> ActionInputs.get(name, schema)
  -> Effect.Schema.decode
  -> typed value | ActionInputError
```

### Logging Flow

```text
Effect.log*() calls in user program
  -> ActionLogger (Effect Logger implementation)
  -> always: write internal details to core.debug() (GitHub-gated)
  -> based on log-level:
     info:    capture in buffer
              -> on success: discard, emit outcome summary via core.info()
              -> on failure: flush buffer via core.info(), then outcome
     verbose: emit milestone markers via core.info() (start/finish)
     debug:   emit everything via core.info()

log-level resolution:
  "auto" -> RUNNER_DEBUG === '1' ? "debug" : "info"
  "info" | "verbose" | "debug" -> use directly
```

### Output Flow

```text
ActionOutputs.set(name, value)
  -> @actions/core.setOutput()
  -> available to downstream steps

ActionOutputs.summary(gfm)
  -> $GITHUB_STEP_SUMMARY file
  -> visible in Actions UI
```

### State Serialization Flow

```text
ActionState.save(key, value, schema)
  -> Schema.encode(schema)(value)
  -> JSON.stringify(encoded)
  -> @actions/core.saveState(key, json)
  -> persisted across action phases

ActionState.get(key, schema)
  -> @actions/core.getState(key)
  -> empty string? -> ActionStateError (not_found)
  -> JSON.parse(raw)
  -> Schema.decode(schema)(parsed)
  -> typed value | ActionStateError (decode_failed)
```

### OTel Export Flow

```text
Action.run(program)
  -> parse otel-enabled/endpoint/protocol/headers inputs
  -> resolveOtelConfig(inputs, env)
  -> if enabled:
       OtelExporterLive(config) dynamically imports protocol-specific packages
       -> OTLPTraceExporter captures Effect.withSpan spans
       -> OTLPMetricExporter forwards ActionTelemetry metrics
  -> if disabled/auto-no-endpoint:
       InMemoryTracer captures spans for TelemetryReport rendering
```

### Permission Check Flow

```text
TokenPermissionChecker.assertSufficient(requirements)
  -> reads InstallationToken.permissions from GitHubApp
  -> compares each required scope against granted (hierarchical: admin > write > read)
  -> returns PermissionCheckResult with granted/required/missing/extra/satisfied
  -> fails with TokenPermissionError if missing permissions
```
