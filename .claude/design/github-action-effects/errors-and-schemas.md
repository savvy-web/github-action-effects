---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-05-20
last-synced: 2026-05-20
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

See `src/errors/` for all tagged error definitions. Key types:

| Error | Service | Notes |
| --- | --- | --- |
| `ActionInputError` | (Config validation) | input name, raw value, schema validation issues |
| `ActionOutputError` | ActionOutputs | output name, reason |
| `ActionStateError` | ActionState | key name, reason, optional raw value |
| `ActionEnvironmentError` | ActionEnvironment | variable name, reason |
| `ActionCacheError` | ActionCache | key, operation, reason |
| `RuntimeEnvironmentError` | RuntimeFile | variable name, message |
| `CommandRunnerError` | CommandRunner | command, exitCode, reason; surfaces tail of long stderr for diagnostics |
| `ConfigLoaderError` | ConfigLoader | path, operation, reason |
| `ChangesetError` | ChangesetAnalyzer | operation, reason |
| `GitHubClientError` | GitHubClient | operation, status (HTTP), reason, retryable |
| `GitHubGraphQLError` | GitHubGraphQL | operation, reason, errors array |
| `GitHubAppError` | GitHubApp | operation (`"jwt"` \| `"token"` \| `"revoke"` \| `"identity"`), reason |
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
| `NpmRegistryError` | NpmRegistry | pkg, operation, reason; carries a `message` getter |
| `PackagePublishError` | PackagePublish | operation, pkg, registry, reason; carries `message` getter, source `cause`, and stderr tail |
| `PackageManagerError` | PackageManagerAdapter | operation, reason |
| `WorkspaceDetectorError` | WorkspaceDetector | operation, reason |
| `ToolInstallerError` | ToolInstaller | operation, tool, version, reason |
| `TokenPermissionError` | TokenPermissionChecker | missing permissions array |
| `SemverResolverError` | SemverResolver | operation, version, reason |
| `GitHubContentError` | GitHubContent | path, ref, reason |
| `GitHubCommitError` | GitHubCommit | ref, operation, reason |
| `GitHubArtifactMetadataError` | GitHubArtifactMetadata | operation, reason |
| `AttestError` | Attest | operation, reason |
| `OidcTokenError` | OidcTokenIssuer | audience, reason |
| `SigstoreSignerError` | SigstoreSigner | reason |
| `SbomError` | Sbom | operation, reason |

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
- `GitHubContentError` wraps with content-fetch context
- `GitHubCommitError` wraps with commit-graph context
- `GitHubArtifactMetadataError` wraps with artifact-metadata context
- `AttestError` wraps with attestation context

The `retryable` flag on `GitHubClientError` is `true` for 429 (rate limit) and 5xx status codes, enabling consumers to implement retry logic.

`NpmRegistryError` and `PackagePublishError` both carry a `message` getter so caught errors remain readable at the surface (e.g. in `console.error` or workflow command output) without forcing callers to destructure the tagged error. `PackagePublishError` also carries the source error as `cause` and surfaces the tail of long stderr output to aid diagnostics in CI logs. HTTP errors from `OidcTokenIssuerLive` route through `Effect.logDebug` so they appear in the step's debug buffer (visible on failure) rather than cluttering the success log.

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
| `PullRequestInfo` | `services/PullRequest.ts` | PR data (number, url, nodeId, title, state, head, base, draft, merged, mergedAt?, body?, mergeCommitSha?, baseSha?) |
| `PullRequestListOptions` | `services/PullRequest.ts` | PR list filter options |
| `PullRequestFile` | `services/PullRequest.ts` | File changed in a PR (filename, status) |
| `ExecOptions` | `services/CommandRunner.ts` | Command execution options (cwd, env, timeout) |
| `ExecOutput` | `services/CommandRunner.ts` | Command execution result (exitCode, stdout, stderr) |
| `CommentRecord` | `services/PullRequestComment.ts` | PR comment data (id, body) |
| `IssueData` | `services/GitHubIssue.ts` | Issue data (number, title, state, labels, htmlUrl?, nodeId?) |
| `ReleaseData` | `services/GitHubRelease.ts` | Release data |
| `ReleaseAsset` | `services/GitHubRelease.ts` | Release asset data |
| `TagRef` | `services/GitTag.ts` | Tag reference (tag, sha) |
| `PackResult` | `services/PackagePublish.ts` | Pack result: tarballPath, digest (sha512-base64 integrity), sha256Hex (hex SHA-256 for attestation), name, version, packedSize, unpackedSize, fileCount |
| `RegistryTarget` | `services/PackagePublish.ts` | Registry publishing target |
| `IdempotentPublishInput` | `services/PackagePublish.ts` | Input for publishIdempotent |
| `IdempotentPublishResult` | `services/PackagePublish.ts` | Outcome of publishIdempotent (published or skipped) |
| `DryRunResult` | `services/PackagePublish.ts` | Result of npm publish --dry-run |
| `InstallOptions` | `services/PackageManagerAdapter.ts` | PM install options |
| `PollOptions` | `services/WorkflowDispatch.ts` | Workflow dispatch poll options |
| `WorkflowRunStatus` | `services/WorkflowDispatch.ts` | Workflow run status |
| `CheckRunData` | `services/CheckRun.ts` | Check run record returned from create/get (id, name, status, conclusion, htmlUrl) |
| `CommitSummary` | `services/GitHubCommit.ts` | Commit summary (sha, message, author) |
| `CommitDetail` | `services/GitHubCommit.ts` | Commit with parent SHAs |
| `CommitFile` | `services/GitHubCommit.ts` | File changed between commits (filename, status) |
| `CommitComparison` | `services/GitHubCommit.ts` | Compare result (commits, files) |
| `StorageRecordInput` | `services/GitHubArtifactMetadata.ts` | Input for createStorageRecord |
| `AttestationListEntry` | `services/Attest.ts` | Entry from listForSubject (attestationUrl, predicateType) |
| `SbomAttestationInput` | `services/Attest.ts` | Input for Attest.sbom; accepts dependencies or pre-built bomDocument |
| `ProvenanceAttestationInput` | `services/Attest.ts` | Input for Attest.provenance |
| `ResolvedDependency` | `services/Sbom.ts` | Dependency for SBOM generation |
| `InFlightPackage` | `services/Sbom.ts` | In-flight workspace package for SBOM generation |
| `SbomSupplier` | `services/Sbom.ts` | NTIA supplier metadata |
| `SbomAuthor` | `services/Sbom.ts` | NTIA author-of-SBOM-data metadata |
| `SbomContact` | `services/Sbom.ts` | Supplier/author contact info |
| `SbomInput` | `services/Sbom.ts` | Input for Sbom.generate |
| `SigstoreSignerConfig` | `services/SigstoreSigner.ts` | Fulcio/Rekor URL overrides |

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
| `InstallationToken` | `services/GitHubApp.ts` | GitHub App installation token (Schema.Struct). Required fields: `token`, `expiresAt`, `installationId`. Optional identity fields: `appSlug`, `appUserId`, `appName` — populated by `GitHubToken.provision` when `resolveAppIdentity` succeeds. |
| `InTotoSubject` | `schemas/Attestation.ts` | Subject of an in-toto statement: `name` (PURL) + `digest` (algorithm → hex map) |
| `InTotoStatement` | `schemas/Attestation.ts` | In-toto Statement v1: `_type`, `subject[]`, `predicateType`, `predicate` (unknown) |
| `SigstoreBundle` | `schemas/Attestation.ts` | Sigstore bundle v0.3 wire format: `mediaType`, `verificationMaterial`, `dsseEnvelope` (both unknown) |
| `AttestInput` | `schemas/Attestation.ts` | Input for Attest.buildStatement: `subjects`, `predicateType`, `predicate` |
| `AttestationRecord` | `schemas/Attestation.ts` | Full attestation result: `statement`, `bundle`, `attestationId`, `attestationUrl` |

### Shared Decode Helpers

`decodeInput` and `decodeJsonInput` are extracted to
`layers/internal/decodeInput.ts` and used by internal validation logic.

`decodeState` and `encodeState` are extracted to `layers/internal/decodeState.ts`
and shared by both `ActionStateLive` and `ActionStateTest`.

`environmentMaps` in `layers/internal/environmentMaps.ts` provides shared
environment variable mapping logic for `ActionEnvironmentLive` and
`ActionEnvironmentTest`.

### formatBotIdentity utility

`formatBotIdentity` in `src/utils/botIdentity.ts` is a pure function that derives a `BotIdentity` from an optional `{ appSlug?, appUserId? }` source. When both fields are present it returns a verified identity (`<appSlug>[bot]` / `<appUserId>+<appSlug>[bot]@users.noreply.github.com`); otherwise it returns the well-known `github-actions[bot]` fallback. Both `GitHubApp.botIdentity` and `GitHubToken.botIdentity` delegate to this function.

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
  -> At Info level: capture verbose entries in a fiber-scoped buffer
     -> on success: discard buffer
     -> on failure inside a group: ActionLogger.group flushes the buffer
        before ::endgroup::, then clears it
     -> on failure outside any group: withBuffer flushes at its own boundary
  -> At Debug level: pass through without buffering
```

Each buffered chunk prints exactly once — the innermost failing boundary wins.

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

### Attestation Flow

```text
Attest.attest(input)
  -> buildStatement(input)           — pure; assembles InTotoStatement
  -> SigstoreSigner.signStatement()  — fetches OIDC token (audience: "sigstore")
                                       via OidcTokenIssuer, signs through Fulcio,
                                       witnesses on Rekor, returns SigstoreBundle
  -> POST /repos/{owner}/{repo}/attestations
  -> returns AttestationRecord (statement + bundle + id + url)

Attest.sbom(input)
  -> if bomDocument provided: use as predicate verbatim
  -> else: Sbom.generate(input) -> CycloneDXBom -> Sbom.serializeJson() -> predicate
  -> Attest.attest({ subjects, predicateType: CYCLONEDX_BOM, predicate })

Attest.listForSubject(sha256Hex, options?)
  -> GET /repos/{owner}/{repo}/attestations/sha256:{hex}
  -> 404 -> return []
  -> parse each bundle's dsseEnvelope to extract predicateType
  -> client-side filter by options.predicateType if provided
  -> returns Array<AttestationListEntry>
```

---

## Current State

All error types and schemas are fully defined and in use across the service catalog. The error hierarchy with domain-specific wrapping of `GitHubClientError` is stable. The attestation cluster added `AttestError`, `OidcTokenError`, `SigstoreSignerError` and `SbomError` plus the `schemas/Attestation.ts` cluster (`InTotoSubject`, `InTotoStatement`, `SigstoreBundle`, predicate-type URI constants). `NpmRegistryError` and `PackagePublishError` gained `message` getters for readable error surfaces. `CommandRunnerError` and `PackagePublishError` surface stderr tails. `PackResult` gained `sha256Hex` for attestation API compatibility. `IssueData` gained `htmlUrl` and `nodeId`. `PullRequestInfo` gained `mergedAt`, `body`, `mergeCommitSha` and `baseSha`. `CheckRunData` is now returned from `CheckRun.create` (was just a number).

## Rationale

Tagged errors with structured fields enable pattern matching and programmatic
error handling in Effect pipelines. Inline `Data.TaggedError` declarations
keep error definitions concise. Schema validation at service boundaries
catches invalid data early with clear error messages.

## Related Documentation

- [index.md](./index.md) -- Architecture overview and design decisions
- [services.md](./services.md) -- Service interfaces that use these error and schema types
