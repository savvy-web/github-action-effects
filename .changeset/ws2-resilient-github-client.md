---
"@savvy-web/github-action-effects": major
---

## Breaking changes

### `GitHubClientLive.fromApp` now requires a `Scope`

`fromApp` builds as a scoped layer so it can revoke its installation token on
scope close. Consumers on `ActionsRuntime.Default` / `Action.run` are unaffected
(the run boundary establishes and finalizes the scope automatically). Consumers
who provide `fromApp` via a bare `Effect.provide` must now wrap in
`Effect.scoped`. Part of the 2.0 release.

### `GitHubClientLive.fromEnv` is now a constructor function

`fromEnv` changed from a bare `Layer` value to a function
`(resilience?: ResilienceOptions) => Layer` so it can accept resilience tuning,
matching `fromToken` and `fromApp`. Call it as `GitHubClientLive.fromEnv()`
(or `GitHubClientLive.fromEnv({ enabled: false })` for bare behavior).

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

## Bug Fixes

### `RateLimiter` no longer probes `GET /rate_limit` on every guarded call

`withRateLimit` previously issued a pre-flight `GET /rate_limit` before every
guarded effect, wasting a request and quota per call. It now reads the
`x-ratelimit-*` headers observed on real responses (cached in a shared `Ref`
via an internal `RateLimitState`) and only waits or fails when the cached
remaining quota is below the 10 percent threshold. `checkRest` and `checkGraphQL`
are cache-first and probe only on a cache miss. Strictly fewer requests,
identical wait/fail policy. To share the observed snapshot between the client
and the rate limiter, provide `RateLimitState.Default` once at the graph root;
without it each falls back to a private cache (still probe-free).

### `fromApp` revokes its installation token on scope close

`GitHubClientLive.fromApp` now builds as a scoped layer and revokes the minted
installation token when its scope closes, instead of leaving short-lived tokens
to expire. A `Layer.memoize` recipe is documented on `fromApp` for sharing one
App client (and one token) across multiple provides in a single run.
