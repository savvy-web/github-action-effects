# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Status

Effect-based utility library for building robust, well-logged, and
schema-validated GitHub Actions. Core services (ActionInputs, ActionLogger,
ActionOutputs) and GithubMarkdown utilities are implemented and tested.

## Design Documentation

**For architecture, service interfaces, and data flow:**
-> `@./.claude/design/github-action-effects/github-action-effects.md`

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
  services/    -- Effect service definitions (ActionInputs, ActionLogger, ActionOutputs)
  layers/      -- Live and Test layer implementations
  errors/      -- Tagged error types (Data.TaggedError)
  schemas/     -- Effect Schema definitions (LogLevel, GithubMarkdown)
  utils/       -- Pure utility functions (GithubMarkdown builders)
```

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
