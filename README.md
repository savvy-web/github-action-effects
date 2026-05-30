> [!WARNING]
> This package is still actively maintained, but this repo has been archived. Development has been moved to the [savvy-web/systems](https://github.com/savvy-web/systems/tree/main/packages/github-action-effects) monorepo.

# @savvy-web/github-action-effects

[![npm](https://img.shields.io/npm/v/@savvy-web%2Fgithub-action-effects?label=npm&color=cb3837)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-5fa04e.svg)](https://nodejs.org/)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

[Effect](https://effect.website) services for building GitHub Actions. You get schema-validated inputs, structured logging that maps to workflow commands and typed wrappers around the GitHub API, with no `@actions/*` packages anywhere in the dependency tree.

## Features

- **Zero CJS dependencies** — native ESM implementations of the GitHub Actions runtime protocol replace all `@actions/*` packages
- **37 composable services** — action I/O, GitHub API calls, git operations, package publishing and software attestation, each with its own `Context.Tag`
- **Schema-validated inputs** — read action inputs via Effect's `Config` API with built-in parsing and defaults
- **Structured logging** — Effect Logger maps to workflow commands with collapsible groups; buffered verbose output flushes inside its group when a step fails
- **Step-buffered execution** — `Step.withStep` buffers debug output per logical step, emits one success line on pass and spills the full buffer prefixed with the step name on failure
- **Software attestation** — sign and upload SLSA provenance and CycloneDX SBOMs to GitHub's attestation store via the `Attest`, `SigstoreSigner`, `OidcTokenIssuer` and `Sbom` services
- **In-memory test layers** — every service ships a test layer for fast, deterministic unit tests

## Install

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
```

## Quick start

```typescript
// src/main.ts
import { Config, Effect } from "effect";
import { Action, ActionOutputs } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const name = yield* Config.string("package-name");
  const outputs = yield* ActionOutputs;
  yield* outputs.set("result", `checked ${name}`);
});

Action.run(program);
```

`Action.run` provides `ActionsRuntime.Default` (ConfigProvider, Logger, core services, and Node.js platform layers), catches errors, and sets the workflow exit status automatically.

## GitHub API clients

`GitHubClientLive` builds a `GitHubClient` layer one of three ways:

- `GitHubClientLive.fromEnv()` — reads the ambient `process.env.GITHUB_TOKEN`, the repo-scoped workflow token. It is a function; call it with no arguments.
- `GitHubClientLive.fromToken(token)` — an explicit token with no `process.env` dependency. The token is a `Redacted<string>` — wrap a bare string with `Redacted.make(...)`.
- `GitHubClientLive.fromApp({ clientId, privateKey, installationId? })` — mints an installation token from GitHub App credentials, with `privateKey` as a `Redacted<string>`. It is a scoped layer that revokes the token on scope close and requires `HttpClient.HttpClient`; wrap a bare `Effect.provide` in `Effect.scoped`.

```typescript
import { Effect } from "effect";
import { Action, GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const client = yield* GitHubClient;
  const { owner, repo } = yield* client.repo;
  return yield* client.rest("issues.list", (octokit) =>
    octokit.rest.issues.listForRepo({ owner, repo }),
  );
}).pipe(Effect.provide(GitHubClientLive.fromEnv()));

Action.run(program);
```

The repo-scoped token is often too weak for permission-sensitive work. When that happens, pass `fromToken` a token you constructed yourself, or use `fromApp` to act as a GitHub App installation.

## GitHub App token lifecycle

A GitHub Action runs in three phases — `pre`, `main` and `post`. The `GitHubToken` namespace generates one installation token in `pre`, hands `main` a client built from it and revokes it in `post`.

`GitHubToken.provision` and `GitHubToken.dispose` require a `GitHubApp` layer. In production, compose `GitHubAppLive` with `OctokitAuthAppLive` and provide the result to those effects.

```typescript
// pre.ts — generate and persist the installation token
import { Effect, Layer } from "effect";
import { Action, GitHubAppLive, GitHubToken, OctokitAuthAppLive } from "@savvy-web/github-action-effects";

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive);

Action.run(
  GitHubToken.provision({
    permissions: { contents: "write", pull_requests: "write" },
  }).pipe(Effect.provide(appLayer)),
);
```

```typescript
// main.ts — build a GitHubClient from the persisted token
import { Effect } from "effect";
import { Action, GitHubClient, GitHubToken } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const client = yield* GitHubClient;
  const { owner, repo } = yield* client.repo;
  return yield* client.rest("repos.get", (octokit) =>
    octokit.rest.repos.get({ owner, repo }),
  );
}).pipe(Effect.provide(GitHubToken.client()));

Action.run(program);
```

```typescript
// post.ts — revoke the token
import { Effect, Layer } from "effect";
import { Action, GitHubAppLive, GitHubToken, OctokitAuthAppLive } from "@savvy-web/github-action-effects";

const appLayer = Layer.provide(GitHubAppLive, OctokitAuthAppLive);

Action.run(GitHubToken.dispose().pipe(Effect.provide(appLayer)));
```

`provision` reads App credentials from its options object or, by default, from the `app-client-id` and `app-private-key` action inputs. Passing `permissions` verifies the generated token grants those scopes before it is persisted. It also resolves the App's public identity (slug, bot user ID, name) best-effort and stores it on the token, so later phases can call `GitHubToken.botIdentity()` without an extra API call.

Two additional accessors are available in any phase after `provision`:

- `GitHubToken.read()` — an `Effect<InstallationToken, ActionStateError, ActionState>` that reads the full persisted token envelope, including the optional `appSlug`, `appUserId` and `appName` fields resolved during `provision`.
- `GitHubToken.botIdentity()` — an `Effect<BotIdentity, ActionStateError, ActionState>` that derives a commit-attribution identity from the persisted token. When the App's slug and user ID were resolved, the returned email uses the `<userId>+<slug>[bot]@users.noreply.github.com` format that GitHub recognises for verified attribution; otherwise it falls back to the well-known `github-actions[bot]` identity.

## Documentation

- [Building a GitHub Action with Effect](./docs/01-example-action.md) — An end-to-end walkthrough: validated inputs, logging, a step summary and typed outputs.
- [Advanced action: three-stage app](./docs/02-advanced-action.md) — A complete pre/main/post action with GitHub App auth, cross-phase state and buffered logging.
- [Services guide](./docs/03-services.md) — A usage example for every service in the library.
- [Common patterns](./docs/04-patterns.md) — Dry-run mode, error accumulation, permission checks and workspace detection.
- [Building a robust action](./docs/05-best-practices.md) — Principles and pointers: wiring, the pre/main/post pattern, dry runs, permission checks, idempotency and secret handling.
- [Coming from `@actions/*`](./docs/06-toolkit-parity.md) — The migration map from each `@actions/*` package to its native ESM replacement.
- [Logging and error handling](./docs/07-logging-and-error-handling.md) — The log-level model, groups, buffered output, annotations, secret masking and the error-handling boundary.
- [Resilient GitHub API calls](./docs/08-resilient-github-api.md) — Default-on retry, `ResilienceOptions`, the `RateLimiter` service and streaming pagination.
- [Step-buffered logging patterns](./docs/09-step-logging.md) — Quiet-on-success, verbose-on-failure step logging with `withStep`, `collapse` and `groupStep`.
- [Generating SLSA attestations](./docs/10-slsa-attestations.md) — Provenance and SBOM attestations, the layer stack and idempotent recovery.
- [Publishing packages with the publish chain](./docs/11-publishing.md) — Pack, probe and publish a tarball, plus registry classification.
- [Peer dependencies](./docs/12-peer-dependencies.md) — Which packages to install and why.
- [Error handling](./docs/13-error-handling.md) — Tagged errors, `Action.formatCause` and the `[Tag] message` format.
- [Architecture](./docs/14-architecture.md) — The runtime layer, layer composition and the logging pipeline.
- [Filesystem I/O](./docs/15-filesystem-io.md) — `IoUtil` (`which`/`findInPath`) and the `cp`/`mv`/`rmRF`/`mkdirP` → `FileSystem` recipe.
- [Testing GitHub Actions](./docs/16-testing.md) — How to test an action with in-memory test layers.

## License

[MIT](LICENSE)
