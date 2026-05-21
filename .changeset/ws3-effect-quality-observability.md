---
"@savvy-web/github-action-effects": major
---

## Breaking Changes

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

## Refactoring

### Sigstore bundle serialized via `Schema.encode`

`AttestLive` now serializes the Sigstore bundle with `Schema.encode` instead of a
`JSON.parse(JSON.stringify(...))` round-trip.
