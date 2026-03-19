# Testing Exports with Platform Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap `@actions/*` packages in Effect services so Live layers use DI, then add a `./testing` subpath export that excludes only the wrapper Live layers.

**Architecture:** Six new wrapper services (`ActionsCore`, `ActionsGitHub`, `ActionsCache`, `ActionsExec`, `ActionsToolCache`, `OctokitAuthApp`) abstract `@actions/*` packages. Existing Live layers switch from static imports to `yield*` on wrapper services. A `./testing` entry point re-exports everything except the 7 files that import `@actions/*`.

**Tech Stack:** Effect-TS (Context.Tag, Layer.effect, Layer.unwrapEffect), rslib-builder (multi-entry exports), Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-testing-exports-design.md`

---

## File Map

### New files

| File | Responsibility |
| --- | --- |
| `src/services/ActionsCore.ts` | Wrapper service tag for `@actions/core` |
| `src/services/ActionsGitHub.ts` | Wrapper service tag for `@actions/github` |
| `src/services/ActionsCache.ts` | Wrapper service tag for `@actions/cache` |
| `src/services/ActionsExec.ts` | Wrapper service tag for `@actions/exec` |
| `src/services/ActionsToolCache.ts` | Wrapper service tag for `@actions/tool-cache` |
| `src/services/OctokitAuthApp.ts` | Wrapper service tag for `@octokit/auth-app` |
| `src/layers/ActionsCoreLive.ts` | Static import of `@actions/core`, provides `ActionsCore` |
| `src/layers/ActionsGitHubLive.ts` | Static import of `@actions/github`, provides `ActionsGitHub` |
| `src/layers/ActionsCacheLive.ts` | Static import of `@actions/cache`, provides `ActionsCache` |
| `src/layers/ActionsExecLive.ts` | Static import of `@actions/exec`, provides `ActionsExec` |
| `src/layers/ActionsToolCacheLive.ts` | Static import of `@actions/tool-cache`, provides `ActionsToolCache` |
| `src/layers/OctokitAuthAppLive.ts` | Static import of `@octokit/auth-app`, provides `OctokitAuthApp` |
| `src/layers/ActionsPlatformLive.ts` | Merges all 6 wrapper Live layers |
| `src/testing.ts` | Testing entry point (re-exports minus wrapper Live layers) |
| `src/testing.test.ts` | Boundary integration test |

### Modified files

| File | Change |
| --- | --- |
| `src/layers/ActionInputsLive.ts` | `Layer.succeed` -> `Layer.effect` with `yield* ActionsCore` |
| `src/layers/ActionOutputsLive.ts` | Same pattern |
| `src/layers/ActionStateLive.ts` | Same pattern |
| `src/layers/ActionLoggerLive.ts` | Closure pattern: pass `ActionsCore` to helpers, `Layer.unwrapEffect` for `ActionLoggerLayer` |
| `src/layers/ActionCacheLive.ts` | `Layer.effect` with `yield* ActionsCache` |
| `src/layers/CommandRunnerLive.ts` | `Layer.effect` with `yield* ActionsExec`, define `ActionsExecOptions` locally |
| `src/layers/GitHubClientLive.ts` | Factory function returns `Layer.Layer<..., ..., ActionsGitHub>` |
| `src/layers/GitHubAppLive.ts` | `Layer.effect` with `yield* OctokitAuthApp` |
| `src/layers/ToolInstallerLive.ts` | `Layer.effect` with `yield* ActionsCore` + `yield* ActionsToolCache` |
| `src/Action.ts` | Remove `@actions/core` import; use `ActionsCore` via DI; new `run()` signature |
| `src/services/ActionLogger.ts` | Import `AnnotationProperties` from `ActionsCore.ts` instead of `@actions/core` |
| `src/layers/ActionLoggerTest.ts` | Import `AnnotationProperties` from `ActionsCore.ts` instead of `@actions/core` |
| `src/index.ts` | Add exports for all new services, wrapper Live layers, and `ActionsPlatformLive` |
| `package.json` | Add `"./testing"` to exports map |
| `src/layers/ActionInputsLive.test.ts` | Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer |
| `src/layers/ActionOutputsLive.test.ts` | Same pattern |
| `src/layers/ActionStateLive.test.ts` | Same pattern |
| `src/layers/ActionLoggerLive.test.ts` | Same pattern |
| `src/layers/ActionCacheLive.test.ts` | Replace `vi.mock("@actions/cache")` |
| `src/layers/CommandRunnerLive.test.ts` | Replace `vi.mock("@actions/exec")` |
| `src/layers/GitHubClientLive.test.ts` | Replace `vi.mock("@actions/github")` |
| `src/layers/GitHubAppLive.test.ts` | Replace `vi.mock("@octokit/auth-app")` |
| `src/layers/ToolInstallerLive.test.ts` | Replace both `vi.mock` calls |
| `src/Action.test.ts` | Update for new `Action.run()` signature |
| `src/Action.run.test.ts` | Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer |
| `src/Action.otel.test.ts` | Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer |

---

### Task 1: Create ActionsCore wrapper service and Live layer

**Files:**

- Create: `src/services/ActionsCore.ts`
- Create: `src/layers/ActionsCoreLive.ts`

This is the most-used wrapper (5 Live layers + Action.ts depend on it). The
`AnnotationProperties` type is defined here so `ActionLogger.ts` can stop
importing it from `@actions/core`.

- [ ] **Step 1: Create `src/services/ActionsCore.ts`**

```typescript
import { Context } from "effect";

/**
 * Properties for file/line annotations in the GitHub Actions UI.
 *
 * @public
 */
export interface AnnotationProperties {
 readonly title?: string;
 readonly file?: string;
 readonly startLine?: number;
 readonly endLine?: number;
 readonly startColumn?: number;
 readonly endColumn?: number;
}

/**
 * Wrapper service for `@actions/core`.
 *
 * Consumers provide this via {@link ActionsCoreLive} (standard) or a mock
 * layer (testing). Live layers depend on this service instead of importing
 * `@actions/core` directly.
 *
 * @public
 */
export class ActionsCore extends Context.Tag("github-action-effects/ActionsCore")<
 ActionsCore,
 {
  readonly getInput: (name: string, options?: { required?: boolean; trimWhitespace?: boolean }) => string;
  readonly getMultilineInput: (
   name: string,
   options?: { required?: boolean; trimWhitespace?: boolean },
  ) => string[];
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

- [ ] **Step 2: Create `src/layers/ActionsCoreLive.ts`**

```typescript
import * as core from "@actions/core";
import { Layer } from "effect";
import { ActionsCore } from "../services/ActionsCore.js";

/**
 * Live implementation of {@link ActionsCore} using `@actions/core`.
 *
 * @public
 */
export const ActionsCoreLive: Layer.Layer<ActionsCore> = Layer.succeed(ActionsCore, core);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm tsgo --noEmit`

Expected: PASS (new files compile, no consumers yet)

- [ ] **Step 4: Commit**

```text
feat: add ActionsCore wrapper service and Live layer
```

---

### Task 2: Create remaining 5 wrapper services and Live layers

**Files:**

- Create: `src/services/ActionsGitHub.ts`
- Create: `src/services/ActionsCache.ts`
- Create: `src/services/ActionsExec.ts`
- Create: `src/services/ActionsToolCache.ts`
- Create: `src/services/OctokitAuthApp.ts`
- Create: `src/layers/ActionsGitHubLive.ts`
- Create: `src/layers/ActionsCacheLive.ts`
- Create: `src/layers/ActionsExecLive.ts`
- Create: `src/layers/ActionsToolCacheLive.ts`
- Create: `src/layers/OctokitAuthAppLive.ts`

- [ ] **Step 1: Create `src/services/ActionsGitHub.ts`**

Examine `src/layers/GitHubClientLive.ts` to see what methods are used from
`@actions/github`. Only `github.getOctokit(token)` is called. The return type
must preserve `.graphql<T>()`, `.rest`, and `.request()`.

```typescript
import { Context } from "effect";

/**
 * The Octokit instance type returned by `@actions/github.getOctokit()`.
 *
 * Uses a structural type capturing the methods actually used by
 * GitHubClientLive: `graphql`, and the rest/request interface exposed
 * via the `fn: (octokit) => Promise<...>` callback pattern.
 *
 * @public
 */
export type GitHubOctokit = {
 readonly graphql: <T>(query: string, parameters?: Record<string, unknown>) => Promise<T>;
 readonly rest: unknown;
 readonly request: unknown;
};

/**
 * Wrapper service for `@actions/github`.
 *
 * @public
 */
export class ActionsGitHub extends Context.Tag("github-action-effects/ActionsGitHub")<
 ActionsGitHub,
 {
  readonly getOctokit: (token: string) => GitHubOctokit;
 }
>() {}
```

- [ ] **Step 2: Create `src/layers/ActionsGitHubLive.ts`**

```typescript
import * as github from "@actions/github";
import { Layer } from "effect";
import { ActionsGitHub } from "../services/ActionsGitHub.js";

/**
 * Live implementation of {@link ActionsGitHub} using `@actions/github`.
 *
 * @public
 */
export const ActionsGitHubLive: Layer.Layer<ActionsGitHub> = Layer.succeed(ActionsGitHub, {
 getOctokit: (token) => github.getOctokit(token),
});
```

- [ ] **Step 3: Create `src/services/ActionsCache.ts`**

Examine `src/layers/ActionCacheLive.ts`. Uses `cache.saveCache(paths, key)`
and `cache.restoreCache(paths, key, restoreKeys)`.

```typescript
import { Context } from "effect";

/**
 * Wrapper service for `@actions/cache`.
 *
 * @public
 */
export class ActionsCache extends Context.Tag("github-action-effects/ActionsCache")<
 ActionsCache,
 {
  readonly saveCache: (paths: string[], key: string) => Promise<number>;
  readonly restoreCache: (
   paths: string[],
   primaryKey: string,
   restoreKeys?: string[],
  ) => Promise<string | undefined>;
 }
>() {}
```

- [ ] **Step 4: Create `src/layers/ActionsCacheLive.ts`**

```typescript
import * as cache from "@actions/cache";
import { Layer } from "effect";
import { ActionsCache } from "../services/ActionsCache.js";

/**
 * Live implementation of {@link ActionsCache} using `@actions/cache`.
 *
 * @public
 */
export const ActionsCacheLive: Layer.Layer<ActionsCache> = Layer.succeed(ActionsCache, {
 saveCache: (paths, key) => cache.saveCache(paths, key),
 restoreCache: (paths, primaryKey, restoreKeys) => cache.restoreCache(paths, primaryKey, restoreKeys),
});
```

- [ ] **Step 5: Create `src/services/ActionsExec.ts`**

Examine `src/layers/CommandRunnerLive.ts`. Uses `actionsExec.exec()` with
an options object. The `ExecOptions` type from `@actions/exec` is used as
a type-only import — define the subset locally.

```typescript
import { Context } from "effect";

/**
 * Options for command execution, subset of `@actions/exec` ExecOptions.
 *
 * @public
 */
export interface ActionsExecOptions {
 readonly cwd?: string;
 readonly env?: Record<string, string>;
 readonly silent?: boolean;
 readonly ignoreReturnCode?: boolean;
 readonly input?: Buffer;
 readonly listeners?: {
  stdout?: (data: Buffer) => void;
  stderr?: (data: Buffer) => void;
 };
}

/**
 * Wrapper service for `@actions/exec`.
 *
 * @public
 */
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

- [ ] **Step 6: Create `src/layers/ActionsExecLive.ts`**

```typescript
import * as actionsExec from "@actions/exec";
import { Layer } from "effect";
import { ActionsExec } from "../services/ActionsExec.js";

/**
 * Live implementation of {@link ActionsExec} using `@actions/exec`.
 *
 * @public
 */
export const ActionsExecLive: Layer.Layer<ActionsExec> = Layer.succeed(ActionsExec, {
 exec: (commandLine, args, options) => actionsExec.exec(commandLine, args, options),
});
```

- [ ] **Step 7: Create `src/services/ActionsToolCache.ts`**

Examine `src/layers/ToolInstallerLive.ts`. Uses `tc.find`, `tc.downloadTool`,
`tc.extractTar` (with optional flags for xz), `tc.extractZip`, `tc.cacheDir`.

```typescript
import { Context } from "effect";

/**
 * Wrapper service for `@actions/tool-cache`.
 *
 * @public
 */
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

- [ ] **Step 8: Create `src/layers/ActionsToolCacheLive.ts`**

```typescript
import * as tc from "@actions/tool-cache";
import { Layer } from "effect";
import { ActionsToolCache } from "../services/ActionsToolCache.js";

/**
 * Live implementation of {@link ActionsToolCache} using `@actions/tool-cache`.
 *
 * @public
 */
export const ActionsToolCacheLive: Layer.Layer<ActionsToolCache> = Layer.succeed(ActionsToolCache, {
 find: (toolName, versionSpec) => tc.find(toolName, versionSpec),
 downloadTool: (url) => tc.downloadTool(url),
 extractTar: (file, dest, flags) => tc.extractTar(file, dest, flags),
 extractZip: (file, dest) => tc.extractZip(file, dest),
 cacheDir: (sourceDir, tool, version) => tc.cacheDir(sourceDir, tool, version),
});
```

- [ ] **Step 9: Create `src/services/OctokitAuthApp.ts`**

Examine `src/layers/GitHubAppLive.ts`. Uses `createAppAuth({ appId, privateKey })`
which returns an auth function with two overloads: `{ type: "app" }` returns
`{ token }`, `{ type: "installation", installationId }` returns
`{ token, expiresAt, installationId, permissions }`.

```typescript
import { Context } from "effect";

/**
 * Auth function returned by `createAppAuth`.
 *
 * @public
 */
export interface AppAuth {
 (options: { type: "app" }): Promise<{ token: string }>;
 (options: { type: "installation"; installationId: number }): Promise<{
  token: string;
  expiresAt: string;
  installationId: number;
  permissions: Record<string, string>;
 }>;
}

/**
 * Wrapper service for `@octokit/auth-app`.
 *
 * @public
 */
export class OctokitAuthApp extends Context.Tag("github-action-effects/OctokitAuthApp")<
 OctokitAuthApp,
 {
  readonly createAppAuth: (options: { appId: string; privateKey: string }) => AppAuth;
 }
>() {}
```

- [ ] **Step 10: Create `src/layers/OctokitAuthAppLive.ts`**

```typescript
import { createAppAuth } from "@octokit/auth-app";
import { Layer } from "effect";
import { OctokitAuthApp } from "../services/OctokitAuthApp.js";

/**
 * Live implementation of {@link OctokitAuthApp} using `@octokit/auth-app`.
 *
 * @public
 */
export const OctokitAuthAppLive: Layer.Layer<OctokitAuthApp> = Layer.succeed(OctokitAuthApp, {
 createAppAuth: (options) => createAppAuth(options) as ReturnType<typeof OctokitAuthApp.Service["createAppAuth"]>,
});
```

Note: The `as` cast may be needed because `@octokit/auth-app`'s `createAppAuth`
return type is more complex than our simplified `AppAuth` interface. Verify
during implementation and adjust the interface if needed.

- [ ] **Step 11: Verify typecheck**

Run: `pnpm tsgo --noEmit`

Expected: PASS

- [ ] **Step 12: Commit**

```text
feat: add wrapper services for GitHub, Cache, Exec, ToolCache, and AuthApp
```

---

### Task 3: Create ActionsPlatformLive bundle

**Files:**

- Create: `src/layers/ActionsPlatformLive.ts`

- [ ] **Step 1: Create `src/layers/ActionsPlatformLive.ts`**

```typescript
import { Layer } from "effect";
import type { ActionsCache } from "../services/ActionsCache.js";
import type { ActionsCore } from "../services/ActionsCore.js";
import type { ActionsExec } from "../services/ActionsExec.js";
import type { ActionsGitHub } from "../services/ActionsGitHub.js";
import type { ActionsToolCache } from "../services/ActionsToolCache.js";
import type { OctokitAuthApp } from "../services/OctokitAuthApp.js";
import { ActionsCacheLive } from "./ActionsCacheLive.js";
import { ActionsCoreLive } from "./ActionsCoreLive.js";
import { ActionsExecLive } from "./ActionsExecLive.js";
import { ActionsGitHubLive } from "./ActionsGitHubLive.js";
import { ActionsToolCacheLive } from "./ActionsToolCacheLive.js";
import { OctokitAuthAppLive } from "./OctokitAuthAppLive.js";

/**
 * Union of all platform wrapper services.
 *
 * @public
 */
export type ActionsPlatform =
 | ActionsCore
 | ActionsGitHub
 | ActionsCache
 | ActionsExec
 | ActionsToolCache
 | OctokitAuthApp;

/**
 * Convenience layer that provides all platform wrapper services.
 *
 * @public
 */
export const ActionsPlatformLive: Layer.Layer<ActionsPlatform> = Layer.mergeAll(
 ActionsCoreLive,
 ActionsGitHubLive,
 ActionsCacheLive,
 ActionsExecLive,
 ActionsToolCacheLive,
 OctokitAuthAppLive,
);
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsgo --noEmit`

- [ ] **Step 3: Commit**

```text
feat: add ActionsPlatformLive convenience bundle
```

---

### Task 4: Refactor ActionInputsLive to use ActionsCore

**Files:**

- Modify: `src/layers/ActionInputsLive.ts`
- Modify: `src/layers/ActionInputsLive.test.ts`

- [ ] **Step 1: Refactor `ActionInputsLive`**

Replace `import * as core from "@actions/core"` with
`import { ActionsCore } from "../services/ActionsCore.js"`. Change
`Layer.succeed` to `Layer.effect` with `yield* ActionsCore`.

The `core` reference is captured at layer construction and closed over by
all service methods. All `core.getInput(...)`, `core.getMultilineInput(...)`,
`core.setSecret(...)` calls become `core.getInput(...)` etc. using the
captured reference.

- [ ] **Step 2: Update test file**

Replace `vi.mock("@actions/core")` with a mock `ActionsCore` layer. Instead
of `vi.mocked(getInput).mockReturnValue(...)`, use a factory function that
builds a mock `ActionsCore` layer with the desired behavior.

Pattern:

```typescript
import { Effect, Layer } from "effect";
import { ActionsCore } from "../services/ActionsCore.js";

const mockCore = (overrides: Partial<Context.Tag.Service<ActionsCore>> = {}) =>
 Layer.succeed(ActionsCore, {
  getInput: () => "",
  getMultilineInput: () => [],
  getBooleanInput: () => false,
  setOutput: () => {},
  setFailed: () => {},
  exportVariable: () => {},
  addPath: () => {},
  setSecret: () => {},
  info: () => {},
  debug: () => {},
  warning: () => {},
  error: () => {},
  notice: () => {},
  startGroup: () => {},
  endGroup: () => {},
  getState: () => "",
  saveState: () => {},
  summary: { write: () => Promise.resolve(), addRaw: () => ({}) },
  ...overrides,
 });
```

Then in each test:

```typescript
const run = <A, E>(effect: Effect.Effect<A, E, ActionInputs>, coreOverrides = {}) =>
 Effect.runPromise(
  Effect.provide(effect, ActionInputsLive.pipe(Layer.provide(mockCore(coreOverrides)))),
 );

it("reads and decodes an input", async () => {
 const getInput = vi.fn().mockReturnValue("hello");
 const result = await run(
  Effect.flatMap(ActionInputs, (svc) => svc.get("name", Schema.String)),
  { getInput },
 );
 expect(result).toBe("hello");
 expect(getInput).toHaveBeenCalledWith("name", { required: true });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/ActionInputsLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: ActionInputsLive uses ActionsCore DI instead of @actions/core
```

---

### Task 5: Refactor ActionOutputsLive to use ActionsCore

**Files:**

- Modify: `src/layers/ActionOutputsLive.ts`
- Modify: `src/layers/ActionOutputsLive.test.ts`

Same pattern as Task 4. Replace `import * as core` with `yield* ActionsCore`.
Update tests to provide mock `ActionsCore` layer instead of `vi.mock`.

- [ ] **Step 1: Refactor `ActionOutputsLive`**

- [ ] **Step 2: Update test file**

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/ActionOutputsLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: ActionOutputsLive uses ActionsCore DI instead of @actions/core
```

---

### Task 6: Refactor ActionStateLive to use ActionsCore

**Files:**

- Modify: `src/layers/ActionStateLive.ts`
- Modify: `src/layers/ActionStateLive.test.ts`

Same pattern as Task 4.

- [ ] **Step 1: Refactor `ActionStateLive`**

- [ ] **Step 2: Update test file**

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/ActionStateLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: ActionStateLive uses ActionsCore DI instead of @actions/core
```

---

### Task 7: Refactor ActionLoggerLive to use ActionsCore (complex)

**Files:**

- Modify: `src/services/ActionLogger.ts`
- Modify: `src/layers/ActionLoggerLive.ts`
- Modify: `src/layers/ActionLoggerLive.test.ts`
- Modify: `src/layers/ActionLoggerTest.ts`

This is the most complex refactor. See spec "Pattern B" for details.

- [ ] **Step 1: Update `src/services/ActionLogger.ts` and `src/layers/ActionLoggerTest.ts`**

In both files, replace `import type { AnnotationProperties } from "@actions/core"`
with `import type { AnnotationProperties } from "../services/ActionsCore.js"`
(adjust path for each file).

- [ ] **Step 2: Refactor `ActionLoggerLive`**

Key changes:

1. `emitToGitHub(level, message)` becomes
   `emitToGitHub(core, level, message)` — takes core as first arg
2. `makeActionLogger()` becomes `makeActionLogger(core)` — takes core,
   closes over it in `Logger.make` callback
3. `flushBuffer(label, buffer)` becomes
   `flushBuffer(core, label, buffer)` — takes core
4. `ActionLoggerLayer` changes from a module-level constant to:

```typescript
export const ActionLoggerLayer: Layer.Layer<never, never, ActionsCore> =
 Layer.unwrapEffect(
  Effect.gen(function* () {
   const core = yield* ActionsCore;
   return Logger.replace(Logger.defaultLogger, makeActionLogger(core));
  }),
 );
```

1. `ActionLoggerLive` changes from `Layer.succeed` to `Layer.effect` —
   captures `core` at construction, passes it to `emitToGitHub`,
   `flushBuffer`, and all annotation methods.

- [ ] **Step 3: Update test file**

Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer.
The test currently imports `startGroup`, `endGroup` etc. from
`@actions/core` and checks they were called — change to check the
mock `ActionsCore` methods were called instead.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/layers/ActionLoggerLive.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```text
refactor: ActionLoggerLive uses ActionsCore DI with closure pattern
```

---

### Task 8: Refactor ActionCacheLive to use ActionsCache

**Files:**

- Modify: `src/layers/ActionCacheLive.ts`
- Modify: `src/layers/ActionCacheLive.test.ts`

- [ ] **Step 1: Refactor `ActionCacheLive`**

Replace `import * as cache from "@actions/cache"` with
`import { ActionsCache } from "../services/ActionsCache.js"`.
Change `Layer.succeed` to `Layer.effect` with `yield* ActionsCache`.

- [ ] **Step 2: Update test file**

Replace `vi.mock("@actions/cache")` with mock `ActionsCache` layer.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/ActionCacheLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: ActionCacheLive uses ActionsCache DI instead of @actions/cache
```

---

### Task 9: Refactor CommandRunnerLive to use ActionsExec

**Files:**

- Modify: `src/layers/CommandRunnerLive.ts`
- Modify: `src/layers/CommandRunnerLive.test.ts`

- [ ] **Step 1: Refactor `CommandRunnerLive`**

Remove both imports from `@actions/exec`:

- `import type { ExecOptions as ActionsExecOptions } from "@actions/exec"` —
  use `ActionsExecOptions` from `ActionsExec.ts` instead
- `import * as actionsExec from "@actions/exec"` — use `yield* ActionsExec`

- [ ] **Step 2: Update test file**

Replace `vi.mock("@actions/exec")` with mock `ActionsExec` layer.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/CommandRunnerLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: CommandRunnerLive uses ActionsExec DI instead of @actions/exec
```

---

### Task 10: Refactor GitHubClientLive to use ActionsGitHub

**Files:**

- Modify: `src/layers/GitHubClientLive.ts`
- Modify: `src/layers/GitHubClientLive.test.ts`

- [ ] **Step 1: Refactor `GitHubClientLive`**

This is a factory function `(token: string) => Layer.Layer<GitHubClient>`.
After refactoring: `(token: string) => Layer.Layer<GitHubClient, GitHubClientError, ActionsGitHub>`.

Replace `github.getOctokit(token)` with `gh.getOctokit(token)` where `gh`
comes from `yield* ActionsGitHub`.

- [ ] **Step 2: Update test file**

Replace `vi.mock("@actions/github")` with mock `ActionsGitHub` layer.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/GitHubClientLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: GitHubClientLive uses ActionsGitHub DI instead of @actions/github
```

---

### Task 11: Refactor ToolInstallerLive to use ActionsCore + ActionsToolCache

**Files:**

- Modify: `src/layers/ToolInstallerLive.ts`
- Modify: `src/layers/ToolInstallerLive.test.ts`

- [ ] **Step 1: Refactor `ToolInstallerLive`**

Replace both imports:

- `import * as core from "@actions/core"` -> `yield* ActionsCore`
  (used for `core.addPath`)
- `import * as tc from "@actions/tool-cache"` -> `yield* ActionsToolCache`

Both are captured at `Layer.effect` construction time.

- [ ] **Step 2: Update test file**

Replace both `vi.mock` calls with mock `ActionsCore` and
`ActionsToolCache` layers.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/ToolInstallerLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: ToolInstallerLive uses ActionsCore + ActionsToolCache DI
```

---

### Task 12: Refactor GitHubAppLive to use OctokitAuthApp

**Files:**

- Modify: `src/layers/GitHubAppLive.ts`
- Modify: `src/layers/GitHubAppLive.test.ts`

- [ ] **Step 1: Refactor `GitHubAppLive`**

Replace `import { createAppAuth } from "@octokit/auth-app"` with
`yield* OctokitAuthApp`. The `createAppAuth` call in `generateToken`
becomes `authApp.createAppAuth({ appId, privateKey })` where `authApp`
is captured at layer construction.

- [ ] **Step 2: Update test file**

Replace `vi.mock("@octokit/auth-app")` with mock `OctokitAuthApp` layer.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/layers/GitHubAppLive.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```text
refactor: GitHubAppLive uses OctokitAuthApp DI instead of @octokit/auth-app
```

---

### Task 13: Refactor Action.ts and its tests

**Files:**

- Modify: `src/Action.ts`
- Modify: `src/Action.test.ts`
- Modify: `src/Action.run.test.ts`
- Modify: `src/Action.otel.test.ts`

- [ ] **Step 1: Refactor `Action.ts`**

Key changes:

1. Remove `import * as core from "@actions/core"`.
2. Import `ActionsCore` service tag, `ActionsPlatformLive`, and
   `ActionsPlatform` type.
3. Remove import of `ActionInputsLive`, `ActionLoggerLive`,
   `ActionOutputsLive` — these are still used in `CoreLive` but now
   depend on `ActionsCore`.
4. Move OTel config reading (`core.getInput("otel-enabled")` etc.) inside
   the Effect pipeline via `yield* ActionsCore`.
5. Move error handling (`core.setFailed`, `core.debug`) inside the Effect
   pipeline.
6. Change `Action.run()` signature: second arg becomes options object
   `{ layer?, platform? }`.
7. `CoreLive` is provided `ActionsPlatformLive` (or user-supplied platform).
8. `ActionLoggerLayer` is composed after platform since it now requires
   `ActionsCore`.

New `Action.run` implementation sketch:

```typescript
run: (program, options?) => {
 const platformLayer = options?.platform ?? ActionsPlatformLive;
 const userLayer = options?.layer;

 const runnable = Effect.gen(function* () {
  const core = yield* ActionsCore;

  // Read OTel config via ActionsCore
  const otelEnabled = (core.getInput("otel-enabled") || "auto") as OtelEnabled;
  // ... build otelLayer ...

  // Run the buffered program
  const logger = yield* ActionLogger;
  yield* logger.withBuffer("action", program);
 }).pipe(
  Effect.onExit((exit) => writeTelemetrySummary),
  Effect.provide(Layer.mergeAll(CoreLive, ...)),
  Effect.provide(ActionLoggerLayer),
  Effect.provide(platformLayer),
  Effect.catchAllCause((cause) => {
   // Error handling also via ActionsCore in the pipeline
  }),
 );
 // ...
};
```

Note: The exact implementation will need careful attention to layer ordering
and the error handler (which currently calls `core.setFailed` outside the
Effect pipeline). The error handler may need to be restructured so that
`ActionsCore` is accessible within the `catchAllCause` callback. One approach:
read `ActionsCore` in the outer Effect and close over it.

- [ ] **Step 2: Update `src/Action.test.ts`**

Update tests for the new `Action.run()` signature (options object instead of
bare layer argument).

- [ ] **Step 3: Update `src/Action.run.test.ts`**

Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer. Update
assertions to use the mock wrapper service instead of mocked core functions.

- [ ] **Step 4: Update `src/Action.otel.test.ts`**

Replace `vi.mock("@actions/core")` with mock `ActionsCore` layer.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm tsgo --noEmit`

Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm vitest run`

Expected: PASS

- [ ] **Step 7: Commit**

```text
refactor: Action.run uses ActionsCore DI and options-based API
```

---

### Task 14: Update `src/index.ts` with new exports

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add exports for all new services and wrapper layers**

Add to the appropriate sections:

```typescript
// -- Platform Services --
export type { AnnotationProperties } from "./services/ActionsCore.js";
export { ActionsCore } from "./services/ActionsCore.js";
export type { ActionsExecOptions } from "./services/ActionsExec.js";
export { ActionsExec } from "./services/ActionsExec.js";
export type { GitHubOctokit } from "./services/ActionsGitHub.js";
export { ActionsGitHub } from "./services/ActionsGitHub.js";
export { ActionsCache } from "./services/ActionsCache.js";
export { ActionsToolCache } from "./services/ActionsToolCache.js";
export type { AppAuth } from "./services/OctokitAuthApp.js";
export { OctokitAuthApp } from "./services/OctokitAuthApp.js";
// -- Platform Layers --
export { ActionsCoreLive } from "./layers/ActionsCoreLive.js";
export { ActionsGitHubLive } from "./layers/ActionsGitHubLive.js";
export { ActionsCacheLive } from "./layers/ActionsCacheLive.js";
export { ActionsExecLive } from "./layers/ActionsExecLive.js";
export { ActionsToolCacheLive } from "./layers/ActionsToolCacheLive.js";
export { OctokitAuthAppLive } from "./layers/OctokitAuthAppLive.js";
export type { ActionsPlatform } from "./layers/ActionsPlatformLive.js";
export { ActionsPlatformLive } from "./layers/ActionsPlatformLive.js";
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm tsgo --noEmit`

Expected: PASS

- [ ] **Step 3: Commit**

```text
feat: export platform wrapper services and layers from index
```

---

### Task 15: Create `src/testing.ts` and update `package.json`

**Files:**

- Create: `src/testing.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/testing.ts`**

Copy all exports from `src/index.ts` **except** the 7 wrapper Live layers
and `ActionsPlatformLive`:

Excluded lines (do NOT include):

- `export { ActionsCoreLive } from ...`
- `export { ActionsGitHubLive } from ...`
- `export { ActionsCacheLive } from ...`
- `export { ActionsExecLive } from ...`
- `export { ActionsToolCacheLive } from ...`
- `export { OctokitAuthAppLive } from ...`
- `export { ActionsPlatformLive } from ...`

Everything else from `src/index.ts` is included.

- [ ] **Step 2: Update `package.json` exports**

Change:

```json
"exports": {
 ".": "./src/index.ts"
}
```

To:

```json
"exports": {
 ".": "./src/index.ts",
 "./testing": "./src/testing.ts"
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm tsgo --noEmit`

Expected: PASS

Note: `testing.ts` is a manual copy of `index.ts` minus 7 lines. When new
exports are added to `index.ts` in the future, `testing.ts` must be updated
too. The boundary integration test (Task 16) catches regressions where a
new export accidentally imports `@actions/*`.

- [ ] **Step 4: Commit**

```text
feat: add ./testing subpath export without @actions/* dependencies
```

---

### Task 16: Add boundary integration test

**Files:**

- Create: `src/testing.test.ts`

- [ ] **Step 1: Write the test**

This test verifies that importing from `./testing.ts` does not trigger
any `@actions/*` module resolution.

```typescript
import { describe, expect, it, vi } from "vitest";

// Make all @actions/* and @octokit/* imports throw
vi.mock("@actions/core", () => {
 throw new Error("@actions/core should not be imported by testing entry point");
});
vi.mock("@actions/cache", () => {
 throw new Error("@actions/cache should not be imported by testing entry point");
});
vi.mock("@actions/exec", () => {
 throw new Error("@actions/exec should not be imported by testing entry point");
});
vi.mock("@actions/github", () => {
 throw new Error("@actions/github should not be imported by testing entry point");
});
vi.mock("@actions/tool-cache", () => {
 throw new Error("@actions/tool-cache should not be imported by testing entry point");
});
vi.mock("@octokit/auth-app", () => {
 throw new Error("@octokit/auth-app should not be imported by testing entry point");
});

describe("testing entry point", () => {
 it("can be imported without @actions/* packages", async () => {
  const testingModule = await import("./testing.js");
  // Spot-check key exports
  expect(testingModule.ActionInputs).toBeDefined();
  expect(testingModule.ActionInputsTest).toBeDefined();
  expect(testingModule.ActionInputError).toBeDefined();
  expect(testingModule.ActionsCore).toBeDefined();
  expect(testingModule.InMemoryTracer).toBeDefined();
  expect(testingModule.GithubMarkdown).toBeDefined();
 });

 it("does not export wrapper Live layers", async () => {
  const testingModule = await import("./testing.js");
  expect(testingModule).not.toHaveProperty("ActionsCoreLive");
  expect(testingModule).not.toHaveProperty("ActionsGitHubLive");
  expect(testingModule).not.toHaveProperty("ActionsCacheLive");
  expect(testingModule).not.toHaveProperty("ActionsExecLive");
  expect(testingModule).not.toHaveProperty("ActionsToolCacheLive");
  expect(testingModule).not.toHaveProperty("OctokitAuthAppLive");
  expect(testingModule).not.toHaveProperty("ActionsPlatformLive");
 });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm vitest run src/testing.test.ts`

Expected: PASS

- [ ] **Step 3: Commit**

```text
test: add boundary test for ./testing entry point
```

---

### Task 17: Verify full build and test suite

- [ ] **Step 1: Run full lint**

Run: `pnpm run lint`

Expected: PASS (fix any issues)

- [ ] **Step 2: Run full typecheck**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`

Expected: All tests PASS

- [ ] **Step 4: Run build**

Run: `pnpm run build`

Expected: PASS with both entry points in output

- [ ] **Step 5: Verify built output has testing subpath**

Check that `dist/dev/package.json` and `dist/npm/package.json` include the
`./testing` export. Run:

```bash
cat dist/dev/package.json | grep -A2 testing
```

Expected: The exports map includes `"./testing"` pointing to the built file.

- [ ] **Step 6: Verify no `@actions/*` imports in non-wrapper files**

Run a grep to verify the boundary:

```bash
grep -r "from \"@actions/\|from \"@octokit/" src/ --include="*.ts" \
  | grep -v ".test.ts" \
  | grep -v "ActionsCoreLive.ts" \
  | grep -v "ActionsGitHubLive.ts" \
  | grep -v "ActionsCacheLive.ts" \
  | grep -v "ActionsExecLive.ts" \
  | grep -v "ActionsToolCacheLive.ts" \
  | grep -v "OctokitAuthAppLive.ts" \
  | grep -v "ActionsPlatformLive.ts"
```

Expected: No output (no `@actions/*` or `@octokit/*` imports outside the
7 wrapper files)

- [ ] **Step 7: Commit any fixes**

---

### Task 18: Update documentation

**Files:**

- Modify: `docs/testing.md`
- Modify: `docs/example-action.md`
- Modify: `docs/advanced-action.md`
- Modify: `docs/architecture.md`
- Modify: `docs/peer-dependencies.md`

- [ ] **Step 1: Update `docs/testing.md`**

Add a section at the top explaining the `/testing` subpath. Update all import
examples from `"@savvy-web/github-action-effects"` to
`"@savvy-web/github-action-effects/testing"` for test imports. Add a new
"Integration Testing with Live Layers" section showing mock wrapper services.
Replace the old `vi.mock("@actions/core")` section with the new pattern.

- [ ] **Step 2: Update `docs/example-action.md`**

Add a "Testing" section before "Next Steps" showing a complete test file for
the example action using `/testing` imports.

- [ ] **Step 3: Update `docs/advanced-action.md`**

Add a "Testing" section showing multi-phase testing with `ActionStateTest`,
integration testing with mock `ActionsCore`, and span assertions with
`InMemoryTracer`.

- [ ] **Step 4: Update `docs/architecture.md`**

Document the platform wrapper services, their purpose, and the
`ActionsPlatformLive` bundle. Update layer composition diagrams.

- [ ] **Step 5: Update `docs/peer-dependencies.md`**

Document that `@actions/*` packages are now consumed via wrapper services.

- [ ] **Step 6: Run markdown lint**

Run: `pnpm markdownlint-cli2 'docs/**/*.md' --config './lib/configs/.markdownlint-cli2.jsonc'`

Expected: PASS

- [ ] **Step 7: Commit**

```text
docs: update testing, example, and architecture docs for platform abstraction
```
