---
"@savvy-web/github-action-effects": major
---

## Breaking Changes

### `GitHubClientLive.fromApp` now requires a `Scope`

`fromApp` builds as a scoped layer so it can revoke its installation token on
scope close. Consumers on `ActionsRuntime.Default` / `Action.run` are unaffected
(the run boundary establishes and finalizes the scope automatically). Consumers
who provide `fromApp` via a bare `Effect.provide` must now wrap in
`Effect.scoped`.

### `GitHubClientLive.fromEnv` is now a constructor function

`fromEnv` changed from a bare `Layer` value to a function
`(resilience?: ResilienceOptions) => Layer` so it can accept resilience tuning,
matching `fromToken` and `fromApp`. Call it as `GitHubClientLive.fromEnv()`
(or `GitHubClientLive.fromEnv({ enabled: false })` for bare behavior).

### Secrets are now `Redacted` by default

Public method signatures that take a token or private key now accept
`Redacted<string>` instead of `string`: `GitHubApp.generateToken` /
`resolveAppIdentity` / `revokeToken` / `withToken`,
`GitHubClientLive.fromToken(token)` / `fromApp({ privateKey })`, and
`PackagePublish.setupAuth(registry, token)` / `RegistryTarget.token`. Wrap bare
strings with `Redacted.make(...)` at the call site. The persisted
`InstallationToken.token` field is now `Redacted<string>` (decoded type) — read
it with `Redacted.value(...)`. The encoded `GITHUB_STATE` bytes are unchanged.

### `GitHubAppLive` and `ActionCacheLive` require `HttpClient.HttpClient`

The raw-`fetch` migration adds an `HttpClient.HttpClient` requirement to both
layers. The `Action.run` / `ActionsRuntime.Default` path provides it
automatically (it now bundles `FetchHttpClient.layer`). Consumers that compose
layers manually must add `FetchHttpClient.layer` (from `@effect/platform`).

## Features

### Resilient `GitHubClient` — automatic retry and rate-limit awareness

Every `GitHubClient` call (`rest`, `graphql`, `paginate`, and the new
`paginateStream`) now retries retryable failures (429 and 5xx) automatically
with an exponential, jittered, capped backoff, and honors server-advised delays
from the `Retry-After` and `x-ratelimit-reset` response headers. Resilience is
on by default; every `GitHubClientLive` constructor (`fromEnv`, `fromToken`,
`fromApp`) accepts an optional `ResilienceOptions` argument to tune
`maxRetries` / `baseDelay` / `maxDelay` or disable retries entirely. The pure
`resilienceSchedule` builder is exported for reuse. All 14 `GitHubClient`-backed
services inherit this with no code change. `GitHubClientError` gained an optional
`retryAfterMs` field carrying the server-advised delay.

### Streaming pagination — `GitHubClient.paginateStream`

A new `paginateStream` method returns an Effect `Stream` that fetches one page at
a time, so consumers can `takeWhile` / `take` and stop early without buffering or
fetching the remaining pages. The eager `paginate` is unchanged and agrees with
`paginateStream` on page boundaries.

### Resource safety

`CommandRunner` and `ToolInstaller` now register interruption finalizers on their
async spawns, so a `timeout` / `race` / interrupt no longer leaks child processes
or download sockets.

### Secret hardening

Every token / private key stays `Redacted` end-to-end, unwrapped only at the wire
boundary; the npm auth token is no longer passed as a command argument (it is
written to `.npmrc` directly) and `CommandRunnerError` scrubs known auth-token
args, closing the error-message leak; the generated installation token is masked
via `setSecret`.

### HTTP seam

`GitHubAppLive` and `ActionCacheLive` use `@effect/platform` `HttpClient` instead
of raw `fetch` — interruption-aware and testable.

### Observability (opt-in)

GitHub API calls, command executions, and rate-limit events now emit
`Effect.withSpan` traces and `Metric` counters. Inert unless an OpenTelemetry /
metrics layer is provided.

### New `Artifact` service (`@actions/artifact` v2 parity)

- `uploadArtifact(name, files, rootDirectory, options?)` zips the file set and
  uploads it via the GitHub Actions results backend (Twirp
  `github.actions.results.api.v1.ArtifactService` + Azure Block Blob), returning
  `{ id, size }`. `listArtifacts`, `getArtifact` (-> `Option`), `downloadArtifact`
  (signed-URL download + unzip) and `deleteArtifact` complete the surface. A
  `findBy` option is reserved for cross-run/cross-repo reads through the public
  REST API (`actions:read`); that path is not yet implemented and fails clearly.
- Reads `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN` (set on GitHub-hosted
  runners), decoding the run/job backend IDs from the runtime token's `scp`
  claim. v2 rejects re-uploading the same artifact name in a run, surfaced as a
  typed error. New `ArtifactError` (with a `retryable` flag) and `ArtifactTest`
  in-memory layer. No dependency on `@actions/artifact`; zip/unzip shells out to
  `zip`/`unzip` with a Windows PowerShell fallback.
- The Twirp plumbing (`twirpCall`, the `CONFLICT` sentinel and the retry
  schedule) is now shared between the cache and artifact layers; no behavior
  change to `ActionCache`.

> The artifact backend is an internal GitHub protocol reverse-engineered from
> `actions/toolkit` and may change without notice; the implementation mirrors
> the already-shipped V2 cache layer. This ships as a draft pending end-to-end
> validation against a live GitHub-hosted runner.

### New `Glob` service + `hashFiles` (`@actions/glob` parity)

- `Glob.glob(patterns, options?)` resolves newline/comma-separated glob patterns
  (`*`, `?`, `[...]`, `**`, `!` excludes, `~` expansion) to a sorted array of
  absolute paths. `GlobLive` wraps `node:fs.globSync`; `GlobTest` is an in-memory
  namespace layer (`empty`/`layer`).
- `Glob.hashFiles(patterns, options?)` computes the `@actions/glob`-compatible
  SHA-256 hash-of-hashes over matched files (per-file SHA-256 binary digests fed,
  in glob order, into one accumulating SHA-256), so keys interoperate with
  `ActionCache`. Files outside the workspace root are skipped. Returns
  `Option.none()` when nothing matches (the toolkit returns `""`; recover that
  verbatim with `Option.getOrElse(() => "")`).
- New `GlobError`. Internal path-resolution shared with `ActionCache` (refactor;
  no behavior change).

### New `IoUtil` namespace (`@actions/io` `which`/`findInPath` parity)

- `IoUtil.which(tool)` returns `Option.some(absolutePath)` for the first
  executable match on `PATH`, `Option.none()` on miss; `IoUtil.whichOrFail(tool)`
  fails with the new `IoError` instead. `IoUtil.findInPath(tool)` returns every
  match. Honors `PATHEXT` on Windows and POSIX execute-bit checks. Reads
  `FileSystem` from context (provided by `ActionsRuntime.Default`).
- `cp`/`mv`/`rmRF`/`mkdirP` are documented as direct `@effect/platform`
  `FileSystem` calls (a documented filesystem I/O recipe) rather than new
  wrappers, since `FileSystem` is already in context everywhere.

### Toolkit parity — context, inputs, and core conveniences

- `ActionInput.boolean` / `ActionInput.multiline`: GitHub-faithful input `Config`
  combinators. `boolean` follows the YAML 1.2 "Core Schema" exactly
  (`true|True|TRUE` / `false|False|FALSE`), failing on anything else — unlike
  `Config.boolean`, which silently accepts `yes`/`on`/`1`/`no`/`off`/`0`.
- `ActionEnvironment.payload`: parses `GITHUB_EVENT_PATH` into a schema-validated
  `WebhookPayload` (tolerant of unknown keys; empty when unset/missing).
  `ActionEnvironment.repo` / `.issue` mirror `@actions/github` `context.repo` /
  `context.issue`; `ActionEnvironment.isDebug` mirrors `core.isDebug()`.
- `WorkflowCommand.notice` + `ActionLogger.notice` for `::notice::` annotations,
  with an `AnnotationProperties` → command-properties mapper matching the toolkit.
- `WorkflowCommand.stopCommands` / `resumeCommands` / `setCommandEcho` for
  untrusted-output handling.
- `GithubMarkdown.image` / `GithubMarkdown.quote` (exact `@actions/core` summary
  HTML).
- `PathUtils.toPosixPath` / `toWin32Path` / `toPlatformPath`.
- `OidcTokenIssuer.getToken(audience?)` — `audience` is now optional, matching
  `core.getIDToken(audience?)` for cloud-provider OIDC federation. Backward
  compatible; Sigstore callers are unaffected.

## Bug Fixes

### `RateLimiter` no longer probes `GET /rate_limit` on every guarded call

`withRateLimit` previously issued a pre-flight `GET /rate_limit` before every
guarded effect, wasting a request and quota per call. It now reads the
`x-ratelimit-*` headers observed on real responses (cached in a shared `Ref`
via an internal `RateLimitState`) and only waits or fails when the cached
remaining quota is below the 10 percent threshold. `checkRest` is cache-first
(the shared snapshot holds the core/REST bucket) and probes only on a cache
miss; `checkGraphQL` always probes, since REST and GraphQL have independent
quotas. Strictly fewer requests, identical wait/fail policy. To share the observed
snapshot between the client and the rate limiter, provide `RateLimitState.Default`
once at the graph root; without it each falls back to a private cache (still
probe-free).

### `fromApp` revokes its installation token on scope close

`GitHubClientLive.fromApp` now builds as a scoped layer and revokes the minted
installation token when its scope closes, instead of leaving short-lived tokens
to expire. A `Layer.memoize` recipe is documented on `fromApp` for sharing one
App client (and one token) across multiple provides in a single run.

## Refactoring

### Sigstore bundle serialized via `Schema.encode`

`AttestLive` now serializes the Sigstore bundle with `Schema.encode` instead of a
`JSON.parse(JSON.stringify(...))` round-trip.

## Documentation

Comprehensive documentation pass covering the 2.0 release surface.

**Accuracy against the final 2.0 API:** corrects stale descriptions throughout
`docs/` — `GitHubClientLive.fromEnv()` is now a function; `fromToken` takes a
`Redacted<string>`; `fromApp` is a scoped layer that revokes its token on scope
close and requires `HttpClient.HttpClient`. The "Upgrading to 2.0" migration note
and `@actions/*` substitution map are re-verified against the merged code.

**New services documented:** `Glob` (glob patterns + SHA-256 `hashFiles`),
`IoUtil` (`which`/`whichOrFail`/`findInPath`), `Artifact` (upload/list/get/
download/delete, with the "must run inside a JS action" env constraint),
`ActionInput` (YAML 1.2 Core Schema `boolean`, `multiline`), the typed event
payload (`ActionEnvironment.payload`, `repo`, `issue`, `isDebug` +
`WebhookPayload`), `PathUtils`, `ActionLogger.notice`, and the
`WorkflowCommand` notice/stop-commands/echo helpers.
`GitHubClient.paginateStream` and `GithubMarkdown.image`/`quote` are also
covered.

**Four new guides:** "Building a robust action" (best practices), "Coming from
`@actions/*`" (toolkit-parity walkthrough), "Logging and error handling", and
"Resilient GitHub API calls" (retry, rate-limit awareness, streaming pagination).

**Structure:** three existing guides (SLSA attestations, publishing, step-buffered
logging) were already present and are preserved; `docs/` is renumbered to a
contiguous 01-16 reading order with the new guides in the guides cluster.

## Maintenance

### Trim required peer dependencies to the three Effect packages actually used

`@effect/cluster`, `@effect/rpc`, and `@effect/sql` were declared as required
peers but are never imported anywhere in the library. They are now removed from
`peerDependencies` and `peerDependenciesMeta`. Consumers only need `effect`,
`@effect/platform`, and `@effect/platform-node`; the dropped packages still
resolve transitively through `@effect/platform-node` if any code path needs
them.

### CI now runs the full production build on every pull request

The shared `release-validate` reusable workflow now runs `ci:build` (rslib dev +
prod, api-extractor forgotten-export detection, and TSDoc validation) on PRs.
The previous PR checks ran lint and tests but not the production build, which is
how a forgotten barrel export / multi-line TSDoc code span shipped a broken
build in a prior release.
