# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

Effect-based utility library for building robust, well-logged, and
schema-validated GitHub Actions. Provides 30 Effect services covering inputs,
logging, outputs, state, telemetry, GitHub API operations, git operations,
config loading, tool management, package manager abstraction, npm registry
queries, package publishing, workspace detection, PR lifecycle management,
and token permission checks.

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
pnpm vitest run src/services/ActionInputs.test.ts
```

## Architecture

### Package Structure

- **Package Manager**: pnpm
- **Build**: Rslib with dual output (`dist/dev/` and `dist/npm/`)
- **Build Orchestration**: Turbo for caching and task dependencies
- **Core Dependency**: Effect-TS for service composition, error handling, and schema validation

### Source Layout

```text
src/
  services/    -- Effect service interfaces (30 services)
  layers/      -- Live and Test layer implementations + InMemoryTracer
  errors/      -- Tagged error types (Data.TaggedError)
  schemas/     -- Effect Schema definitions (LogLevel, Changeset, PackageManager, etc.)
  utils/       -- GithubMarkdown, ReportBuilder, TelemetryReport
```

### Services

| Service | Purpose | Optional Peer Deps |
| ------- | ------- | ----------------- |
| ActionInputs | Schema-validated input reading | — |
| ActionLogger | Structured logging (info/verbose/debug) | — |
| ActionOutputs | Typed outputs + step summaries | — |
| ActionState | State transfer between action phases | — |
| ActionTelemetry | Metrics recording (metrics-only) | — |
| ActionCache | Cache save/restore | @actions/cache |
| ActionEnvironment | GitHub/runner context access | — |
| DryRun | Mutation guard with fallback values | — |
| GitHubClient | Octokit REST/GraphQL wrapper | @actions/github |
| GitHubGraphQL | Typed GraphQL query/mutation execution | @actions/github |
| GitHubApp | App authentication lifecycle | @octokit/auth-app |
| GitHubIssue | Issue CRUD (list, get, create, update, label) | @actions/github |
| GitHubRelease | Release + asset management | @actions/github |
| RateLimiter | API rate limit awareness + retry | — |
| CheckRun | Check runs + annotations | — |
| CommandRunner | Structured shell execution | @actions/exec |
| PullRequest | PR lifecycle (CRUD, merge, labels, reviewers) | @actions/github |
| PullRequestComment | PR comment management | — |
| WorkflowDispatch | Trigger + poll workflows | — |
| TokenPermissionChecker | Token permission validation + enforcement | — |
| ChangesetAnalyzer | Parse/generate changeset files | — |
| GitBranch | Branch management via Git Data API | — |
| GitCommit | Verified commits + file deletions via Git Data API | — |
| GitTag | Tag CRUD via Git Data API | — |
| ConfigLoader | JSON/JSONC/YAML config loading | jsonc-parser, yaml |
| ToolInstaller | Tool binary management | @actions/tool-cache |
| NpmRegistry | npm registry queries (versions, dist-tags, info) | — |
| PackagePublish | Pack + publish to registries | — |
| PackageManagerAdapter | Unified PM interface | — |
| WorkspaceDetector | Monorepo workspace detection + listing | — |

### Telemetry

- All service methods instrumented with `Effect.withSpan`
- `InMemoryTracer` captures spans for GitHub-native output
- `OtelTelemetryLive` bridges to OpenTelemetry exporters (OTel packages are
  regular dependencies, statically imported)

### Key Patterns

- Services use `Context.GenericTag<Interface>("name")` (not class-based `Context.Tag`)
- Error base classes marked `@internal` for api-extractor compatibility
- Live layers wrap `@actions/core`; Test layers use in-memory state
- Test layers use namespace object pattern: `ActionLoggerTest.empty()` / `ActionLoggerTest.layer(state)`

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
