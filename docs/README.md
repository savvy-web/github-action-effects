# github-action-effects documentation

An Effect library for building GitHub Actions. It covers structured logging, typed outputs, GitHub API calls, package publishing and software attestation, and every service ships a test layer. None of it depends on `@actions/*`: the GitHub Actions runtime protocol is reimplemented in native ESM.

## Install

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
# or
pnpm add @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
```

## Pages

- [Building a GitHub Action with Effect](./01-example-action.md) — An end-to-end walkthrough of one complete action.
- [Advanced action: three-stage app](./02-advanced-action.md) — A complete pre/main/post action with GitHub App auth, cross-phase state and buffered logging.
- [Services guide](./03-services.md) — A usage example for every service in the library.
- [Common patterns](./04-patterns.md) — Dry-run mode, error accumulation, permission checks and workspace detection.
- [Building a robust action](./05-best-practices.md) — Principles and pointers: wiring, the pre/main/post pattern, dry runs, permission checks, idempotency and secret handling.
- [Coming from `@actions/*`](./06-toolkit-parity.md) — The migration map from each `@actions/*` package to its native ESM replacement.
- [Logging and error handling](./07-logging-and-error-handling.md) — The log-level model, groups, buffered output, annotations, secret masking and the error-handling boundary.
- [Resilient GitHub API calls](./08-resilient-github-api.md) — Default-on retry, `ResilienceOptions`, the `RateLimiter` service and streaming pagination.
- [Step-buffered logging patterns](./09-step-logging.md) — Quiet-on-success, verbose-on-failure step logging with `withStep`, `collapse` and `groupStep`.
- [Generating SLSA attestations](./10-slsa-attestations.md) — Provenance and SBOM attestations, the layer stack and idempotent recovery.
- [Publishing packages with the publish chain](./11-publishing.md) — Pack, probe and publish a tarball, plus registry classification.
- [Peer dependencies](./12-peer-dependencies.md) — Which packages to install and why.
- [Error handling](./13-error-handling.md) — `Action.formatCause`, `Action.run` error handling and the `[Tag] message` format.
- [Architecture](./14-architecture.md) — The runtime layer, layer composition and the logging pipeline.
- [Filesystem I/O](./15-filesystem-io.md) — `IoUtil` (`which`/`findInPath`) and the `cp`/`mv`/`rmRF`/`mkdirP` → `FileSystem` recipe.
- [Testing GitHub Actions](./16-testing.md) — How to test an action with in-memory test layers.

## How inputs work

Inputs come through Effect's `Config` API. `ActionsConfigProvider` backs it, reading the `INPUT_*` environment variables GitHub sets for each declared input:

```typescript
import { Config, Effect } from "effect"

const program = Effect.gen(function* () {
  const name = yield* Config.string("package-name")  // reads INPUT_PACKAGE-NAME
  const count = yield* Config.integer("count")        // reads INPUT_COUNT
  const debug = yield* Config.boolean("debug").pipe(Config.withDefault(false))
})
```

## Services

### Core services (provided by ActionsRuntime.Default / Action.run)

| Service | Purpose |
| --- | --- |
| ActionLogger | Collapsible log groups (group), buffer-on-failure logging (withBuffer) and `::notice::` annotations (notice) |
| ActionOutputs | Typed outputs (set, setJson, summary, exportVariable, addPath, setFailed, setSecret) |
| ActionState | Schema-serialized state for multi-phase actions (save, get, getOptional) |
| ActionEnvironment | Typed access to `GITHUB_*` and `RUNNER_*` env vars, plus the parsed webhook payload (`payload`, `repo`, `issue`, `isDebug`) |

### Extended services (provide via additional layers)

| Service | Purpose |
| --- | --- |
| ActionCache | Save/restore with withCache bracket pattern |
| Artifact | Upload, list, download and delete GitHub Actions artifacts (`@actions/artifact` v2 parity) |
| Glob | Resolve glob patterns and compute `@actions/glob`-compatible file hashes |
| GitHubClient | Octokit REST/GraphQL with eager (`paginate`) and streaming (`paginateStream`) pagination (uses @octokit/rest directly) |
| GitHubGraphQL | Typed GraphQL queries and mutations |
| GitHubRelease | Create, update and list releases and assets |
| GitHubIssue | List, close, comment and get issues |
| GitHubContent | Read repository file contents at a ref |
| GitHubCommit | Read the commit graph (get, list, compare) |
| GitHubArtifactMetadata | Create GitHub Packages artifact-metadata storage records |
| GitHubApp | GitHub App token lifecycle with bracket pattern |
| CheckRun | Create, update and complete check runs with annotations |
| PullRequest | PR lifecycle: get, list, create, update, merge, listFiles, baseSha, labels, reviewers |
| PullRequestComment | Sticky (upsert) PR comments with marker keys |
| GitTag | CRUD for tags via Git Data API |
| GitBranch | CRUD for branches via Git Data API |
| GitCommit | Create trees, commits, update refs (supports file deletions via `sha: null`) |
| CommandRunner | Structured shell execution with capture and JSON parsing |
| ConfigLoader | Load and validate JSON, JSONC, YAML config files |
| DryRun | Mutation guard with fallback values |
| NpmRegistry | Query npm for versions, dist-tags, package info and per-registry version probes |
| PackagePublish | Pack and publish to registries; supports `dryRun`, `publishIdempotent` and `publishTarball` |
| PackageManagerAdapter | Auto-detect and use npm/pnpm/yarn/bun/deno |
| WorkspaceDetector | Detect monorepo type and list packages |
| ChangesetAnalyzer | Parse and generate changeset files |
| TokenPermissionChecker | Check and assert GitHub token permissions |
| RateLimiter | Rate limit guard with exponential backoff |
| WorkflowDispatch | Trigger workflows and poll until completion |
| ToolInstaller | Download, extract and cache tool binaries (archives and standalone binaries) |
| Attest | Sign and upload SLSA provenance and SBOM attestations to GitHub's attestation store |
| OidcTokenIssuer | Request a GitHub Actions OIDC token for use with Sigstore |
| SigstoreSigner | Sign an in-toto statement into a Sigstore bundle |
| Sbom | Generate and serialize CycloneDX 1.5 software bills of materials |

## Namespace objects

| Namespace | Purpose |
| --- | --- |
| `Action` | Top-level helpers: `run`, `formatCause`, `resolveLogLevel` |
| `Step` | Step-buffered execution: `withStep`, `success`, `collapse`, `groupStep` |
| `GitHubToken` | GitHub App installation-token lifecycle: `provision`, `client`, `read`, `botIdentity`, `dispose` |
| `GitHubClientLive` | `GitHubClient` layer constructors: `fromEnv`, `fromToken`, `fromApp` |
| `ActionInput` | GitHub-faithful `Config` input combinators: `boolean` (YAML 1.2 Core Schema), `multiline` |
| `GithubMarkdown` | Pure GFM builder functions: `table`, `heading`, `bold`, `details`, `checklist`, `image`, `quote`, etc. |
| `PathUtils` | Path-separator normalizers: `toPosixPath`, `toWin32Path`, `toPlatformPath` |
| `AutoMerge` | Enable/disable PR auto-merge via GraphQL |
| `SemverResolver` | Semver comparison, range satisfaction, increment, parse |
| `ErrorAccumulator` | Process items collecting all successes and failures |
| `ReportBuilder` | Fluent builder for markdown reports |
| `RegistryClassifier` | Classify a registry URL as npm, GitHub Packages, a private registry or unknown |
| `IoUtil` | Locate a binary on `PATH`: `which`, `whichOrFail`, `findInPath` |

## See also

See the [project README](../README.md) for a quick-start example.

For build tooling and the action runner, see the companion package `@savvy-web/github-action-builder`.
