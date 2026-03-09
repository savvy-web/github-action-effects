---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-09
last-synced: 2026-03-09
completeness: 95
related:
  - ./services.md
  - ./layers.md
  - ./errors-and-schemas.md
  - ./testing-strategy.md
  - ./integration-points.md
  - ./otel-exporter-inputs.md
dependencies: []
---

# GitHub Action Effects - Architecture

Effect-based utility library for building robust, well-logged, and
schema-validated GitHub Actions with Node.js 24.

## Design Documents

| Document | Contents |
| --- | --- |
| [services.md](./services.md) | All service interface descriptions, namespace objects, utility namespaces |
| [layers.md](./layers.md) | Layer patterns, live vs test implementations, dependency graph |
| [errors-and-schemas.md](./errors-and-schemas.md) | Error types, schema patterns, data flow |
| [testing-strategy.md](./testing-strategy.md) | Testing approach, coverage requirements, test layer patterns |
| [integration-points.md](./integration-points.md) | Peer dependencies, how services compose, data flow diagrams |
| [otel-exporter-inputs.md](./otel-exporter-inputs.md) | OTel exporter input design and Action.run() integration |

## Current State

The library is actively developed and provides 20 Effect services spanning core action I/O, GitHub API integration, git operations, build tooling, and observability, along with utility namespaces for markdown generation, report building, and telemetry output.

## Overview

`@savvy-web/github-action-effects` is an unopinionated utility library providing
Effect services for GitHub Actions built with `@savvy-web/github-action-builder`
(or any Node.js 24 action). Users compose these services into their own Effect
programs. The library does not dictate how actions are structured -- it provides
building blocks.

### Scope

The library provides 27 service interfaces, 6 utility namespaces, 28 error
types, and 13 schema modules. Services cover five domains:

- **Core action I/O** -- inputs, outputs, state, logging, environment, cache
- **Git operations** -- branches, commits, tags via Git Data API
- **GitHub API** -- REST client, GraphQL, releases, issues, PR comments, check
  runs, workflow dispatch, app auth, rate limiting
- **Build tooling** -- command execution, npm registry, package publishing,
  workspace detection, package manager adaptation, tool installation, changeset
  analysis, config loading
- **Observability** -- telemetry recording, OTel bridge, in-memory tracing,
  OTLP export, report building

### Problem Statement

GitHub Actions development suffers from four recurring pain points:

1. **Brittle error handling** -- Actions fail fast on first error, making
   monorepo builds that should report partial results instead crash entirely
2. **Noisy logging** -- Raw command output floods the console, making debugging
   with LLMs or human eyes difficult; no structured log levels
3. **Unvalidated inputs** -- JSON strings passed between workflows have no schema
   validation; GitHub's input validation is minimal
4. **Manual reporting** -- Building GFM tables for check run summaries and PR
   comments requires repetitive string concatenation

### Design Principles

- **Utility-first** -- Provide composable services, not an opinionated framework
- **Effect-native** -- All services are Effect services with proper Layer composition
- **Peer dependencies** -- `effect` and `@actions/*` packages are peers; users
  bring their own versions (action-builder bundles with ncc anyway)
- **Single entry point** -- One barrel export at `@savvy-web/github-action-effects`
- **Incrementally adoptable** -- Use one service or all of them; no all-or-nothing

---

## Rationale

### Architectural Decisions

#### AD-1: Peer Dependencies for effect and @actions/*

- **Decision:** `effect` and all `@actions/*` packages are peer dependencies
- **Rationale:** `@savvy-web/github-action-builder` bundles everything with
  `@vercel/ncc` into a single file. Peer deps let the bundler resolve versions
  from the consumer's package.json, avoiding duplication and version conflicts.
- **Trade-off:** Users must install effect themselves. This is acceptable since
  this library targets Effect-using action authors.

#### AD-2: Single Entry Point with Direct Imports

- **Decision:** One barrel export at `index.ts` using direct imports from each
  source file (no subfolder barrel re-exports)
- **Rationale:** Since ncc bundles everything and tree-shaking doesn't apply in
  the action runtime, subpath exports add complexity without benefit. A single
  import keeps DX simple. Direct imports (rather than re-exporting from
  subfolder index files) avoid circular dependency issues and make the
  dependency graph explicit.

#### AD-3: Services Over Frameworks

- **Decision:** Export composable Effect services, not an opinionated runner
- **Rationale:** Users may have their own Effect programs, layers, and error
  strategies. Providing services lets them compose freely. We can layer
  higher-level opinionated services on top later (e.g., a service that runs
  `npm pack --dry-run --json` and produces structured metrics).

#### AD-4: GFM Builder Standalone from Check Runs

- **Decision:** GFM/markdown builders are independent of the CheckRun service
- **Rationale:** GFM output is used in check run summaries, PR comments, issue
  bodies, and step summaries. Coupling it to check runs would limit reuse.

#### AD-5: Context.GenericTag Over Class-Based Context.Tag

- **Decision:** Services use `Context.GenericTag<T>(key)` instead of
  class-based `Context.Tag` patterns
- **Rationale:** `api-extractor` cannot follow class-based `Context.Tag`
  declarations through the type system. `Context.GenericTag` produces a
  simpler type signature that `api-extractor` can resolve, enabling proper
  `.d.ts` rollup and public API surface generation. Error classes use
  `Data.TaggedError` with explicit `Base` exports marked `@internal` for
  the same reason.

#### AD-6: Schema-Based State Serialization

- **Decision:** ActionState uses `Schema.encode` / `Schema.decode` for
  multi-phase state transfer rather than raw JSON.stringify/parse
- **Rationale:** `@actions/core.saveState()` / `getState()` only accept
  strings. Complex objects (timestamps, enums, nested structures) need
  serialization. Using Effect Schema for the round-trip provides three
  benefits: (1) type-safe encode on save guarantees the persisted JSON
  conforms to the schema, (2) decode on get validates data integrity and
  catches phase-ordering bugs (e.g., main.ts reading state before pre.ts
  sets it produces a clear `ActionStateError` instead of undefined behavior),
  (3) schema evolution is possible by widening the decode schema while
  keeping the encode schema strict.
- **Trade-off:** Slightly more ceremony than raw JSON, but the safety
  guarantees are essential for multi-phase actions where debugging state
  issues across phases is otherwise very difficult.

#### AD-7: Utility Namespaces for Lightweight Abstractions

- **Decision:** Pure computation patterns and thin API wrappers use
  `const X = { ... } as const` namespace objects instead of full services
- **Rationale:** GithubMarkdown, SemverResolver, ErrorAccumulator,
  AutoMerge, GitHubOtelAttributes, ReportBuilder, and TelemetryReport
  do not need dependency injection or state management. Namespace objects
  avoid service ceremony while remaining api-extractor compatible.

### Constraints

#### Node.js 24 Runtime

GitHub Actions runners support Node.js 24. We can use modern APIs and
ES2024+ features freely. The action-builder targets es2022+.

#### GitHub Actions I/O Conventions

Actions communicate through environment variables, file-based commands, and
the `@actions/core` API. All services must respect these conventions.

#### Bundle Size

Since ncc bundles all dependencies, the Effect library adds to bundle size.
This is acceptable -- Effect tree-shakes well and action bundles are not
size-constrained like browser bundles.

---

## Related Documentation

**Package Documentation:**

- `README.md` -- Package overview and quick-start guide
- `CLAUDE.md` -- Development guide

**External References:**

- [Effect Documentation](https://effect.website)
- [@savvy-web/github-action-builder](https://github.com/savvy-web/github-action-builder)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
