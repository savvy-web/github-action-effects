# @savvy-web/github-action-effects

[![npm](https://img.shields.io/npm/v/@savvy-web%2Fgithub-action-effects?label=npm&color=cb3837)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-5fa04e.svg)](https://nodejs.org/)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

[Effect](https://effect.website) services for building GitHub Actions. You get schema-validated inputs, structured logging that maps to workflow commands and typed wrappers around the GitHub API, with no `@actions/*` packages anywhere in the dependency tree.

## Features

- **Zero CJS dependencies** — native ESM implementations of the GitHub Actions runtime protocol replace all `@actions/*` packages
- **29 composable services** — action I/O, GitHub API calls, git operations and package publishing, each with its own `Context.Tag`
- **Schema-validated inputs** — read action inputs via Effect's `Config` API with built-in parsing and defaults
- **Structured logging** — Effect Logger maps to workflow commands with collapsible groups; buffered verbose output flushes inside its group when a step fails
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

- `GitHubClientLive.fromEnv` — reads the ambient `process.env.GITHUB_TOKEN`, the repo-scoped workflow token.
- `GitHubClientLive.fromToken(token)` — an explicit token, plain `string` or `Redacted`, with no `process.env` dependency.
- `GitHubClientLive.fromApp({ clientId, privateKey, installationId? })` — generates a fresh installation token from GitHub App credentials.

```typescript
import { Effect } from "effect";
import { Action, GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const client = yield* GitHubClient;
  const { owner, repo } = yield* client.repo;
  return yield* client.rest("issues.list", (octokit) =>
    octokit.rest.issues.listForRepo({ owner, repo }),
  );
}).pipe(Effect.provide(GitHubClientLive.fromEnv));

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

`provision` reads App credentials from its options object or, by default, from the `app-client-id` and `app-private-key` action inputs. Passing `permissions` verifies the generated token grants those scopes before it is persisted.

## Documentation

- [Building a GitHub Action with Effect](./docs/01-example-action.md) — An end-to-end walkthrough: validated inputs, logging, a step summary and typed outputs.
- [Advanced action: three-stage app](./docs/02-advanced-action.md) — A complete pre/main/post action with GitHub App auth, cross-phase state and buffered logging.
- [Services guide](./docs/03-services.md) — A usage example for every service in the library.
- [Common patterns](./docs/04-patterns.md) — Dry-run mode, error accumulation, permission checks and workspace detection.
- [Peer dependencies](./docs/05-peer-dependencies.md) — Which packages to install and why.
- [Error handling](./docs/06-error-handling.md) — Tagged errors, `Action.formatCause` and the `[Tag] message` format.
- [Architecture](./docs/07-architecture.md) — The runtime layer, layer composition and the logging pipeline.
- [Testing GitHub Actions](./docs/08-testing.md) — How to test an action with in-memory test layers.

## License

[MIT](LICENSE)
