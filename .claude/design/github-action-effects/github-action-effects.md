---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-06
last-synced: 2026-03-06
completeness: 95
related: []
dependencies: []
---

# GitHub Action Effects - Architecture

Effect-based utility library for building robust, well-logged, and
schema-validated GitHub Actions with Node.js 24.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Related Documentation](#related-documentation)

---

## Overview

`@savvy-web/github-action-effects` is an unopinionated utility library providing
Effect services for GitHub Actions built with `@savvy-web/github-action-builder`
(or any Node.js 24 action). Users compose these services into their own Effect
programs. The library does not dictate how actions are structured — it provides
building blocks.

### Problem Statement

GitHub Actions development suffers from four recurring pain points:

1. **Brittle error handling** — Actions fail fast on first error, making
   monorepo builds that should report partial results instead crash entirely
2. **Noisy logging** — Raw command output floods the console, making debugging
   with LLMs or human eyes difficult; no structured log levels
3. **Unvalidated inputs** — JSON strings passed between workflows have no schema
   validation; GitHub's input validation is minimal
4. **Manual reporting** — Building GFM tables for check run summaries and PR
   comments requires repetitive string concatenation

### Design Principles

- **Utility-first** — Provide composable services, not an opinionated framework
- **Effect-native** — All services are Effect services with proper Layer composition
- **Peer dependencies** — `effect` and `@actions/*` packages are peers; users
  bring their own versions (action-builder bundles with ncc anyway)
- **Single entry point** — One barrel export at `@savvy-web/github-action-effects`
- **Incrementally adoptable** — Use one service or all of them; no all-or-nothing

---

## Current State

### System Components

All core services are implemented and tested (77 tests passing across 8 test
files, 95%+ coverage). The `ci:build` passes with both dev and prod outputs.

| Component | Status | Files |
| --- | --- | --- |
| ActionInputs service | Complete | `services/ActionInputs.ts`, `layers/ActionInputsLive.ts`, `layers/ActionInputsTest.ts` |
| ActionLogger service | Complete | `services/ActionLogger.ts`, `layers/ActionLoggerLive.ts`, `layers/ActionLoggerTest.ts` |
| ActionOutputs service | Complete | `services/ActionOutputs.ts`, `layers/ActionOutputsLive.ts`, `layers/ActionOutputsTest.ts` |
| Shared decode helpers | Complete | `layers/internal/decodeInput.ts` |
| ActionInputError | Complete | `errors/ActionInputError.ts` |
| ActionOutputError | Complete | `errors/ActionOutputError.ts` |
| GithubMarkdown utils | Complete | `utils/GithubMarkdown.ts` |
| GithubMarkdown schemas | Complete | `schemas/GithubMarkdown.ts` |
| LogLevel schemas | Complete | `schemas/LogLevel.ts` |

### Current Limitations

- No integration tests yet (deferred until services are stable in real actions)
- No CheckRun, CommandRunner, or ActionCache services yet (future enhancements)

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

#### AD-5: Context.GenericTag Over Class-Based Context.Tag

- **Decision:** Services use `Context.GenericTag<T>(key)` instead of
  class-based `Context.Tag` patterns
- **Rationale:** `api-extractor` cannot follow class-based `Context.Tag`
  declarations through the type system. `Context.GenericTag` produces a
  simpler type signature that `api-extractor` can resolve, enabling proper
  `.d.ts` rollup and public API surface generation. Error classes use
  `Data.TaggedError` with explicit `Base` exports marked `@internal` for
  the same reason.

#### AD-4: GFM Builder Standalone from Check Runs

- **Decision:** GFM/markdown builders are independent of the CheckRun service
- **Rationale:** GFM output is used in check run summaries, PR comments, issue
  bodies, and step summaries. Coupling it to check runs would limit reuse.

### Constraints

#### Node.js 24 Runtime

GitHub Actions runners support Node.js 24. We can use modern APIs and
ES2024+ features freely. The action-builder targets es2022+.

#### GitHub Actions I/O Conventions

Actions communicate through environment variables, file-based commands, and
the `@actions/core` API. All services must respect these conventions.

#### Bundle Size

Since ncc bundles all dependencies, the Effect library adds to bundle size.
This is acceptable — Effect tree-shakes well and action bundles are not
size-constrained like browser bundles.

---

## System Architecture

### Service Overview

Four core service modules, each independently usable:

```text
@savvy-web/github-action-effects
├── ActionInputs    — Schema-validated input reading
├── ActionLogger    — Structured logging with buffering
├── ActionOutputs   — Typed output setting and step summaries
└── GithubMarkdown  — GFM table/summary builders (pure functions)
```

### Module Details

#### ActionInputs Service

Reads and validates GitHub Action inputs using Effect Schema.

**Interface:**

- `get(name, schema)` — Read a single input, validate against schema
- `getOptional(name, schema)` — Read optional input, return Option
- `getSecret(name, schema)` — Read input, mark as secret (masked in logs)
- `getJson(name, schema)` — Read input as JSON string, parse and validate

**Backed by:** `@actions/core.getInput()`, `@actions/core.setSecret()` — all
`core.*` calls in `ActionInputsLive` are wrapped in `Effect.sync()` to
follow Effect's laziness contract (side effects are deferred until the
Effect is run, never called eagerly during layer construction).

**Shared decode helpers:** `decodeInput` and `decodeJsonInput` are extracted
to `layers/internal/decodeInput.ts` and shared by both `ActionInputsLive`
and `ActionInputsTest`, eliminating duplication of schema validation logic.

**Error type:** `ActionInputError` — tagged error with input name, raw value,
and schema validation issues

**Why this matters:** Inter-workflow JSON payloads (e.g., workflow-controller
passing config to release-action) get validated against a schema with clear
error messages instead of runtime crashes deep in business logic.

#### ActionLogger Service

Custom Effect Logger with three log levels and a standardized `log-level`
action input. Separates user-facing output (always visible via `core.info()`)
from internal diagnostics (GitHub-gated via `core.debug()`).

**Log Levels:**

| Level | Behavior | Use Case |
| --------- | ------------------------------------------------ | --------------------------------- |
| `info` | Buffered. Shows only outcome summaries. On failure, flushes captured verbose buffer at the failure point. | Default. Clean, LLM-friendly. |
| `verbose` | Unbuffered milestones. Start/finish markers for operations ("Installing dependencies...", "Finished installing dependencies..."). Enough to detect hangs. | CI debugging, progress tracking. |
| `debug` | Everything. Full command output, input/output values, internal state. Extremely verbose. | Deep debugging. |

**Standardized Action Input:**

```yaml
inputs:
  log-level:
    description: "Logging verbosity: info, verbose, debug, or auto"
    required: false
    default: "auto"
```

`auto` resolves to `info` unless GitHub's "enable debug logging" is active
(`RUNNER_DEBUG === '1'`), in which case it escalates to `debug`.

**Two Separate Logging Channels:**

1. **User-facing channel** (`core.info()`) — Always visible in the Actions
   console. What appears here is controlled by our `log-level` input.
2. **GitHub debug channel** (`core.debug()`) — Only visible when
   `ACTIONS_STEP_DEBUG` is set by the user. We always write internal
   implementation details and sensitive context here regardless of our
   log-level. This is a safe dumping ground that GitHub controls visibility of.

| Our Level | `core.info()` (always visible) | `core.debug()` (GitHub-gated) |
| --------- | ------------------------------------------- | ----------------------------- |
| `info` | Outcome summaries only. Verbose buffer flushed on failure. | Internal details — always |
| `verbose` | Milestones + outcomes | Same |
| `debug` | Everything — full output, inputs, outputs | Same |

**Interface:**

- Implements `Effect.Logger` — plugs into Effect's logging system
- `group(name, effect)` — Wraps an effect in a collapsible log group
  (`core.startGroup()` / `core.endGroup()`)
- `withBuffer(label, effect)` — Captures verbose output in memory; flushes on failure
- `annotationError(message, properties?)` — Emits an error annotation via
  `core.error()` (red, blocks PR checks)
- `annotationWarning(message, properties?)` — Emits a warning annotation via
  `core.warning()` (yellow, informational)
- `annotationNotice(message, properties?)` — Emits a notice annotation via
  `core.notice()` (blue, informational)

**Message Formatting:**

`ActionLoggerLive` uses an internal `formatMessage` helper that unwraps
single-element arrays from Effect's `Logger.make` callback (which wraps the
message in an array) before converting to string. This ensures clean log
output without extraneous brackets.

**Buffer Behavior (info level):**

When an operation runs at `info` level, all verbose output (command stdout,
progress lines, etc.) is captured in an in-memory buffer. On success, the
buffer is discarded and only the outcome summary is shown. On failure, the
buffer is flushed to `core.info()` at the point of failure, giving full
context for debugging without polluting the happy path.

**Why this matters:** The runtime-setup action installs Node.js, pnpm, caches,
etc. This produces hundreds of log lines that are irrelevant unless something
fails. At `info` level, the user sees "Runtime configured" on success. On
failure, the full install log is flushed so the error has context. At
`verbose`, they see start/finish markers for each step. At `debug`, they
see everything.

#### ActionOutputs Service

Sets action outputs and writes step summaries.

**Interface:**

- `set(name, value)` — Set an output value
- `setJson(name, value, schema)` — Serialize and set a JSON output (validates
  against schema before setting)
- `summary(content)` — Write to `$GITHUB_STEP_SUMMARY`
- `exportVariable(name, value)` — Export an environment variable
- `addPath(path)` — Add to PATH

**Backed by:** `@actions/core.setOutput()`, `@actions/core.summary`,
`@actions/core.exportVariable()`, `@actions/core.addPath()`

#### GithubMarkdown (Pure Functions)

Standalone GFM builders — no Effect service, just pure functions.

**Interface:**

- `table(headers, rows)` — Build a GFM table
- `heading(text, level)` — Heading with optional level
- `details(summary, content)` — Collapsible `<details>` block
- `rule()` — Horizontal rule
- `statusIcon(status)` — Map status to emoji (pass/fail/skip/warn)
- `link(text, url)` — Markdown link
- `list(items)` — Bulleted list
- `checklist(items)` — Checkbox list
- `bold(text)` — Bold text
- `code(text)` — Inline code
- `codeBlock(text, language)` — Fenced code block

**Why standalone:** These are used everywhere — check run summaries, PR
comments, issue bodies, step summaries. No service dependency needed.

### Layer Composition

Each service has a `Live` layer backed by real `@actions/core` calls and
a `Test` layer backed by in-memory state for unit testing.

```text
ActionInputsLive   — reads from @actions/core.getInput (deferred via Effect.sync)
ActionInputsTest   — reads from provided Record<string, string>
  (both share decodeInput/decodeJsonInput from layers/internal/decodeInput.ts)

ActionLoggerLive   — routes to @actions/core log functions
ActionLoggerTest   — captures log entries in memory (annotations include type field)

ActionOutputsLive  — writes to @actions/core outputs
ActionOutputsTest  — captures outputs in memory
```

Users compose layers as needed:

```typescript
import { ActionInputsLive, ActionLoggerLive } from "@savvy-web/github-action-effects"

const MyActionLayer = Layer.mergeAll(
  ActionInputsLive,
  ActionLoggerLive,
)
```

---

## Data Flow

### Input Validation Flow

```text
action.yml inputs
  → @actions/core.getInput()
  → ActionInputs.get(name, schema)
  → Effect.Schema.decode
  → typed value | ActionInputError
```

### Logging Flow

```text
Effect.log*() calls in user program
  → ActionLogger (Effect Logger implementation)
  → always: write internal details to core.debug() (GitHub-gated)
  → based on log-level:
     info:    capture in buffer
              → on success: discard, emit outcome summary via core.info()
              → on failure: flush buffer via core.info(), then outcome
     verbose: emit milestone markers via core.info() (start/finish)
     debug:   emit everything via core.info()

log-level resolution:
  "auto" → RUNNER_DEBUG === '1' ? "debug" : "info"
  "info" | "verbose" | "debug" → use directly
```

### Output Flow

```text
ActionOutputs.set(name, value)
  → @actions/core.setOutput()
  → available to downstream steps

ActionOutputs.summary(gfm)
  → $GITHUB_STEP_SUMMARY file
  → visible in Actions UI
```

---

## Integration Points

### @actions/core (peer)

Primary integration for input reading, output setting, logging, and
annotations. All interactions wrapped in Effect services.

### @actions/github (optional peer)

Provides authenticated Octokit for future check-run and PR-comment services.
Not required for initial implementation — GithubMarkdown is pure. Marked
`optional: true` in `peerDependenciesMeta`.

### @actions/exec (optional peer)

For future command-running services (e.g., the `npm pack --dry-run --json`
pattern). Not required for initial implementation. Marked `optional: true`
in `peerDependenciesMeta`.

### @effect/platform and @effect/platform-node (optional peers)

Added as optional peer dependencies for future platform-specific services
(e.g., filesystem, HTTP client). Not required by any current service.

### effect (peer)

Core dependency. Services use `Context.GenericTag`, `Layer`, `Schema`,
`Data.TaggedError`, `FiberRef`, and `Logger`.

### @savvy-web/github-action-builder (optional)

Actions built with the builder benefit from this library but it is not
required. Any Node.js 24 action can use these services.

---

## Testing Strategy

### Unit Tests

**Location:** `src/**/*.test.ts`

**Framework:** Vitest with forks pool (Effect-TS compatibility)

**Approach:** Each service has a `Test` layer with in-memory backing. Tests
exercise services through the Effect runtime with test layers, never touching
real `@actions/core` APIs. Test layers use the namespace object pattern for
ergonomic test setup:

- `ActionInputsTest` — constructed from `Record<string, string>`
- `ActionLoggerTest.empty()` / `ActionLoggerTest.layer(state)` — namespace
  object with in-memory state capture
- `ActionOutputsTest.empty()` / `ActionOutputsTest.layer(state)` — namespace
  object with in-memory state capture

**What is tested (77 tests across 8 files, 95%+ coverage):**

- Schema validation: valid inputs decode, invalid inputs produce clear errors
- Input laziness: `ActionInputsLive` defers `core.getInput()`/`core.setSecret()`
  via `Effect.sync()`, verified in dedicated live-layer tests
- Logger buffering: buffer captures on success, flushes on failure
- Logger two-channel behavior: always writes to debug, conditionally to info
- Logger annotations: three explicit methods (`annotationError`,
  `annotationWarning`, `annotationNotice`) tested via the test layer which
  captures a `type` field (`"error"` | `"warning"` | `"notice"`) on each entry
- FiberRef log level: level propagation and resolution
- Output setting: values are captured by test layer
- Output live layer: `core.setOutput()`, `core.exportVariable()`, `core.addPath()`,
  and `core.summary` interactions
- GFM builders: pure function output matches expected markdown strings
- GFM schemas: Status, ChecklistItem, CapturedOutput encode/decode
- LogLevel schemas: parsing and round-trip validation

### Integration Tests

Deferred until initial services are stable. Will use `nektos/act` via the
action-builder's `persistLocal` feature to run actions in Docker containers.

---

## Future Enhancements

### Near-Term (After Initial Release)

- **CheckRun service** — Create/update check runs via Octokit, post PR comments
- **CommandRunner service** — Run shell commands with structured output capture,
  timeout handling, and retry logic
- **Specialized command services** — e.g., `NpmPack` service that runs
  `npm pack --dry-run --json` and returns typed metrics

### Medium-Term

- **ActionCache service** — Effect wrapper around `@actions/cache`
- **Artifact service** — Effect wrapper around `@actions/artifact`
- **Token validation service** — Verify GitHub token permissions in pre-phase

### Long-Term

- **Telemetry** — OpenTelemetry spans for action phases
- **Action composition** — Utilities for actions that trigger other workflows

---

## Related Documentation

**Package Documentation:**

- `README.md` — Package overview (to be written)
- `CLAUDE.md` — Development guide

**External References:**

- [Effect Documentation](https://effect.website)
- [@savvy-web/github-action-builder](https://github.com/savvy-web/github-action-builder)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
