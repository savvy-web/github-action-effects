# Resilient GitHub API calls

The GitHub API returns 429s under rate pressure, 403s with a retry hint under secondary rate limits and 5xxs when something on its side hiccups. An action that does not retry those will fail a run that a single retry would have saved. `GitHubClient` retries them for you — resilience is on by default on every call — and exposes the knobs to tune or disable it. This guide covers the default retry policy, the `ResilienceOptions` you pass per constructor, the `RateLimiter` service and the streaming pagination that lets a scan stop early.

## Retry is on by default

Every `GitHubClient` call — `rest`, `graphql`, `paginate`, `paginateStream` — runs through `withResilience`. On a retryable error it waits, then tries again, up to a bounded number of attempts. An error is retryable when the response status is `429`, is `>= 500`, or is a `403` that carries a server-advised retry signal — a `Retry-After` header, or `x-ratelimit-remaining: 0` plus an `x-ratelimit-reset` timestamp — which is how GitHub reports a secondary rate limit. A bare `403` with no such hint is a genuine permission failure and is not retried. The client sets the flag when it wraps the underlying error into a `GitHubClientError`. Non-retryable errors (a bare `403`, a `404`, a `422`, a malformed request) fail immediately — retrying them would only waste time.

You do not opt in. `GitHubClientLive.fromEnv()` already gives you the resilient client:

```typescript
import { Effect } from "effect"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
  // A transient 503 here is retried automatically before the effect fails.
  const data = yield* client.rest("repos.get", (octokit) =>
    (octokit as { rest: { repos: { get: (p: unknown) => Promise<{ data: { default_branch: string } }> } } }).rest.repos.get({ owner, repo }),
  )
  yield* Effect.log(`default branch: ${data.default_branch}`)
  // default branch: main   (whatever the repo's default is)
}).pipe(Effect.provide(GitHubClientLive.fromEnv()))
```

### How the backoff works

When the server tells the client how long to wait — a `Retry-After` header, or `x-ratelimit-remaining: 0` plus an `x-ratelimit-reset` timestamp — the client honors that delay exactly. The `GitHubClientError` carries it as `retryAfterMs`, and the server-advised value takes precedence over any computed backoff. When there is no server hint, the client falls back to an exponential, jittered, capped backoff: the delay doubles each attempt, is capped per interval, and a full-jitter randomizes it within `[0, capped]` to avoid a thundering herd of retries lining up on the same tick.

## Tuning resilience per constructor

Each `GitHubClientLive` constructor takes an optional `ResilienceOptions` as its last argument. Pass it to change the policy for that client:

```typescript
import { Duration } from "effect"
import { GitHubClientLive } from "@savvy-web/github-action-effects"

const layer = GitHubClientLive.fromEnv({
  maxRetries: 6,                    // default 4
  baseDelay: Duration.seconds(2),   // default 1s
  maxDelay: Duration.seconds(60),   // default 30s
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` runs each call once, no retry. |
| `maxRetries` | `4` | Maximum retry attempts for retryable errors. |
| `baseDelay` | `1s` | Base of the exponential schedule. |
| `maxDelay` | `30s` | Cap on any single backoff interval. |

The same `resilience` argument is accepted by `fromToken(token, resilience?)` and `fromApp(options, resilience?)`. To turn retry off entirely — for a test, or a call where you want failures to surface immediately — pass `{ enabled: false }`:

```typescript
import { Redacted } from "effect"
import { GitHubClientLive } from "@savvy-web/github-action-effects"

const bare = GitHubClientLive.fromToken(Redacted.make(token), { enabled: false })
```

## resilienceSchedule for standalone retries

The backoff schedule is exported as `resilienceSchedule(options?)` so you can apply the same policy to an effect of your own with `Effect.retry`. It builds an Effect `Schedule` that recurs only while the error is `retryable` and stops on the first non-retryable failure, bounded by `maxRetries`:

```typescript
import { Effect } from "effect"
import { resilienceSchedule } from "@savvy-web/github-action-effects"

const program = myGitHubClientCall.pipe(Effect.retry(resilienceSchedule({ maxRetries: 3 })))
```

Two differences from the built-in `withResilience` that wraps every client call are worth knowing. `resilienceSchedule` does not consult the server-advised `retryAfterMs` — it always uses its computed backoff — and it jitters multiplicatively rather than with the full-jitter the internal wrapper applies. Reach for `resilienceSchedule` when you want the same shape of policy on a non-client effect; rely on the built-in resilience when server-advised `Retry-After` / `x-ratelimit-reset` delays must be honored, which is the case for the client's own calls.

## RateLimiter: spend quota deliberately

Retry handles the call that already failed. `RateLimiter` keeps you from getting there: it guards a call when the remaining quota is nearly gone. It reads the `x-ratelimit-*` headers the client already saw on real responses (shared through `RateLimitState`), so it never burns a request on a pre-flight probe before each guarded call.

`withRateLimit(effect)` checks the cached quota. If the remaining requests are above 10% of the limit it runs the effect straight through. If they are at or below the threshold it waits until the reset — but only if the reset is within 60 seconds; a longer wait fails with `RateLimitError` instead of stalling the runner.

```typescript
import { Effect } from "effect"
import { RateLimiter, RateLimiterLive, GitHubClientLive } from "@savvy-web/github-action-effects"
import { Layer } from "effect"

const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter
  const data = yield* limiter.withRateLimit(someApiCall)
  return data
}).pipe(
  Effect.provide(Layer.provide(RateLimiterLive, GitHubClientLive.fromEnv())),
)
```

`RateLimiterLive` requires a `GitHubClient`, which is why it is provided beneath it above.

### checkRest vs checkGraphQL

The two check methods differ on purpose, because REST and GraphQL have independent quotas on the GitHub API and the shared snapshot only ever records the REST (core) bucket:

- `checkRest()` serves the cached snapshot when one exists and probes `GET /rate_limit` only on a cache miss. Cache-first — cheap to call repeatedly.
- `checkGraphQL()` always probes the `graphql` resource directly. Serving the cached core-bucket snapshot here would report the wrong quota, so it never does.

```typescript
import { Effect } from "effect"
import { RateLimiter } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter
  const rest = yield* limiter.checkRest()       // cached when available
  const graphql = yield* limiter.checkGraphQL() // always a fresh probe
  yield* Effect.log(`rest remaining: ${rest.remaining}, graphql remaining: ${graphql.remaining}`)
  // rest remaining: 4998, graphql remaining: 5000   (values vary per token and usage)
})
```

## Streaming pagination

`paginate` collects every page into one array — fine for a few pages, wasteful when you only need the first match in a long list. `paginateStream` yields one page's worth of items at a time as an Effect `Stream`, so you can `Stream.takeWhile` or `Stream.take` and stop without fetching or buffering the rest. Each page fetch is wrapped in the same resilience as a single call.

```typescript
import { Effect, Stream } from "effect"
import { GitHubClient } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo

  // Find the first open PR labeled "release" without paging the whole list.
  const first = yield* client
    .paginateStream<{ number: number; labels: Array<{ name: string }> }>(
      "pulls.list",
      (octokit, page, perPage) =>
        (octokit as { rest: { pulls: { list: (p: unknown) => Promise<{ data: Array<{ number: number; labels: Array<{ name: string }> }> }> } } }).rest.pulls.list({
          owner,
          repo,
          state: "open",
          per_page: perPage,
          page,
        }),
    )
    .pipe(
      Stream.filter((pr) => pr.labels.some((l) => l.name === "release")),
      Stream.take(1),
      Stream.runCollect,
    )
  yield* Effect.log(`first matching PR: ${first.length > 0 ? "found" : "none"}`)
  // first matching PR: found   (or "none" when no open PR carries the label)
})
```

Both `paginate` and `paginateStream` default to `perPage: 100` and accept `maxPages` to bound the scan. Prefer `paginateStream` for large or early-terminating scans; reach for `paginate` only when you genuinely need every page materialized at once. For the credential-source constructors behind these calls, see [building a GitHubClient layer](./14-architecture.md#building-a-githubclient-layer).
