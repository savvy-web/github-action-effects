# Contributing to @savvy-web/github-action-effects

Thank you for your interest in contributing. This guide covers the development
setup, project structure, and conventions you need to get started.

## Prerequisites

- **Node.js 24** (24.11.0 or later)
- **pnpm 10.30.3** -- enforced via the `packageManager` field in package.json

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
  errors/          Tagged error types (ActionInputError, ActionOutputError)
  layers/          Live and Test layer implementations per service
  schemas/         Effect Schema definitions (LogLevel, GithubMarkdown)
  services/        Service interfaces using Context.GenericTag
  utils/           Pure utility functions (GithubMarkdown builders)
  index.ts         Single barrel export
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

### Services

Each service is defined with `Context.GenericTag<T>(key)` rather than
class-based `Context.Tag`. This produces simpler type signatures that work
correctly with `api-extractor` for `.d.ts` rollup.

### Layers

Every service has two layer implementations:

- **Live** -- backed by real `@actions/core` calls (e.g., `ActionInputsLive`)
- **Test** -- backed by in-memory state (e.g., `ActionInputsTest`)

Users compose layers with `Layer.mergeAll(...)`.

### Errors

Errors use `Data.TaggedError` with an explicit `Base` export marked
`@internal`. This pattern ensures `api-extractor` can resolve the error types
in the public API surface.

### GithubMarkdown

Pure functions (not a service). No Effect dependency needed to use the
GFM table, heading, details, and list builders.

## Testing

**Framework:** Vitest with the forks pool (required for Effect-TS compatibility).

**Convention:** Tests live next to source files as `*.test.ts`. Each test file
uses the corresponding Test layer to exercise the service through the Effect
runtime without touching real `@actions/core` APIs.

**Test layer namespace pattern:**

- `ActionInputsTest` -- constructed from `Record<string, string>`
- `ActionLoggerTest.empty()` / `ActionLoggerTest.layer(state)` -- in-memory
  log capture
- `ActionOutputsTest.empty()` / `ActionOutputsTest.layer(state)` -- in-memory
  output capture

Run a specific test file:

```bash
pnpm vitest run src/services/ActionInputs.test.ts
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
