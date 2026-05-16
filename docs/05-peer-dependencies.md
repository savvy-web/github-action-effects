# Peer dependencies

`@savvy-web/github-action-effects` declares the Effect packages as peer dependencies. Your action and the library then share one copy of each — no duplicate `effect` in `node_modules`, no two layer registries that disagree about types.

## Zero @actions/* dependencies

The library carries no `@actions/*` packages. It speaks the GitHub Actions runtime protocol directly:

- `WorkflowCommand` — `::command::` protocol formatter
- `RuntimeFile` — environment file appender (GITHUB_OUTPUT, GITHUB_ENV and so on)
- `ActionsConfigProvider` — ConfigProvider reading `INPUT_*` env vars
- `ActionsLogger` — Effect Logger emitting workflow commands

GitHub API operations use `@octokit/rest` directly (a regular dependency, not a peer).

## Required peers

These must be installed for the library to function:

| Package | Purpose |
| --- | --- |
| `effect` | Core dependency — services, layers, schemas, errors, tracing |
| `@effect/platform` | `FileSystem`, `Path` and platform abstractions |
| `@effect/platform-node` | Node.js platform implementation |
| `@effect/cluster` | Required peer of `@effect/platform-node` |
| `@effect/rpc` | Required peer of `@effect/platform-node` |
| `@effect/sql` | Required peer of `@effect/platform-node` |

The `@effect/cluster`, `@effect/rpc` and `@effect/sql` packages are transitive peers required by `@effect/platform-node`. They are not used directly by your action code.

Install all required peers at once:

```bash
npm install effect @effect/platform @effect/platform-node @effect/cluster @effect/rpc @effect/sql
```

## Direct dependencies (not peers)

These are regular dependencies bundled with the library:

| Package | Purpose |
| --- | --- |
| `@octokit/rest` | GitHub REST API client (GitHubClient) |
| `@octokit/auth-app` | GitHub App JWT authentication (GitHubApp) |
| `@azure/storage-blob` | Azure Blob Storage uploads and downloads (ActionCache) |
| `jsonc-effect` | JSONC config file support (ConfigLoader) |
| `yaml-effect` | YAML config file support (ConfigLoader) |
| `semver-effect` | Semver comparison and resolution (SemverResolver) |

## Typical installation

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node @effect/cluster @effect/rpc @effect/sql
```

There are no optional peers. Every service works with the packages listed above.
