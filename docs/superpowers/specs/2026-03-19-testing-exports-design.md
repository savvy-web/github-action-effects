# Testing Exports Subpath with Platform Abstraction

**Issue:** [#42](https://github.com/savvy-web/github-action-effects/issues/42)
**Date:** 2026-03-19
**Status:** Draft

## Problem

Every test file that imports from `@savvy-web/github-action-effects` must mock
the entire module because static imports in Live layers trigger `@actions/cache`
(which pulls in `minimatch` with broken CJS/ESM interop in Vitest). This forces
~20 lines of `vi.mock` boilerplate per test file that manually reconstructs
`Context.Tag` identifiers, must be kept in sync with actual tag IDs, and breaks
whenever services are added or renamed.

Additionally, Live layers directly import `@actions/*` packages, which:

- Prevents consumers from patching or replacing `@actions/*` dependencies
- Couples the library's runtime behavior to specific `@actions/*` versions
- Makes it impossible to test Live layer logic without `vi.mock`

## Solution

Two complementary changes:

1. **Platform abstraction** -- wrap each `@actions/*` package in an Effect
   service so Live layers consume them via DI instead of direct imports
2. **`./testing` subpath export** -- a second entry point that provides
   everything except the platform wrapper Live layers

### Consumer experience

**Testing with Test layers (unit tests):**

```typescript
import {
  ActionInputs,
  ActionInputsTest,
  CommandRunner,
  CommandRunnerTest,
} from "@savvy-web/github-action-effects/testing";

const layer = Layer.mergeAll(
  ActionInputsTest({ "tool-name": "my-tool" }),
  CommandRunnerTest.layer({
    responses: [{ exitCode: 0, stdout: "ok", stderr: "" }],
  }),
);
```

**Testing with Live layers + mock platform (integration tests):**

```typescript
import {
  GitHubClientLive,
  ActionsGitHub,
} from "@savvy-web/github-action-effects/testing";

// Test the REAL GitHubClientLive logic with a mock Octokit
const layer = GitHubClientLive("fake-token").pipe(
  Layer.provide(
    Layer.succeed(ActionsGitHub, {
      getOctokit: (token) => mockOctokit,
    }),
  ),
);
```

**Production (unchanged for simple cases):**

```typescript
import { Action } from "@savvy-web/github-action-effects";

Action.run(program);
```

**Production with custom platform:**

```typescript
import { Action } from "@savvy-web/github-action-effects";

Action.run(program, { platform: myPatchedPlatformLayer });
```

## Design

### Part 1: Platform wrapper services

Six new Effect services that abstract `@actions/*` packages behind DI:

| Service | Wraps | Consumers |
| --- | --- | --- |
| `ActionsCore` | `@actions/core` | ActionInputsLive, ActionLoggerLive, ActionOutputsLive, ActionStateLive, ToolInstallerLive, Action.run |
| `ActionsGitHub` | `@actions/github` | GitHubClientLive |
| `ActionsCache` | `@actions/cache` | ActionCacheLive |
| `ActionsExec` | `@actions/exec` | CommandRunnerLive |
| `ActionsToolCache` | `@actions/tool-cache` | ToolInstallerLive |
| `OctokitAuthApp` | `@octokit/auth-app` | GitHubAppLive |

Each wrapper service:

- Lives in `src/services/` as a `Context.Tag` class (follows existing pattern)
- Exposes the subset of the underlying package API that Live layers actually
  use (not the full API surface)
- Gets a `*Live` layer in `src/layers/` that does the actual static import
- Owns any re-exported types from the underlying package (see "Type-only
  imports" below)

#### `ActionsCore` interface

Methods used across ActionInputsLive, ActionLoggerLive, ActionOutputsLive,
ActionStateLive, ToolInstallerLive, and Action.run:

```typescript
export class ActionsCore extends Context.Tag("github-action-effects/ActionsCore")<
  ActionsCore,
  {
    readonly getInput: (name: string, options?: { required?: boolean; trimWhitespace?: boolean }) => string;
    readonly getMultilineInput: (name: string, options?: { required?: boolean; trimWhitespace?: boolean }) => string[];
    readonly getBooleanInput: (name: string) => boolean;
    readonly setOutput: (name: string, value: string) => void;
    readonly setFailed: (message: string | Error) => void;
    readonly exportVariable: (name: string, value: string) => void;
    readonly addPath: (path: string) => void;
    readonly setSecret: (name: string) => void;
    readonly info: (message: string) => void;
    readonly debug: (message: string) => void;
    readonly warning: (message: string | Error, properties?: AnnotationProperties) => void;
    readonly error: (message: string | Error, properties?: AnnotationProperties) => void;
    readonly notice: (message: string, properties?: AnnotationProperties) => void;
    readonly startGroup: (name: string) => void;
    readonly endGroup: () => void;
    readonly getState: (name: string) => string;
    readonly saveState: (name: string, value: string) => void;
    readonly summary: { write: () => Promise<unknown>; addRaw: (text: string) => unknown };
  }
>() {}
```

Where `AnnotationProperties` is re-exported from this file (see "Type-only
imports" section).

#### `ActionsGitHub` interface

Used by GitHubClientLive (which is a factory function taking a token):

```typescript
export class ActionsGitHub extends Context.Tag("github-action-effects/ActionsGitHub")<
  ActionsGitHub,
  {
    readonly getOctokit: (token: string) => GitHubOctokit;
  }
>() {}
```

Where `GitHubOctokit` is a type alias defined in this file that captures the
return type of `github.getOctokit()`. This must preserve the `.graphql<T>()`
method, `.rest` namespace, and `.request()` method used by GitHubClientLive.

#### `ActionsCache` interface

Used by ActionCacheLive:

```typescript
export class ActionsCache extends Context.Tag("github-action-effects/ActionsCache")<
  ActionsCache,
  {
    readonly saveCache: (paths: string[], key: string) => Promise<number>;
    readonly restoreCache: (paths: string[], primaryKey: string, restoreKeys?: string[]) => Promise<string | undefined>;
  }
>() {}
```

#### `ActionsExec` interface

Used by CommandRunnerLive:

```typescript
export class ActionsExec extends Context.Tag("github-action-effects/ActionsExec")<
  ActionsExec,
  {
    readonly exec: (
      commandLine: string,
      args?: string[],
      options?: ActionsExecOptions,
    ) => Promise<number>;
  }
>() {}
```

Where `ActionsExecOptions` is a type defined in this file (see "Type-only
imports" section).

#### `ActionsToolCache` interface

Used by ToolInstallerLive:

```typescript
export class ActionsToolCache extends Context.Tag("github-action-effects/ActionsToolCache")<
  ActionsToolCache,
  {
    readonly find: (toolName: string, versionSpec: string) => string;
    readonly downloadTool: (url: string) => Promise<string>;
    readonly extractTar: (file: string, dest?: string, flags?: string) => Promise<string>;
    readonly extractZip: (file: string, dest?: string) => Promise<string>;
    readonly cacheDir: (sourceDir: string, tool: string, version: string) => Promise<string>;
  }
>() {}
```

#### `OctokitAuthApp` interface

Used by GitHubAppLive:

```typescript
export class OctokitAuthApp extends Context.Tag("github-action-effects/OctokitAuthApp")<
  OctokitAuthApp,
  {
    readonly createAppAuth: (options: {
      appId: string;
      privateKey: string;
    }) => AppAuth;
  }
>() {}
```

Where `AppAuth` is defined in this file as:

```typescript
interface AppAuth {
  (options: { type: "app" }): Promise<{ token: string }>;
  (options: { type: "installation"; installationId: number }): Promise<{
    token: string;
    expiresAt: string;
    installationId: number;
    permissions: Record<string, string>;
  }>;
}
```

#### Wrapper Live layers

Each wrapper's Live layer is trivial -- just pass through the real package:

```typescript
// src/layers/ActionsCoreLive.ts
import * as core from "@actions/core";
import { Layer } from "effect";
import { ActionsCore } from "../services/ActionsCore.js";

export const ActionsCoreLive: Layer.Layer<ActionsCore> = Layer.succeed(
  ActionsCore,
  core,
);
```

For `ActionsGitHub`, the Live layer wraps `github.getOctokit`:

```typescript
// src/layers/ActionsGitHubLive.ts
import * as github from "@actions/github";
import { Layer } from "effect";
import { ActionsGitHub } from "../services/ActionsGitHub.js";

export const ActionsGitHubLive: Layer.Layer<ActionsGitHub> = Layer.succeed(
  ActionsGitHub,
  { getOctokit: (token) => github.getOctokit(token) },
);
```

For `OctokitAuthApp`, the Live layer wraps `createAppAuth`:

```typescript
// src/layers/OctokitAuthAppLive.ts
import { createAppAuth } from "@octokit/auth-app";
import { Layer } from "effect";
import { OctokitAuthApp } from "../services/OctokitAuthApp.js";

export const OctokitAuthAppLive: Layer.Layer<OctokitAuthApp> = Layer.succeed(
  OctokitAuthApp,
  { createAppAuth },
);
```

### Part 2: Refactor Live layers

All 9 Live layers that currently import `@actions/*` directly are refactored
to depend on the wrapper services via Effect DI.

**Affected Live layers (9 files + Action.ts = 10 files total):**

| Live Layer | Current Import | New Dependency |
| --- | --- | --- |
| `ActionInputsLive` | `@actions/core` | `ActionsCore` |
| `ActionLoggerLive` | `@actions/core` | `ActionsCore` |
| `ActionOutputsLive` | `@actions/core` | `ActionsCore` |
| `ActionStateLive` | `@actions/core` | `ActionsCore` |
| `ActionCacheLive` | `@actions/cache` | `ActionsCache` |
| `CommandRunnerLive` | `@actions/exec` | `ActionsExec` |
| `GitHubClientLive` | `@actions/github` | `ActionsGitHub` |
| `GitHubAppLive` | `@octokit/auth-app` | `OctokitAuthApp` |
| `ToolInstallerLive` | `@actions/core` + `@actions/tool-cache` | `ActionsCore` + `ActionsToolCache` |
| `Action.ts` | `@actions/core` | `ActionsCore` (via `ActionsPlatformLive`) |

**Unaffected Live layers (23 files):**

The remaining Live layers already depend only on Effect services, schemas, and
`@effect/platform` -- no changes needed.

#### Refactoring patterns

Three distinct patterns appear across the affected layers:

**Pattern A: Simple `Layer.succeed` -> `Layer.effect`**

Most layers (ActionInputsLive, ActionOutputsLive, ActionStateLive,
ActionCacheLive, ToolInstallerLive) currently use `Layer.succeed` with
`core.*` calls inside `Effect.sync` wrappers. These become `Layer.effect`
where the wrapper service is captured once at construction and closed over:

```typescript
// Before
export const ActionInputsLive: Layer.Layer<ActionInputs> = Layer.succeed(
  ActionInputs,
  {
    get: (name, schema) =>
      Effect.sync(() => core.getInput(name, { required: true })).pipe(...)
  },
);

// After
export const ActionInputsLive: Layer.Layer<ActionInputs, never, ActionsCore> =
  Layer.effect(
    ActionInputs,
    Effect.gen(function* () {
      const core = yield* ActionsCore;
      return {
        get: (name, schema) =>
          Effect.sync(() => core.getInput(name, { required: true })).pipe(...)
      };
    }),
  );
```

#### Pattern B: Non-Effect callbacks (ActionLoggerLive)

`ActionLoggerLive` is the most complex case. It has:

- `emitToGitHub()` -- plain synchronous function calling `core.error/warning/info`
- `makeActionLogger()` -- creates a `Logger.make` callback calling `core.debug`
- `flushBuffer()` -- plain synchronous function calling `core.info`
- `ActionLoggerLayer` -- module-level constant calling `makeActionLogger()`

These cannot use `yield*` because they run outside the Effect runtime. The
solution: `makeActionLogger` and all helper functions take the `ActionsCore`
service value as a parameter (closure pattern):

```typescript
const emitToGitHub = (
  core: Context.Tag.Service<ActionsCore>,
  level: LogLevel.LogLevel,
  message: string,
): void => {
  if (LogLevel.greaterThanEqual(level, LogLevel.Error)) {
    core.error(message);
  } else if (LogLevel.greaterThanEqual(level, LogLevel.Warning)) {
    core.warning(message);
  } else {
    core.info(message);
  }
};

export const makeActionLogger = (
  core: Context.Tag.Service<ActionsCore>,
): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, context }) => {
    const text = formatMessage(message);
    core.debug(text);
    const actionLevel = FiberRefs.getOrDefault(context, CurrentLogLevel);
    if (shouldEmitUserFacing(logLevel, actionLevel)) {
      emitToGitHub(core, logLevel, text);
    }
  });
```

`ActionLoggerLayer` becomes a function of `ActionsCore`, constructed via
`Layer.unwrapEffect`:

```typescript
export const ActionLoggerLayer: Layer.Layer<never, never, ActionsCore> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const core = yield* ActionsCore;
      return Logger.replace(Logger.defaultLogger, makeActionLogger(core));
    }),
  );
```

`ActionLoggerLive` similarly captures `core` at construction for the
`withBuffer`, `group`, and annotation methods.

#### Pattern C: Factory function (GitHubClientLive)

`GitHubClientLive` is currently a function `(token: string) => Layer.Layer<GitHubClient>`.
After refactoring it becomes
`(token: string) => Layer.Layer<GitHubClient, GitHubClientError, ActionsGitHub>`:

```typescript
export const GitHubClientLive = (
  token: string,
): Layer.Layer<GitHubClient, GitHubClientError, ActionsGitHub> =>
  Layer.effect(
    GitHubClient,
    Effect.gen(function* () {
      const gh = yield* ActionsGitHub;
      const octokit = gh.getOctokit(token);
      return { /* ... close over octokit ... */ };
    }),
  );
```

#### Type-only imports from `@actions/*`

Two files have type-only imports from `@actions/*`:

- `CommandRunnerLive.ts`: `import type { ExecOptions } from "@actions/exec"`
- `ActionLoggerTest.ts` and `ActionLogger.ts`:
  `import type { AnnotationProperties } from "@actions/core"`

Type-only imports are erased at runtime and don't cause module resolution.
However, for clean separation, these types should be re-defined or
re-exported from the wrapper service files:

- `ActionsCore.ts` re-exports/defines `AnnotationProperties`
- `ActionsExec.ts` defines `ActionsExecOptions` (subset of `ExecOptions`
  actually used by `CommandRunnerLive`)

This ensures no file in `/testing` imports from `@actions/*` even at the
type level.

### Part 3: `ActionsPlatformLive` bundle

A convenience layer that merges all 6 wrapper Live layers:

```typescript
// src/layers/ActionsPlatformLive.ts
import { Layer } from "effect";
import { ActionsCoreLive } from "./ActionsCoreLive.js";
import { ActionsGitHubLive } from "./ActionsGitHubLive.js";
import { ActionsCacheLive } from "./ActionsCacheLive.js";
import { ActionsExecLive } from "./ActionsExecLive.js";
import { ActionsToolCacheLive } from "./ActionsToolCacheLive.js";
import { OctokitAuthAppLive } from "./OctokitAuthAppLive.js";

export const ActionsPlatformLive = Layer.mergeAll(
  ActionsCoreLive,
  ActionsGitHubLive,
  ActionsCacheLive,
  ActionsExecLive,
  ActionsToolCacheLive,
  OctokitAuthAppLive,
);
```

A type alias for the provided services:

```typescript
export type ActionsPlatform =
  | ActionsCore
  | ActionsGitHub
  | ActionsCache
  | ActionsExec
  | ActionsToolCache
  | OctokitAuthApp;
```

Consumers who only need a subset (e.g., only `ActionsCore` for
`ActionInputsLive`) can provide just that subset -- the type system enforces
which wrappers each Live layer requires.

### Part 4: Refactor `Action.run()`

Currently `Action.run()` directly calls `core.getInput()`, `core.setFailed()`,
and `core.debug()`. These must go through `ActionsCore`.

**New signature (backwards-compatible overloads):**

```typescript
run(program: Effect.Effect<void, E, CoreServices>): Promise<void>;
run(program: Effect.Effect<void, E, CoreServices | R>, layer: Layer.Layer<R>): Promise<void>;
run(program: Effect.Effect<void, E, CoreServices | R>, options: {
  layer?: Layer.Layer<R>;
  platform?: Layer.Layer<ActionsPlatform>;
}): Promise<void>;
```

**Key implementation details:**

1. `Action.run()` provides `ActionsPlatformLive` to **all** layers -- both
   its own internal `CoreLive` and any user-supplied `layer` argument. This
   means `Action.run(program, ActionStateLive)` continues to work because
   `ActionsPlatformLive` satisfies `ActionStateLive`'s `ActionsCore`
   requirement automatically.

2. The OTel config reading (`core.getInput("otel-enabled")` etc.) and error
   handling (`core.setFailed`, `core.debug`) move inside the Effect pipeline
   where they access `ActionsCore` via `yield*`.

3. When `options.platform` is provided, it replaces `ActionsPlatformLive`.
   This gives consumers full control over the `@actions/*` implementations.

4. `Action.ts` no longer imports `@actions/core` directly. It imports
   `ActionsCore` (the service tag) and `ActionsPlatformLive` (the default).

### Part 5: `./testing` subpath

A new `src/testing.ts` barrel file that re-exports everything from
`src/index.ts` **except**:

- The 6 wrapper `*Live` layers (`ActionsCoreLive`, `ActionsGitHubLive`, etc.)
- `ActionsPlatformLive` (bundles all wrapper Live layers)

**Included** (everything else):

- All 30 service tag classes
- All 6 wrapper service tags (`ActionsCore`, `ActionsGitHub`, etc.) and their
  associated types (`AnnotationProperties`, `ActionsExecOptions`, etc.)
- All 32 existing Live layers (now side-effect-free)
- All test layer factories and their state types (`ActionCacheTestState`,
  `ActionLoggerTestState`, `TestAnnotationType`, `CommandResponse`, etc.)
- All error types (`ActionInputError`, `GitHubClientError`, etc.)
- All schemas and schema types
- All utils (`GithubMarkdown`, `ReportBuilder`, `TelemetryReport`,
  `SemverResolver`, `ErrorAccumulator`, `AutoMerge`, `GitHubOtelAttributes`)
- `InMemoryTracer` and `CompletedSpan` type
- `Action` namespace (now side-effect-free)
- `CoreServices`, `InputConfig`, `ParsedInputs` types
- `ActionLoggerLayer`, `CurrentLogLevel` (now depend on `ActionsCore` via DI,
  but don't import `@actions/*` directly)
- All service companion types (`CacheHit`, `ExecOptions`, `ExecOutput`,
  `BotIdentity`, `InstallationToken`, `IssueData`, `ReleaseAsset`,
  `ReleaseData`, `TagRef`, `PullRequestInfo`, `PullRequestListOptions`,
  `CommentRecord`, `PollOptions`, `WorkflowRunStatus`, `InstallOptions`,
  `PackResult`, `RegistryTarget`, `ToolInstallOptions`, `Report`,
  `SpanSummary`, `AccumulateResult`, etc.)

**Excluded** (only 7 items -- the `@actions/*` import boundary):

- `ActionsCoreLive`
- `ActionsGitHubLive`
- `ActionsCacheLive`
- `ActionsExecLive`
- `ActionsToolCacheLive`
- `OctokitAuthAppLive`
- `ActionsPlatformLive`

### Build configuration

Add the subpath to `package.json` `exports`:

```json
"exports": {
  ".": "./src/index.ts",
  "./testing": "./src/testing.ts"
}
```

The rslib-builder picks up multi-entry exports and generates the correct
subpath in the published `package.json`. No changes to `rslib.config.ts`
needed.

### Testing the boundary

Add an integration test that verifies `src/testing.ts` can be imported
without any `@actions/*` packages available. This prevents regressions where
a future change accidentally adds a direct `@actions/*` import to a file
that `testing.ts` re-exports.

Implementation: a Vitest test that uses `vi.mock` to make all `@actions/*`
and `@octokit/*` imports throw, then dynamically imports `./testing.ts` and
asserts it resolves without error.

## Documentation

### 1. Update `docs/testing.md`

- Add a section at the top explaining the `/testing` subpath and when to use
  it vs the main entry point
- Update all import examples to use `@savvy-web/github-action-effects/testing`
  for test-only imports
- Add a new section on "Integration testing with Live layers" showing how to
  use Live layers with mock wrapper services
- Replace the "Testing the Live Layer" section (which uses `vi.mock` on
  `@actions/core`) with the new pattern using mock wrapper services

### 2. Update `docs/example-action.md`

- Add a "Testing" section (before "Next Steps") showing how to test the
  example action using `/testing` imports and test layers
- Include a complete test file for the example action's `program`

### 3. Update `docs/advanced-action.md`

- Add a "Testing" section showing how to test multi-phase actions
- Demonstrate testing each phase independently with `ActionStateTest` for
  pre-populated state
- Show integration testing with Live layers + mock `ActionsCore`
- Show span assertions with `InMemoryTracer`

### 4. Update `docs/architecture.md` and `docs/peer-dependencies.md`

- Document the platform wrapper services and their purpose
- Update the layer composition diagrams to show the wrapper layer
- Document `ActionsPlatformLive` and custom platform injection

## Migration

This is a **breaking change** for consumers who import Live layers and compose
them manually outside of `Action.run()`. The refactored Live layers have new
type signatures that require wrapper service dependencies.

**Consumers using `Action.run()` (most common -- no change needed):**

```typescript
// This continues to work unchanged.
// Action.run() auto-provides ActionsPlatformLive to all layers.
Action.run(program);
Action.run(program, ActionStateLive);
Action.run(program, Layer.mergeAll(ActionStateLive, DryRunLive));
```

`Action.run()` provides `ActionsPlatformLive` as a base layer that satisfies
all wrapper service requirements. User-supplied layers are composed on top,
and `ActionsPlatformLive` is provided to the entire merged stack. This means
even Live layers passed as the second argument (like `ActionStateLive` which
now requires `ActionsCore`) are satisfied automatically.

**Consumers composing layers manually (rare -- requires update):**

```typescript
// Before: Layer types had no wrapper dependencies
const myLayer: Layer.Layer<ActionState> = ActionStateLive;

// After: Layer types include wrapper dependencies
const myLayer: Layer.Layer<ActionState, never, ActionsCore> = ActionStateLive;

// Provide wrapper services explicitly
const fullyResolved = myLayer.pipe(
  Layer.provide(ActionsCoreLive),
);
```

This warrants a **minor version bump** (0.9.0) since the library is pre-1.0.

## Success criteria

1. No file in `src/` except the 6 wrapper `*Live` layers and
   `ActionsPlatformLive` directly imports `@actions/*` or `@octokit/*`
   (including type-only imports)
2. Consumer test files can import from
   `@savvy-web/github-action-effects/testing` without triggering any
   `@actions/*` module resolution
3. The `/testing` subpath exports all service tags (30), all wrapper service
   tags (6), all Live layers (32), all test layers, all errors, all schemas,
   all utils, `InMemoryTracer`, `Action`, `ActionLoggerLayer`, and all
   companion types
4. The main entry point (`.`) continues to export everything including the
   wrapper Live layers and `ActionsPlatformLive`
5. `Action.run()` works unchanged for consumers who don't override the
   platform (backwards-compatible)
6. `Action.run()` accepts a `platform` option for consumers who need custom
   `@actions/*` injection
7. `Action.run()` auto-provides `ActionsPlatformLive` to user-supplied
   layers, so `Action.run(program, ActionStateLive)` works without explicit
   wrapper provision
8. The package builds successfully with both entry points
9. An integration test verifies the `/testing` import boundary
10. Documentation is updated with examples for both unit and integration
    testing patterns
11. All existing tests pass (updated to use wrapper services where needed)
