# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

Effect-based utility library for building robust, well-logged, and
schema-validated GitHub Actions. Zero CJS dependencies — all `@actions/*`
packages replaced with native ESM implementations using Effect primitives
and the GitHub Actions runtime protocol.

## Design Documentation

**For architecture, service interfaces, and data flow:**
-> `@./.claude/design/github-action-effects/index.md`

Load when making architectural changes, adding new services, modifying layer
composition, or understanding design decisions.

**Do NOT load unless directly relevant to your task.**

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run typecheck         # Type-check all workspaces via Turbo
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with coverage report
```

### Building

```bash
pnpm run build             # Build all packages (dev + prod)
pnpm run build:dev         # Build development output only
pnpm run build:prod        # Build production/npm output only
```

### Running a Single Test

```bash
# Run a specific test file
pnpm vitest run src/services/ActionOutputs.test.ts
```

## Architecture

### Package Structure

- **Package Manager**: pnpm
- **Build**: Rslib with dual output (`dist/dev/` and `dist/npm/`)
- **Build Orchestration**: Turbo for caching and task dependencies
- **Core Dependency**: Effect-TS for service composition, error handling, and schema validation
- **Direct deps**: `@octokit/rest`, `@octokit/auth-app`, jsonc/semver/yaml-effect
- **Required peers**: `effect`, `@effect/platform`, `@effect/platform-node`

### Source Layout

```text
src/
  runtime/     -- ConfigProvider, Logger, WorkflowCommand, RuntimeFile, ActionsRuntime
  services/    -- Effect service interfaces (27 services)
  layers/      -- Live and Test layer implementations
  errors/      -- Tagged error types (Data.TaggedError)
  schemas/     -- Effect Schema definitions (LogLevel, Changeset, PackageManager, etc.)
  utils/       -- GithubMarkdown, ReportBuilder
```

### Runtime Layer

The `src/runtime/` directory contains the GitHub Actions runtime protocol
implementations that replace `@actions/core`, `@actions/exec`, etc.:

- `WorkflowCommand` — `::command::` protocol formatter with escaping
- `RuntimeFile` — Env file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
- `ActionsConfigProvider` — ConfigProvider reading INPUT_* env vars
- `ActionsLogger` — Effect Logger emitting workflow commands
- `ActionsRuntime.Default` — Single convenience Layer wiring everything

Consumer pattern:

```typescript
// Option A: Direct layer provision
program.pipe(Effect.provide(ActionsRuntime.Default))

// Option B: Action.run with error handling + buffering
Action.run(program)
```

Inputs use Effect's `Config` API:

```typescript
const name = yield* Config.string("name")      // reads INPUT_NAME
const count = yield* Config.integer("count")    // reads INPUT_COUNT
```

### Services

| Service | Purpose |
| ------- | ------- |
| ActionLogger | Log groups + buffered output |
| ActionOutputs | Typed outputs + step summaries |
| ActionState | Schema-validated state transfer between phases |
| ActionCache | Cache save/restore (internal protocol) |
| ActionEnvironment | GitHub/runner context access |
| DryRun | Mutation guard with fallback values |
| GitHubClient | Octokit REST/GraphQL wrapper (direct @octokit/rest) |
| GitHubGraphQL | Typed GraphQL query/mutation execution |
| GitHubApp | App authentication lifecycle |
| GitHubIssue | Issue CRUD (list, get, create, update, label) |
| GitHubRelease | Release + asset management |
| RateLimiter | API rate limit awareness + retry |
| CheckRun | Check runs + annotations |
| CommandRunner | Structured shell execution (node:child_process) |
| PullRequest | PR lifecycle (CRUD, merge, labels, reviewers) |
| PullRequestComment | PR comment management |
| WorkflowDispatch | Trigger + poll workflows |
| TokenPermissionChecker | Token permission validation + enforcement |
| ChangesetAnalyzer | Parse/generate changeset files |
| GitBranch | Branch management via Git Data API |
| GitCommit | Verified commits + file deletions via Git Data API |
| GitTag | Tag CRUD via Git Data API |
| ConfigLoader | JSON/JSONC/YAML config loading |
| ToolInstaller | Tool binary management (native fetch + child_process) |
| NpmRegistry | npm registry queries (versions, dist-tags, info) |
| PackagePublish | Pack + publish to registries |
| PackageManagerAdapter | Unified PM interface |
| WorkspaceDetector | Monorepo workspace detection + listing |

### Key Patterns

- Services use `class Foo extends Context.Tag("github-action-effects/Foo")<Foo, { ... }>() {}`
- Errors use `class FooError extends Data.TaggedError("FooError")<{ ... }> {}`
- Live layers use native APIs (no @actions/* wrappers)
- Test layers use namespace object pattern: `ActionLoggerTest.empty()` / `ActionLoggerTest.layer(state)`
- Inputs via `Config.*` backed by `ActionsConfigProvider`
- Logging via Effect `Logger` backed by `ActionsLogger`

### Code Quality

- **Biome**: Unified linting and formatting (replaces ESLint + Prettier)
- **Commitlint**: Enforces conventional commits with DCO signoff
- **Husky Hooks**:
  - `pre-commit`: Runs lint-staged
  - `commit-msg`: Validates commit message format
  - `pre-push`: Runs tests for affected packages

### TypeScript Configuration

- Composite builds with project references
- Strict mode enabled
- ES2022/ES2023 targets
- Import extensions required (`.js` for ESM)

### Testing

- **Framework**: Vitest with v8 coverage
- **Pool**: Uses forks (not threads) for Effect-TS compatibility
- **Coverage**: 80% threshold for lines, functions, statements, branches

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Separate type imports: `import type { Foo } from './bar.js'`
- No barrel exports in subdirectories; only `src/index.ts` re-exports

### Commits

All commits require:

1. Conventional commit format (feat, fix, chore, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to both GitHub Packages and npm with provenance.
