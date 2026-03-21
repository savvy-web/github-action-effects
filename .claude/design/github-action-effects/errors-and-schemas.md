---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-21
last-synced: 2026-03-21
completeness: 95
related:
  - ./index.md
  - ./services.md
dependencies: []
---

# Errors and Schemas

Error types, schema patterns, and data encoding for
`@savvy-web/github-action-effects`.

See [index.md](./index.md) for architecture overview.
See [services.md](./services.md) for service interfaces that use these types.

---

## Overview

This document describes the error handling and schema validation patterns used
across all services. Errors use inline `Data.TaggedError` class declarations.
Schemas use `Schema.Struct` with annotations for validated types, covering
everything from log levels and environment contexts to Git tree entries and
package metadata.

---

## Error Pattern

All errors extend `Data.TaggedError` inline:

```typescript
export class FooError extends Data.TaggedError("FooError")<{
  readonly field: string;
}> {}
```

No separate `Base` export is needed.

### Error Types

| Error | Service | Key Fields |
| --- | --- | --- |
| `ActionInputError` | (Config validation) | input name, raw value, schema validation issues |
| `ActionOutputError` | ActionOutputs | output name, reason |
| `ActionStateError` | ActionState | key name, reason, optional raw value |
| `ActionEnvironmentError` | ActionEnvironment | variable name, reason |
| `ActionCacheError` | ActionCache | key, operation (save/restore), reason |
| `RuntimeEnvironmentError` | RuntimeFile | variable name, message |
| `CommandRunnerError` | CommandRunner | command, args, exitCode, stderr, reason |
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
| `CheckRunError` | CheckRun | name, operation, reason |
| `PullRequestCommentError` | PullRequestComment | prNumber, operation, reason |
| `PullRequestError` | PullRequest | operation, prNumber (optional), reason |
| `RateLimitError` | RateLimiter | reason |
| `WorkflowDispatchError` | WorkflowDispatch | operation, workflow, reason |
| `NpmRegistryError` | NpmRegistry | pkg, operation, reason |
| `PackagePublishError` | PackagePublish | operation, pkg, registry, reason |
| `PackageManagerError` | PackageManagerAdapter | operation, reason |
| `WorkspaceDetectorError` | WorkspaceDetector | operation, reason |
| `ToolInstallerError` | ToolInstaller | operation, tool, version, reason |
| `TokenPermissionError` | TokenPermissionChecker | missing permissions array |
| `SemverResolverError` | SemverResolver | operation, version, reason |

### RuntimeEnvironmentError

New error type introduced with the runtime layer. Raised by `RuntimeFile`
when a required environment variable (e.g., `GITHUB_OUTPUT`, `GITHUB_STATE`)
is not set. Fields: `variable` (the env var name) and `message`. This error
is mapped to domain-specific errors by consuming layers (e.g.,
`ActionOutputsLive` maps it to `ActionOutputError`).

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
- `PullRequestError` wraps with PR-specific context

The `retryable` flag on `GitHubClientError` is `true` for 429 (rate limit)
and 5xx status codes, enabling consumers to implement retry logic.

---

## Schema Patterns

Schemas use `Schema.Struct` with annotations for validated types. Types are
inferred via `typeof X.Type`.

### Service Interfaces

TypeScript interfaces exported from service files:

| Interface | Location | Purpose |
| --- | --- | --- |
| `AppAuth` | `services/OctokitAuthApp.ts` | Callable auth function for app/installation tokens |
| `BotIdentity` | `services/GitHubApp.ts` | Bot identity for commit attribution (`name`, `email`) |
| `PullRequestInfo` | `services/PullRequest.ts` | PR data (number, url, nodeId, title, state, head, base, draft, merged) |
| `PullRequestListOptions` | `services/PullRequest.ts` | PR list filter options |
| `ExecOptions` | `services/CommandRunner.ts` | Command execution options (cwd, env, timeout) |
| `ExecOutput` | `services/CommandRunner.ts` | Command execution result (exitCode, stdout, stderr) |
| `CommentRecord` | `services/PullRequestComment.ts` | PR comment data (id, body) |
| `IssueData` | `services/GitHubIssue.ts` | Issue data (number, title, state, labels) |
| `ReleaseData` | `services/GitHubRelease.ts` | Release data |
| `ReleaseAsset` | `services/GitHubRelease.ts` | Release asset data |
| `TagRef` | `services/GitTag.ts` | Tag reference (tag, sha) |
| `PackResult` | `services/PackagePublish.ts` | Pack result (tarball, digest) |
| `RegistryTarget` | `services/PackagePublish.ts` | Registry publishing target |
| `InstallOptions` | `services/PackageManagerAdapter.ts` | PM install options |
| `PollOptions` | `services/WorkflowDispatch.ts` | Workflow dispatch poll options |
| `WorkflowRunStatus` | `services/WorkflowDispatch.ts` | Workflow run status |

### Action Run Interfaces

| Interface | Location | Purpose |
| --- | --- | --- |
| `ActionRunOptions` | `Action.ts` | Options for `Action.run()` (`layer?`) |
| `CoreServices` | `Action.ts` | Union type of services provided by `Action.run()` |

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
| `FileChange` | `schemas/GitTree.ts` | File change for Git Data API commits (union) |
| `FileChangeContent` | `schemas/GitTree.ts` | File change that adds or updates |
| `FileChangeDeletion` | `schemas/GitTree.ts` | File change that deletes (sha: null) |
| `TreeEntry` | `schemas/GitTree.ts` | Git tree entry (union) |
| `TreeEntryContent` | `schemas/GitTree.ts` | Tree entry that adds or updates |
| `TreeEntryDeletion` | `schemas/GitTree.ts` | Tree entry that deletes (sha: null) |
| `PackageManagerName` | `schemas/PackageManager.ts` | PM name enum |
| `PackageManagerInfo` | `schemas/PackageManager.ts` | Detected PM info |
| `NpmPackageInfo` | `schemas/NpmPackage.ts` | npm registry package metadata |
| `RateLimitStatus` | `schemas/RateLimit.ts` | GitHub API rate limit status |
| `PermissionLevel` | `schemas/TokenPermission.ts` | Token permission level |
| `PermissionGap` | `schemas/TokenPermission.ts` | Missing/insufficient permission |
| `ExtraPermission` | `schemas/TokenPermission.ts` | Over-scoped permission |
| `PermissionCheckResult` | `schemas/TokenPermission.ts` | Full permission check result |
| `WorkspaceType` | `schemas/Workspace.ts` | Workspace type enum |
| `WorkspaceInfo` | `schemas/Workspace.ts` | Detected workspace metadata |
| `WorkspacePackage` | `schemas/Workspace.ts` | Individual workspace package |
| `InstallationToken` | `services/GitHubApp.ts` | GitHub App installation token (Schema.Struct) |

### Shared Decode Helpers

`decodeInput` and `decodeJsonInput` are extracted to
`layers/internal/decodeInput.ts` and used by internal validation logic.

`decodeState` and `encodeState` are extracted to `layers/internal/decodeState.ts`
and shared by both `ActionStateLive` and `ActionStateTest`.

`environmentMaps` in `layers/internal/environmentMaps.ts` provides shared
environment variable mapping logic for `ActionEnvironmentLive` and
`ActionEnvironmentTest`.

---

## Data Flow

### Input Reading Flow

```text
action.yml inputs
  -> GitHub Actions runtime sets INPUT_* env vars
  -> ActionsConfigProvider reads INPUT_* (Config API)
  -> Config.string("name") / Config.integer("count")
  -> typed value | ConfigError
```

### Logging Flow

```text
Effect.log*() calls in user program
  -> ActionsLogger (Effect Logger)
  -> maps log levels:
     Debug/Trace → ::debug::message
     Info        → plain stdout
     Warning     → ::warning::message
     Error/Fatal → ::error::message
  -> annotations (file, line, col) become command properties

ActionLogger.withBuffer(label, effect):
  -> At Info level: capture in buffer
     -> on success: discard buffer
     -> on failure: flush buffer to stdout, then error
  -> At Debug level: pass through without buffering
```

### Output Flow

```text
ActionOutputs.set(name, value)
  -> RuntimeFile.append("GITHUB_OUTPUT", name, value)
  -> available to downstream steps

ActionOutputs.summary(gfm)
  -> fs.writeFileString($GITHUB_STEP_SUMMARY, content, { flag: "a" })
  -> visible in Actions UI

ActionOutputs.setFailed(message)
  -> WorkflowCommand.issue("error", {}, message)
  -> process.exitCode = 1

ActionOutputs.setSecret(value)
  -> WorkflowCommand.issue("add-mask", {}, value)
```

### State Serialization Flow

```text
ActionState.save(key, value, schema)
  -> Schema.encode(schema)(value)
  -> JSON.stringify(encoded)
  -> RuntimeFile.append("GITHUB_STATE", key, json)
  -> persisted across action phases

ActionState.get(key, schema)
  -> process.env[STATE_*key*]
  -> empty string? -> ActionStateError (not set)
  -> JSON.parse(raw)
  -> Schema.decode(schema)(parsed)
  -> typed value | ActionStateError
```

### Cache Flow (V2 Twirp Protocol)

```text
ActionCache.save(paths, key)
  -> Read ACTIONS_RESULTS_URL + ACTIONS_RUNTIME_TOKEN from env
  -> execFileSync("tar", ["czf", archivePath, ...paths])
  -> Twirp CreateCacheEntry (key, version hash)
  -> Azure Blob BlockBlobClient.uploadFile() (64 MB chunks, 8 concurrent)
  -> Twirp FinalizeCacheEntryUpload (key, size, version hash)
  -> cleanup temp archive

ActionCache.restore(paths, primaryKey, restoreKeys?)
  -> Twirp GetCacheEntryDownloadURL with keys + version hash
  -> miss → Option.none()
  -> Azure Blob BlobClient.downloadToFile() from signed URL
  -> execFileSync("tar", ["xzf", archivePath])
  -> cleanup temp archive
  -> Option.some(matchedKey)

Version hash: sha256(paths.join("|") + "|gzip|1.0")
Retry: exponential backoff (3s base, 1.5x, 5 attempts) on 5xx/network for Twirp;
       Azure SDK handles its own retries internally.
```

### Permission Check Flow

```text
TokenPermissionChecker.assertSufficient(requirements)
  -> reads InstallationToken.permissions from GitHubApp
  -> compares each required scope against granted (hierarchical: admin > write > read)
  -> returns PermissionCheckResult
  -> fails with TokenPermissionError if missing permissions
```

---

## Current State

All 29 error types and 25+ schemas are fully defined and in use across the
service catalog. The error hierarchy with domain-specific wrapping of
`GitHubClientError` is stable. `RuntimeEnvironmentError` is new, used by
the runtime layer for missing environment variables.

## Rationale

Tagged errors with structured fields enable pattern matching and programmatic
error handling in Effect pipelines. Inline `Data.TaggedError` declarations
keep error definitions concise. Schema validation at service boundaries
catches invalid data early with clear error messages.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interfaces that use these error and schema types
