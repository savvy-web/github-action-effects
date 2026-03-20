# Peer Dependencies

`@savvy-web/github-action-effects` uses peer dependencies so that consumers
can resolve a single copy of each package. This avoids version duplication
and ensures compatibility between your action code and the library.

## Zero @actions/* Dependencies

All `@actions/*` packages have been removed. The library implements the
GitHub Actions runtime protocol natively using:

- `WorkflowCommand` -- `::command::` protocol formatter
- `RuntimeFile` -- Environment file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
- `ActionsConfigProvider` -- ConfigProvider reading `INPUT_*` env vars
- `ActionsLogger` -- Effect Logger emitting workflow commands

GitHub API operations use `@octokit/rest` directly (a regular dependency,
not a peer).

## Required Peers

These must be installed for the library to function:

| Package | Purpose |
| --- | --- |
| `effect` | Core dependency -- services, layers, schemas, errors, tracing |
| `@effect/platform` | `FileSystem`, `Path`, and platform abstractions |
| `@effect/platform-node` | Node.js platform implementation |
| `@effect/cluster` | Required peer of `@effect/platform-node` |
| `@effect/rpc` | Required peer of `@effect/platform-node` |
| `@effect/sql` | Required peer of `@effect/platform-node` |

The `@effect/cluster`, `@effect/rpc`, and `@effect/sql` packages are
transitive peers required by `@effect/platform-node`. They are not used
directly by your action code.

Install all required peers at once:

```bash
npm install effect @effect/platform @effect/platform-node @effect/cluster @effect/rpc @effect/sql
```

## Direct Dependencies (Not Peers)

These are regular dependencies bundled with the library:

| Package | Purpose |
| --- | --- |
| `@octokit/rest` | GitHub REST API client (GitHubClient) |
| `@octokit/auth-app` | GitHub App JWT authentication (GitHubApp) |
| `jsonc-effect` | JSONC config file support (ConfigLoader) |
| `yaml-effect` | YAML config file support (ConfigLoader) |
| `semver-effect` | Semver comparison and resolution (SemverResolver) |

## Typical Installation

```bash
npm install @savvy-web/github-action-effects effect @effect/platform @effect/platform-node @effect/cluster @effect/rpc @effect/sql
```

No optional peers are required -- the simplified architecture means all
services work with the base installation.
