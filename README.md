# @savvy-web/github-action-effects

[![npm](https://img.shields.io/npm/v/@savvy-web%2Fgithub-action-effects?label=npm&color=cb3837)](https://www.npmjs.com/package/@savvy-web/github-action-effects)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org/)

Composable [Effect](https://effect.website) services for building GitHub Actions with schema-validated inputs, structured logging, and GitHub API operations -- zero `@actions/*` dependencies.

## Features

- **Zero CJS dependencies** -- native ESM implementations of the GitHub Actions runtime protocol replace all `@actions/*` packages
- **29 composable services** -- action I/O, GitHub API, git operations, package publishing, and more
- **Schema-validated inputs** -- read action inputs via Effect's `Config` API with built-in parsing and defaults
- **Structured logging** -- Effect Logger maps to workflow commands with collapsible groups; buffered verbose output flushes inside its group when a step fails
- **In-memory test layers** -- every service ships a test layer for fast, deterministic unit tests

## Install

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
# or
pnpm add @savvy-web/github-action-effects effect @effect/platform @effect/platform-node
```

## Quick start

```typescript
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

For permission-sensitive work the repo-scoped token is often too weak. Use `fromToken` with a token you constructed, or `fromApp` to act as a GitHub App installation.

## GitHub App token lifecycle

A GitHub Action runs in three phases — `pre`, `main` and `post`. The `GitHubToken` namespace generates one installation token in `pre`, hands `main` a client built from it and revokes it in `post`.

```typescript
// pre.ts — generate and persist the installation token
import { Action, GitHubToken } from "@savvy-web/github-action-effects";

Action.run(
  GitHubToken.provision({
    permissions: { contents: "write", pull_requests: "write" },
  }),
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
import { Action, GitHubToken } from "@savvy-web/github-action-effects";

Action.run(GitHubToken.dispose());
```

`provision` reads App credentials from its options object or, by default, from the `app-client-id` and `app-private-key` action inputs. Passing `permissions` verifies the generated token grants those scopes before it is persisted.

## Documentation

For service reference, architecture, testing guides, and advanced usage, see [docs/](./docs/).

## License

[MIT](LICENSE)
