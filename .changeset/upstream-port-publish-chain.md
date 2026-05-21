---
"@savvy-web/github-action-effects": minor
---

## Features

### New attestation stack — `Attest`, `SigstoreSigner`, `OidcTokenIssuer`, `Sbom`

This branch introduces a complete artifact-attestation toolchain — every service, schema, and helper below is **new** (no equivalent existed on `main`):

- **`Attest` service** — the end-to-end attest/sign/upload surface. `buildStatement` constructs an in-toto Statement v1 from subjects + a typed predicate; `buildBundle` signs it into a Sigstore bundle; `attest` does the full build → sign → `POST /repos/{owner}/{repo}/attestations` round trip and returns an `AttestationRecord` (statement + bundle + attestation id + UI URL); `provenance` and `sbom` are the SLSA-provenance and CycloneDX-SBOM convenience wrappers; `save` writes a statement or bundle to disk for inspection. Live and Test layers (`AttestLive`, `AttestTest`, with `AttestTestFullLayer` / `makeAttestTestState`) ship alongside.
- **`SigstoreSigner` service** — signs an in-toto statement into a Sigstore v0.3 DSSE bundle via Fulcio + Rekor. Exports `IN_TOTO_PAYLOAD_TYPE`, `SIGSTORE_OIDC_AUDIENCE`, the `SigstoreSignerConfig` knobs (`fulcioBaseURL` / `rekorBaseURL`), and a `makeSigstoreSignerLive` factory. Backed by the new `@sigstore/sign` and `@sigstore/bundle` dependencies.
- **`OidcTokenIssuer` service** — requests a GitHub Actions OIDC ID token for a given audience (e.g. `"sigstore"` for Fulcio cert issuance), reading `ACTIONS_ID_TOKEN_REQUEST_TOKEN` / `ACTIONS_ID_TOKEN_REQUEST_URL`. `saveToken` is exported for persisting the issued token. This is the `id-token: write` plumbing the signer depends on.
- **`Sbom` service** — generates a CycloneDX 1.5 BOM from a resolved dependency graph (`generate`), serializes it to canonical JSON (`serializeJson`), and writes it to disk (`save`). Models `ResolvedDependency`, `InFlightPackage` (siblings released in the same wave that the registry can't see yet), `SbomInput`, and re-exports the `CycloneDXBom` model so callers don't depend on `@cyclonedx/cyclonedx-library` directly. Backed by the new `@cyclonedx/cyclonedx-library` dependency.

Supporting public surface, also new:

- **`Attestation` schema cluster** (`src/schemas/Attestation.ts`) — `InTotoStatement`, `InTotoSubject`, `SigstoreBundle`, the `AttestInput` / `AttestationRecord` shapes, and the predicate-type / media-type constants `IN_TOTO_STATEMENT_V1`, `SLSA_PROVENANCE_V1`, `CYCLONEDX_BOM`, `SPDX_V2_3`, `SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE`.
- **`intoto` helpers** (`src/utils/intoto.ts`) — pure, Effect-free constructors `buildStatement`, `subject`, `serializeStatement`, and the `npmPurl` PURL helper, for building and inspecting statements without the service plumbing.
- **`slsa` helpers** (`src/utils/slsa.ts`) — `decodeJwtClaims` (extract OIDC claims from a runner-issued JWT without re-verifying) and `buildSLSAProvenancePredicate` (assemble a SLSA Provenance v1 predicate matching `@actions/attest`'s shape), plus the `GITHUB_BUILD_TYPE` constant and `OidcClaims` type.
- **New error types** — `AttestError`, `SigstoreSignerError`, `OidcTokenError`, `SbomError`, and `SlsaError`.

### New `GitHubContent`, `GitHubCommit`, and `GitHubArtifactMetadata` services

Three new REST-backed services (all new files vs `main`), each with Live and Test layers:

- **`GitHubContent`** — `getFile(path, ref?)` reads a repository file's decoded UTF-8 contents at a ref (default branch when `ref` omitted); fails with `GitHubContentError` when the path is not a file.
- **`GitHubCommit`** — reads the GitHub commit graph (distinct from the local-`git` `GitCommit` service): `get(ref)`, `list(ref)`, and `compare(base, head)`, modeling `CommitSummary` / `CommitDetail` / `CommitFile` / `CommitComparison`. Fails with the new `GitHubCommitError`.
- **`GitHubArtifactMetadata`** — `createStorageRecord(input)` writes a GitHub Packages artifact-metadata storage record (the `StorageRecordInput` shape: purl, digest, version, registry/artifact URLs) linking an attestation to a published artifact. Fails with the new `GitHubArtifactMetadataError`.

### New `RegistryClassifier` utility namespace

`src/utils/RegistryClassifier.ts` exports URL-safe registry classification: `getRegistryType`, `getRegistryDisplayName`, `generatePackageViewUrl`, the `isNpmRegistry` / `isGitHubPackagesRegistry` / `isJsrRegistry` / `isCustomRegistry` predicates, and the `RegistryType` type. All functions parse the URL and check the hostname (exact or subdomain match) rather than substring-matching, closing the CWE-20 spoofing vector (`http://evil-npmjs.org`, `http://npmjs.org.evil.com`).

### New `Step` module — step-buffered logging primitive

A new top-level `Step` namespace exports `withStep`, `success`, `collapse`, and `groupStep` for orchestrators that want one summary line per logical step with detail buffered for error spills. Behaviour summary:

- `Step.withStep(name, effect)` opens a fresh debug buffer for the step, runs the effect, emits `✅ <name>: <line>` on success (line set via `Step.success`), or `❌ <name>: <error>` + the spilled debug buffer on failure. Original error propagates untouched.
- `Step.collapse(steps, reducer)` runs N steps in parallel; all-success → one collapsed info line; any failure or `null`-from-reducer → fall back to per-step nested lines.
- `Step.groupStep(name, effect)` wraps `withStep` inside `ActionLogger.group` — the right shape for phase-level entry points.

Inside a `withStep` envelope, `Effect.logDebug` and `Effect.logInfo` are buffered; only the success line emits live on the happy path. Warnings and errors pass through (they map to GitHub Actions annotations). Outside a step, the existing logger semantics are unchanged.

### `Attest.listForSubject` for idempotent attestation reuse

Part of the new `Attest` service (above). Probes `GET /repos/{owner}/{repo}/attestations/sha256:{hex}` for existing attestations on a tarball digest, parses each bundle's in-toto statement to extract the predicate type, and returns the matching attestation URLs. Empty list on 404. Lets the orchestrator skip re-writing attestations on a recovery run where the tarball already has them.

### `Attest.sbom` accepts a pre-built BOM document

The new `Attest` service's `sbom` method's options carry a `bomDocument` field. Pass a parsed CycloneDX BOM and the library attests it verbatim, replacing the prior dependency-array path that produced a sparse BOM with no components. The dependency-array path still works for callers that have not migrated.

### `PackagePublish` redesign for the self-recovering publish chain

- `pack` now returns `{ tarballPath, digest, sha256Hex, name, version, packedSize, unpackedSize, fileCount }`. `digest` is the npm `sha512-<base64>` integrity format (matches `dist.integrity`); `sha256Hex` is the lowercase hex sha256 of the tarball file (the format the GitHub artifact-metadata and attestation APIs accept). The two are produced from the same on-disk tarball and are not interchangeable.
- New `publishTarball(tarballPath, options)` method publishes a pre-packed tarball to a specific registry. Lets the orchestrator pack once per build directory and publish the identical bytes to N registries without a second pack.
- New `packageManager` option on `publish` and `publishIdempotent.options` dispatches `npm publish` through the active manager's executor (`pnpm dlx npm`, `yarn npm`, `bun x npm`, or bare `npm`). The non-default dispatchers fetch a fresh npm 11.5.1+ rather than the runner's bundled npm 10.x — critical for npm trusted publishing's OIDC token exchange.
- `npm publish` invocations now always include `--loglevel verbose` and stream to the runner log via `runner.exec({ streaming: true })`. The verbose flag surfaces the OIDC token-exchange request that would otherwise be invisible on failure.
- `publishIdempotent` is now deprecated. Its fused probe-then-publish logic hardcoded the default registry and could not recover from a partial publish across multiple registries. New callers should compose `pack` + `NpmRegistry.getPublishedIntegrity` + `publishTarball` themselves.

### `NpmRegistry` per-target probe

- `getVersions(pkg, options?)` and `getPackageInfo(pkg, version?, options?)` accept an optional `{ registry }` override; appends `--registry <url>` to the `npm view` invocation. The prior signatures keep working with no override (default registry).
- New `getPublishedIntegrity(packageName, version, { registry })` method. Returns `Option.some(digest)` when the version is present with `dist.integrity`, `Option.none()` on E404 ("not published"). The single decision primitive for the self-recovering publish flow.

### `Sbom` service supplier and author metadata

On the new `Sbom` service (above), `Sbom.generate` accepts optional `supplier` and `authors` fields. Threaded onto the emitted BOM's `metadata.supplier` and `metadata.authors`, satisfying NTIA minimum-elements compliance for a caller that supplies the template.

### Existing GitHub services gained methods and fields

Additive only — every existing signature still type-checks:

- **`GitHubIssue`** — new `get(issueNumber)` returning `IssueData`; `IssueData` gained optional `htmlUrl` and `nodeId`.
- **`CheckRun`** — new `get(checkRunId)` and a new `CheckRunData` shape (`id` / `name` / `status` / `conclusion` / `htmlUrl`). `create` now resolves to `CheckRunData` rather than a bare check-run id, so callers get the full record without a follow-up `get`.
- **`GitHubRelease`** — new `updateRelease(releaseId, options)` (returns the updated `ReleaseData`) and `listReleaseAssets(releaseId)`.
- **`PullRequest`** — new `listFiles(number)` and `listAssociatedWithCommit(sha)`, plus a new `PullRequestFile` shape. `PullRequestInfo` gained optional `mergedAt`, `body`, `mergeCommitSha`, and `baseSha` fields.

### `PackagePublishError` carries the source error

`PackagePublishError` gained an optional `cause` field holding the underlying error (e.g. the `CommandRunnerError` from a failed `npm` invocation, with its `stderr` / `exitCode` / `args`), and its `operation` union grew `publishTarball`, `publishIdempotent`, and `dryRun` to match the redesigned service. The `message` getter (see below) reads `cause` to append the command output.

## Bug Fixes

### `GitTag` resolves annotated tags to commit SHAs

`GitTag.list` switched from `git.listMatchingRefs` to `repos.listTags` to surface annotated tags consistently. `GitTag.resolve` now peels through annotated-tag indirections up to `MAX_TAG_PEEL` hops; exhausting the peel loop yields a typed `GitTagError` instead of returning a tag-object SHA where a commit SHA was expected.

### Stderr-tail truncation in error messages

`CommandRunnerError.message` and `PackagePublishError.message` now show the LAST 2000 characters of stderr when truncated, with a `...[N chars truncated from head]...` marker. The prior head-truncation hid the actual `npm error` lines (which sit at the END of stderr after the warnings and notice block) behind the noise. `CommandRunnerError` also gained an optional `stdout` field — populated on non-zero exit — so the formatter can fall back to stdout when stderr is empty (some CLIs route error context there).

### `NpmRegistryError.message` and `PackagePublishError.message` getters

`Data.TaggedError` does not synthesise a `message` getter from its fields. Without it, callers that caught these errors into a generic `{ error: e.message }` shape saw empty strings — the publish orchestrator's "integrity probe failed" line read "failed —" with nothing after the dash. Both classes now produce a useful `[<operation>] <pkg-or-cmd>: <reason>` message string.

### `PackagePublish.dryRun` parses both npm output shapes

`npm publish --dry-run --json` emits a single JSON object; the prior `dryRun` implementation parsed only the array form. Now tolerates both, so dry-run packed/unpacked sizes and file counts populate correctly.

### Octokit deprecation-warning suppression

The `@octokit/plugin-request-log` plugin emits a `POST /repos/... - 422 ...` line to stdout on every non-2xx HTTP response, bypassing the Effect logger. A custom `log` object on the Octokit constructor now routes these through `WorkflowCommand.issue("debug", ...)`, so idempotent-recovery 422s (existing tag, existing release) no longer leak past `Step.withStep`'s buffer. The structured `GitHubClientError` still carries the full context on real failures.

The newer `predicate_type` query parameter on `GET /repos/.../attestations/{digest}` is deprecated as of 2026-03-10 (removal 2028-03-10). `Attest.listForSubject` no longer sends it — the library already re-filters client-side on the parsed in-toto `predicateType` for an authoritative match, so the server-side query was redundant.

## Maintenance

### New runtime dependencies for the attestation stack

The attestation toolchain adds three direct dependencies: `@sigstore/sign` and `@sigstore/bundle` (Sigstore DSSE bundle construction, used by `SigstoreSigner`) and `@cyclonedx/cyclonedx-library` (CycloneDX BOM model + JSON serialization, used by `Sbom`). All are pure-ESM and carry no `@actions/*` transitive dependencies, preserving the zero-CJS posture.

### `Action.run` and test-runtime cast adjustments

Pre-existing `tsgo` strict-mode errors at the `Effect.runPromise` seam are pinned with explicit `as Effect.Effect<A, E, never>` casts at the run boundary. The casts are safe because `ActionsRuntime.Default` resolves every transitive context requirement; the casts are needed because `tsgo` does not always narrow `Effect.provide`'s requires-channel to `never` through layer composition.
