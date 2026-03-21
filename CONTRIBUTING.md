# Contributing to @savvy-web/github-action-effects

Thank you for your interest in contributing. This guide covers the development
setup, project structure, and conventions you need to get started.

## Prerequisites

- **Node.js 24** (24.11.0 or later)
- **pnpm 10.32.1** -- enforced via the `packageManager` field in package.json

## Getting Started

```bash
git clone https://github.com/savvy-web/github-action-effects.git
cd github-action-effects
pnpm install
pnpm run build
pnpm run test
```

## Project Structure

```text
src/
  runtime/         Native GitHub Actions runtime protocol implementations
  errors/          Tagged error types (Data.TaggedError)
  layers/          Live and Test layer implementations per service
  schemas/         Effect Schema definitions (LogLevel, Changeset, etc.)
  services/        Service interfaces using Context.Tag
  utils/           Pure utility functions (GithubMarkdown, ReportBuilder)
  Action.ts        Action namespace (run, formatCause, resolveLogLevel)
  index.ts         Single barrel export
  testing.ts       Test-safe entry point (excludes Action namespace)
```

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with v8 coverage |
| `pnpm run lint` | Check code with Biome |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run typecheck` | Type-check via Turbo |
| `pnpm run build` | Build dev + prod outputs |
| `pnpm run build:dev` | Build development output only |
| `pnpm run build:prod` | Build production output only |

## Architecture

### Runtime Layer

The `src/runtime/` directory contains native implementations of the GitHub
Actions runtime protocol, replacing all `@actions/*` packages:

- `WorkflowCommand` -- `::command::` protocol formatter with value escaping
- `RuntimeFile` -- Environment file appender (GITHUB_OUTPUT, GITHUB_ENV, etc.)
- `ActionsConfigProvider` -- ConfigProvider reading `INPUT_*` env vars
- `ActionsLogger` -- Effect Logger emitting workflow commands
- `ActionsRuntime.Default` -- Single convenience Layer wiring everything

### Services

Each service is defined with `Context.Tag` for dependency injection.
Every service has two layer implementations:

- **Live** -- backed by native APIs (e.g., `ActionOutputsLive` uses `RuntimeFile`)
- **Test** -- backed by in-memory state (e.g., `ActionOutputsTest`)

Users compose layers with `Layer.mergeAll(...)`.

### Errors

Errors use `Data.TaggedError` with an explicit `Base` export marked
`@internal`. This pattern ensures `api-extractor` can resolve the error types
in the public API surface.

## Testing

**Framework:** Vitest with the forks pool (required for Effect-TS compatibility).

**Convention:** Tests live next to source files as `*.test.ts`. Each test file
uses the corresponding Test layer to exercise the service through the Effect
runtime without touching real GitHub Actions runner APIs.

**Coverage threshold:** 80% for lines, functions, statements, and branches.

Run a specific test file:

```bash
pnpm vitest run src/services/ActionOutputs.test.ts
```

## Commit Conventions

All commits must follow **conventional commit** format and include a
**DCO signoff**:

```text
feat: add CheckRun service

Signed-off-by: Your Name <your.email@example.com>
```

Commit types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

Git hooks enforce this automatically:

- **pre-commit** -- runs lint-staged (Biome format and lint)
- **commit-msg** -- validates conventional commit format and DCO
- **pre-push** -- runs tests for affected packages

## Code Style

- **Biome** handles both linting and formatting (no ESLint or Prettier)
- Use `.js` extensions for all relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Separate type imports: `import type { Foo } from './bar.js'`
- TypeScript strict mode is enabled

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
