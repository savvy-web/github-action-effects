# Library Expansion v4: Targeted Gap-Fillers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 focused abstractions (GitHubClient.paginate, GitHubGraphQL, DryRun, NpmRegistry, ErrorAccumulator, WorkspaceDetector) that fill concrete gaps identified across 5 production GitHub Actions.

**Architecture:** Each abstraction follows the established service pattern: interface in `services/`, error in `errors/`, live layer in `layers/`, test layer in `layers/`, schema in `schemas/` where needed. ErrorAccumulator is a utility namespace (no service/layer). GitHubClient.paginate modifies the existing service interface. All methods instrumented with `Effect.withSpan`.

**Tech Stack:** Effect-TS, @actions/github, @effect/platform, vitest

---

## Phase 1: Pure Utilities (No Dependencies)

### Task 1: ErrorAccumulator utility namespace

ErrorAccumulator is a pure utility namespace (like GithubMarkdown) providing "process all items, collect failures" semantics. No service interface, no layers — just exported functions.

**Files:**

- Create: `src/utils/ErrorAccumulator.ts`
- Create: `src/utils/ErrorAccumulator.test.ts`
- Modify: `src/index.ts`

#### Service interface

Not a service — a utility namespace.

```typescript
export const ErrorAccumulator = {
  forEachAccumulate: <A, B, E, R>(
    items: Iterable<A>,
    fn: (item: A) => Effect.Effect<B, E, R>,
  ): Effect.Effect<
    {
      readonly successes: ReadonlyArray<B>;
      readonly failures: ReadonlyArray<{
        readonly item: A;
        readonly error: E;
      }>;
    },
    never,
    R
  > => {
    /* ... */
  },

  forEachAccumulateConcurrent: <A, B, E, R>(
    items: Iterable<A>,
    fn: (item: A) => Effect.Effect<B, E, R>,
    concurrency: number,
  ): Effect.Effect<
    {
      readonly successes: ReadonlyArray<B>;
      readonly failures: ReadonlyArray<{
        readonly item: A;
        readonly error: E;
      }>;
    },
    never,
    R
  > => {
    /* ... */
  },
} as const;
```

#### Implementation details

Both methods use `Effect.forEach` with `Effect.either` to capture successes and failures without short-circuiting. The sequential version uses default concurrency (1), the concurrent version passes `{ concurrency }` to `Effect.forEach`. Results are partitioned into successes (Right values) and failures (Left values with the original item).

```typescript
import { Effect, Either } from "effect";

export const ErrorAccumulator = {
  forEachAccumulate: <A, B, E, R>(
    items: Iterable<A>,
    fn: (item: A) => Effect.Effect<B, E, R>,
  ) =>
    Effect.forEach(Array.from(items), (item) =>
      fn(item).pipe(
        Effect.map((b) => ({ item, result: b })),
        Effect.either,
      ),
    ).pipe(
      Effect.map((results) => {
        const successes: Array<B> = [];
        const failures: Array<{ item: A; error: E }> = [];
        for (const result of results) {
          if (Either.isRight(result)) {
            successes.push(result.right.result);
          } else {
            // Need to recover the item from the Left — but
            // Either.left doesn't have item.
            // Better approach: use catchAll to capture item+error
            // pairs.
          }
        }
        return { successes, failures };
      }),
    ),
} as const;
```

A cleaner approach using tagged results:

```typescript
forEachAccumulate: <A, B, E, R>(
  items: Iterable<A>,
  fn: (item: A) => Effect.Effect<B, E, R>,
) =>
  Effect.forEach(Array.from(items), (item) =>
    fn(item).pipe(
      Effect.map(
        (result): {
          readonly _tag: "success";
          readonly value: B;
        } => ({ _tag: "success", value: result }),
      ),
      Effect.catchAll((error: E) =>
        Effect.succeed({
          _tag: "failure" as const,
          item,
          error,
        }),
      ),
    ),
  ).pipe(
    Effect.map((results) => {
      const successes: Array<B> = [];
      const failures: Array<{ item: A; error: E }> = [];
      for (const r of results) {
        if (r._tag === "success") successes.push(r.value);
        else
          failures.push({
            item: (r as { item: A; error: E }).item,
            error: (r as { item: A; error: E }).error,
          });
      }
      return { successes, failures } as const;
    }),
  ),
```

#### Tests (10 tests)

```typescript
describe("ErrorAccumulator", () => {
  describe("forEachAccumulate", () => {
    it("collects all successes when no failures", async () => {
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulate(
          [1, 2, 3],
          (n) => Effect.succeed(n * 2),
        ),
      );
      expect(result.successes).toEqual([2, 4, 6]);
      expect(result.failures).toEqual([]);
    });

    it("collects all failures when everything fails", async () => {
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulate(
          [1, 2, 3],
          (n) => Effect.fail(`error-${n}`),
        ),
      );
      expect(result.successes).toEqual([]);
      expect(result.failures).toHaveLength(3);
      expect(result.failures[0]).toEqual({
        item: 1,
        error: "error-1",
      });
    });

    it("partitions mixed successes and failures", async () => {
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulate(
          [1, 2, 3, 4],
          (n) =>
            n % 2 === 0
              ? Effect.succeed(n)
              : Effect.fail(`odd-${n}`),
        ),
      );
      expect(result.successes).toEqual([2, 4]);
      expect(result.failures).toHaveLength(2);
    });

    it("handles empty input", async () => {
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulate(
          [],
          (n: number) => Effect.succeed(n),
        ),
      );
      expect(result.successes).toEqual([]);
      expect(result.failures).toEqual([]);
    });

    it("preserves item reference in failures", async () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulate(
          items,
          (item) => Effect.fail(`failed-${item.id}`),
        ),
      );
      expect(result.failures[0]?.item).toBe(items[0]);
    });
  });

  describe("forEachAccumulateConcurrent", () => {
    it("processes items concurrently", async () => {
      const order: number[] = [];
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulateConcurrent(
          [1, 2, 3],
          (n) =>
            Effect.sync(() => {
              order.push(n);
              return n;
            }),
          3,
        ),
      );
      expect(result.successes).toEqual([1, 2, 3]);
    });

    it("collects failures with concurrency", async () => {
      const result = await Effect.runPromise(
        ErrorAccumulator.forEachAccumulateConcurrent(
          [1, 2, 3],
          (n) =>
            n === 2
              ? Effect.fail("boom")
              : Effect.succeed(n),
          2,
        ),
      );
      expect(result.successes).toEqual([1, 3]);
      expect(result.failures).toEqual([
        { item: 2, error: "boom" },
      ]);
    });

    // Additional tests for edge cases with
    // concurrency=1 (sequential), large batches, etc.
  });
});
```

#### Index exports

```typescript
export type { AccumulateResult } from "./utils/ErrorAccumulator.js";
export { ErrorAccumulator } from "./utils/ErrorAccumulator.js";
```

Follow standard pattern, commit.

---

## Phase 2: GitHubClient Enhancements

### Task 2: Add paginate method to GitHubClient

Add a `paginate` method to the existing GitHubClient service interface and implement it in both Live and Test layers.

**Files:**

- Modify: `src/services/GitHubClient.ts` — add paginate to interface
- Modify: `src/layers/GitHubClientLive.ts` — implement paginate
- Modify: `src/layers/GitHubClientTest.ts` — implement paginate in test layer, update state type
- Create: `src/services/GitHubClient.paginate.test.ts`
- Modify: `src/index.ts` — export new PaginateOptions type if needed

#### Interface addition

```typescript
// Add to existing GitHubClient interface:

/** Options for paginated REST API calls. */
readonly paginate: <T>(
  operation: string,
  fn: (
    octokit: unknown,
    page: number,
    perPage: number,
  ) => Promise<{ data: T[] }>,
  options?: { perPage?: number; maxPages?: number },
) => Effect.Effect<Array<T>, GitHubClientError>;
```

#### Live implementation

```typescript
paginate: <T>(
  operation: string,
  fn: (
    octokit: unknown,
    page: number,
    perPage: number,
  ) => Promise<{ data: T[] }>,
  options?: { perPage?: number; maxPages?: number },
) => {
  const perPage = options?.perPage ?? 100;
  const maxPages = options?.maxPages ?? Infinity;

  const loop = (
    page: number,
    accumulated: Array<T>,
  ): Effect.Effect<Array<T>, GitHubClientError> =>
    Effect.tryPromise({
      try: () => fn(octokit, page, perPage),
      catch: (error) => wrapError(operation, error),
    }).pipe(
      Effect.flatMap((response) => {
        const results = [...accumulated, ...response.data];
        if (
          response.data.length < perPage ||
          page >= maxPages
        ) {
          return Effect.succeed(results);
        }
        return loop(page + 1, results);
      }),
    );

  return loop(1, []).pipe(
    Effect.withSpan("GitHubClient.paginate", {
      attributes: {
        "github.operation": operation,
        "pagination.perPage": perPage,
      },
    }),
  );
},
```

#### Test implementation

Add `paginateResponses: Map<string, Array<unknown[]>>` to `GitHubClientTestState`. Each key maps to an array of page results. The test paginate method returns pages sequentially.

```typescript
paginate: <T>(
  operation: string,
  _fn: (
    octokit: unknown,
    page: number,
    perPage: number,
  ) => Promise<{ data: T[] }>,
  _options?: { perPage?: number; maxPages?: number },
) => {
  const pages = state.paginateResponses.get(operation);
  if (!pages) {
    return Effect.fail(
      new GitHubClientError({
        operation,
        status: 404,
        reason: `No paginate responses recorded for "${operation}"`,
        retryable: false,
      }),
    );
  }
  const allData = pages.flat() as T[];
  return Effect.succeed(allData);
},
```

Update `GitHubClientTestState` interface and `empty()` to include `paginateResponses: new Map()`.

#### Tests (6 tests)

- Paginates until empty page
- Respects maxPages limit
- Returns empty array for zero results
- Concatenates multiple pages correctly
- Handles single-page result (fewer than perPage items)
- Reports errors with operation context

Follow standard pattern, commit.

---

### Task 3: GitHubGraphQL service

A dedicated service for GitHub GraphQL operations with structured error handling. While `GitHubClient.graphql` exists, this service adds operation naming, mutation/query distinction (important for DryRun), and structured GraphQL error extraction.

**Files:**

- Create: `src/errors/GitHubGraphQLError.ts`
- Create: `src/services/GitHubGraphQL.ts`
- Create: `src/layers/GitHubGraphQLLive.ts`
- Create: `src/layers/GitHubGraphQLTest.ts`
- Create: `src/services/GitHubGraphQL.test.ts`
- Create: `src/layers/GitHubGraphQLLive.test.ts`
- Modify: `src/index.ts`

#### Error

```typescript
import { Data } from "effect";

export const GitHubGraphQLErrorBase =
  Data.TaggedError("GitHubGraphQLError");

export class GitHubGraphQLError extends GitHubGraphQLErrorBase<{
  readonly operation: string;
  readonly reason: string;
  readonly errors: ReadonlyArray<{
    readonly message: string;
    readonly type?: string;
  }>;
}> {}
```

#### Service interface

```typescript
import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";

export interface GitHubGraphQL {
  readonly query: <T>(
    operation: string,
    queryString: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<T, GitHubGraphQLError>;

  readonly mutation: <T>(
    operation: string,
    mutationString: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<T, GitHubGraphQLError>;
}

export const GitHubGraphQL =
  Context.GenericTag<GitHubGraphQL>("GitHubGraphQL");
```

#### Live layer

Layer type: `Layer.Layer<GitHubGraphQL, never, GitHubClient>`

Depends on GitHubClient. Both `query` and `mutation` delegate to `client.graphql()`, but:

- Map `GitHubClientError` to `GitHubGraphQLError` with operation name
- Extract GraphQL-specific error arrays from the response if present
- Instrument with `Effect.withSpan("GitHubGraphQL.query")` or `"GitHubGraphQL.mutation"`
- Include `operation` and query type in span attributes

```typescript
export const GitHubGraphQLLive: Layer.Layer<
  GitHubGraphQL,
  never,
  GitHubClient
> = Layer.effect(
  GitHubGraphQL,
  Effect.map(GitHubClient, (client) => ({
    query: <T>(
      operation: string,
      queryString: string,
      variables?: Record<string, unknown>,
    ) =>
      client.graphql<T>(queryString, variables).pipe(
        Effect.mapError(
          (error) =>
            new GitHubGraphQLError({
              operation,
              reason: error.reason,
              errors: extractGraphQLErrors(error),
            }),
        ),
        Effect.withSpan("GitHubGraphQL.query", {
          attributes: {
            "graphql.operation": operation,
          },
        }),
      ),

    mutation: <T>(
      operation: string,
      mutationString: string,
      variables?: Record<string, unknown>,
    ) =>
      client.graphql<T>(mutationString, variables).pipe(
        Effect.mapError(
          (error) =>
            new GitHubGraphQLError({
              operation,
              reason: error.reason,
              errors: extractGraphQLErrors(error),
            }),
        ),
        Effect.withSpan("GitHubGraphQL.mutation", {
          attributes: {
            "graphql.operation": operation,
          },
        }),
      ),
  })),
);
```

Helper to extract GraphQL errors from the error reason:

```typescript
const extractGraphQLErrors = (
  error: GitHubClientError,
): Array<{ message: string; type?: string }> => {
  // GitHub GraphQL errors are sometimes embedded in
  // the error message as JSON
  try {
    const parsed = JSON.parse(error.reason);
    if (Array.isArray(parsed?.errors)) {
      return parsed.errors.map(
        (e: { message?: string; type?: string }) => ({
          message: e.message ?? "Unknown error",
          type: e.type,
        }),
      );
    }
  } catch {
    // Not JSON — single error message
  }
  return [{ message: error.reason }];
};
```

#### Test layer

```typescript
export interface GitHubGraphQLTestState {
  readonly queryResponses: Map<string, unknown>;
  readonly mutationResponses: Map<string, unknown>;
  readonly queryCalls: Array<{
    operation: string;
    query: string;
    variables?: Record<string, unknown>;
  }>;
  readonly mutationCalls: Array<{
    operation: string;
    query: string;
    variables?: Record<string, unknown>;
  }>;
}
```

Namespace with `.empty()` and `.layer(state)`. Records all calls to queryCalls/mutationCalls arrays.

#### Tests

8 tests for service (via test layer), 4 tests for live layer (mocked GitHubClient).

#### Index exports

```typescript
export {
  GitHubGraphQLError,
  GitHubGraphQLErrorBase,
} from "./errors/GitHubGraphQLError.js";
export { GitHubGraphQL } from "./services/GitHubGraphQL.js";
export { GitHubGraphQLLive } from "./layers/GitHubGraphQLLive.js";
export type { GitHubGraphQLTestState } from "./layers/GitHubGraphQLTest.js";
export { GitHubGraphQLTest } from "./layers/GitHubGraphQLTest.js";
```

Follow standard pattern, commit.

---

## Phase 3: Cross-Cutting Services

### Task 4: DryRun service

Cross-cutting concern for intercepting mutation operations in dry-run mode.

**Files:**

- Create: `src/services/DryRun.ts`
- Create: `src/layers/DryRunLive.ts`
- Create: `src/layers/DryRunTest.ts`
- Create: `src/services/DryRun.test.ts`
- Modify: `src/index.ts`

DryRun does not need a DryRunError — it never fails.

#### Service interface

```typescript
import type { Effect } from "effect";
import { Context } from "effect";

export interface DryRun {
  readonly isDryRun: Effect.Effect<boolean>;
  readonly guard: <A, E, R>(
    label: string,
    effect: Effect.Effect<A, E, R>,
    fallback: A,
  ) => Effect.Effect<A, E, R>;
}

export const DryRun =
  Context.GenericTag<DryRun>("DryRun");
```

#### Live layer

Layer type: `Layer.Layer<DryRun>` — no dependencies. The `guard` method uses `Effect.logInfo` (Effect's built-in logger) instead of requiring ActionLogger as a dependency. This avoids a dependency cycle and keeps the service lightweight.

```typescript
export const DryRunLive = (
  enabled: boolean,
): Layer.Layer<DryRun> =>
  Layer.succeed(DryRun, {
    isDryRun: Effect.succeed(enabled),
    guard: <A, E, R>(
      label: string,
      effect: Effect.Effect<A, E, R>,
      fallback: A,
    ) =>
      enabled
        ? Effect.logInfo(`[DRY-RUN] ${label}`).pipe(
            Effect.map(() => fallback),
          )
        : effect,
  });
```

#### Test layer

```typescript
export interface DryRunTestState {
  readonly guardedLabels: Array<string>;
}

export const DryRunTest = {
  layer: (
    state: DryRunTestState,
  ): Layer.Layer<DryRun> =>
    Layer.succeed(DryRun, {
      isDryRun: Effect.succeed(true),
      guard: <A, E, R>(
        label: string,
        _effect: Effect.Effect<A, E, R>,
        fallback: A,
      ) => {
        state.guardedLabels.push(label);
        return Effect.succeed(fallback);
      },
    }),
  empty: (): DryRunTestState => ({ guardedLabels: [] }),
} as const;
```

#### Tests (6 tests)

- isDryRun returns true when enabled
- isDryRun returns false when disabled
- guard executes effect when not dry-run
- guard returns fallback when dry-run
- guard logs dry-run label
- guard records labels in test state

#### Index exports

```typescript
export { DryRun } from "./services/DryRun.js";
export { DryRunLive } from "./layers/DryRunLive.js";
export type { DryRunTestState } from "./layers/DryRunTest.js";
export { DryRunTest } from "./layers/DryRunTest.js";
```

Follow standard pattern, commit.

---

## Phase 4: Infrastructure Services

### Task 5: NpmRegistry service

Query npm registry for package metadata via CommandRunner.

**Files:**

- Create: `src/errors/NpmRegistryError.ts`
- Create: `src/schemas/NpmPackage.ts`
- Create: `src/services/NpmRegistry.ts`
- Create: `src/layers/NpmRegistryLive.ts`
- Create: `src/layers/NpmRegistryTest.ts`
- Create: `src/services/NpmRegistry.test.ts`
- Create: `src/layers/NpmRegistryLive.test.ts`
- Modify: `src/index.ts`

#### Error

```typescript
export class NpmRegistryError extends NpmRegistryErrorBase<{
  readonly pkg: string;
  readonly operation: "view" | "search" | "versions";
  readonly reason: string;
}> {}
```

#### Schema

File: `src/schemas/NpmPackage.ts`

```typescript
import { Schema } from "effect";

export const NpmPackageInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  distTags: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  integrity: Schema.UndefinedOr(Schema.String),
  tarball: Schema.UndefinedOr(Schema.String),
});
export type NpmPackageInfo = typeof NpmPackageInfo.Type;
```

#### Service interface

```typescript
export interface NpmRegistry {
  readonly getLatestVersion: (
    pkg: string,
  ) => Effect.Effect<string, NpmRegistryError>;
  readonly getDistTags: (
    pkg: string,
  ) => Effect.Effect<
    Record<string, string>,
    NpmRegistryError
  >;
  readonly getPackageInfo: (
    pkg: string,
    version?: string,
  ) => Effect.Effect<NpmPackageInfo, NpmRegistryError>;
  readonly getVersions: (
    pkg: string,
  ) => Effect.Effect<Array<string>, NpmRegistryError>;
}

export const NpmRegistry =
  Context.GenericTag<NpmRegistry>("NpmRegistry");
```

#### Live layer

Layer type: `Layer.Layer<NpmRegistry, never, CommandRunner>`

Uses `CommandRunner.execCapture("npm", ["view", pkg, "--json"])` to query npm. Parses JSON output. Maps CommandRunnerError to NpmRegistryError.

- `getLatestVersion`: runs `npm view <pkg> dist-tags.latest --json`, strips quotes from output
- `getDistTags`: runs `npm view <pkg> dist-tags --json`, parses as `Record<string, string>`
- `getPackageInfo`: runs `npm view <pkg>@<version> name version dist-tags dist.integrity dist.tarball --json`, maps to NpmPackageInfo schema
- `getVersions`: runs `npm view <pkg> versions --json`, parses as `string[]`

All methods instrumented with `Effect.withSpan("NpmRegistry.methodName", { attributes: { "npm.package": pkg } })`.

#### Test layer

```typescript
export interface NpmRegistryTestState {
  readonly packages: Map<
    string,
    {
      versions: string[];
      latest: string;
      distTags: Record<string, string>;
      integrity?: string;
      tarball?: string;
    }
  >;
}
```

#### Tests

6 service tests (via test layer), 6 live tests (mocked CommandRunner).

#### Index exports

```typescript
export {
  NpmRegistryError,
  NpmRegistryErrorBase,
} from "./errors/NpmRegistryError.js";
export type { NpmPackageInfo as NpmPackageInfoType } from "./schemas/NpmPackage.js";
export { NpmPackageInfo } from "./schemas/NpmPackage.js";
export { NpmRegistry } from "./services/NpmRegistry.js";
export { NpmRegistryLive } from "./layers/NpmRegistryLive.js";
export type { NpmRegistryTestState } from "./layers/NpmRegistryTest.js";
export { NpmRegistryTest } from "./layers/NpmRegistryTest.js";
```

Follow standard pattern, commit.

---

### Task 6: WorkspaceDetector service

Detect monorepo structure and list workspace packages.

**Files:**

- Create: `src/errors/WorkspaceDetectorError.ts`
- Create: `src/schemas/Workspace.ts`
- Create: `src/services/WorkspaceDetector.ts`
- Create: `src/layers/WorkspaceDetectorLive.ts`
- Create: `src/layers/WorkspaceDetectorTest.ts`
- Create: `src/services/WorkspaceDetector.test.ts`
- Create: `src/layers/WorkspaceDetectorLive.test.ts`
- Modify: `src/index.ts`

#### Error

```typescript
export class WorkspaceDetectorError extends WorkspaceDetectorErrorBase<{
  readonly operation: "detect" | "list" | "get";
  readonly reason: string;
}> {}
```

#### Schemas

File: `src/schemas/Workspace.ts`

```typescript
import { Schema } from "effect";

export const WorkspaceType = Schema.Literal(
  "single",
  "pnpm",
  "yarn",
  "npm",
  "bun",
);
export type WorkspaceType = typeof WorkspaceType.Type;

export const WorkspaceInfo = Schema.Struct({
  root: Schema.String,
  type: WorkspaceType,
  patterns: Schema.Array(Schema.String),
});
export type WorkspaceInfo = typeof WorkspaceInfo.Type;

export const WorkspacePackage = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  path: Schema.String,
  private: Schema.Boolean,
  dependencies: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
});
export type WorkspacePackage =
  typeof WorkspacePackage.Type;
```

#### Service interface

```typescript
export interface WorkspaceDetector {
  readonly detect: () => Effect.Effect<
    WorkspaceInfo,
    WorkspaceDetectorError
  >;
  readonly listPackages: () => Effect.Effect<
    Array<WorkspacePackage>,
    WorkspaceDetectorError
  >;
  readonly getPackage: (
    nameOrPath: string,
  ) => Effect.Effect<
    WorkspacePackage,
    WorkspaceDetectorError
  >;
}

export const WorkspaceDetector =
  Context.GenericTag<WorkspaceDetector>(
    "WorkspaceDetector",
  );
```

#### Live layer

Layer type: `Layer.Layer<WorkspaceDetector, never, FileSystem.FileSystem>`

Detection algorithm:

1. Check for `pnpm-workspace.yaml` — if exists, type is "pnpm", parse `packages:` array for patterns
1. Else read `package.json`, check `workspaces` field:
   - If array: type is "npm" (or "yarn" if `yarn.lock` exists, "bun" if `bun.lock` exists)
   - If `workspaces.packages` array: same logic
1. If neither found: type is "single", patterns = `["."]`

`listPackages`:

1. Call detect() to get patterns
1. For each pattern, glob for `pattern/package.json` files
1. Read each package.json, extract name, version, private, dependencies
1. Return array of WorkspacePackage

`getPackage`:

1. Call listPackages()
1. Find by name or by path (relative)
1. Fail with WorkspaceDetectorError if not found

All methods instrumented with `Effect.withSpan`.

For YAML parsing of pnpm-workspace.yaml, use dynamic import of `yaml` (already an optional peer dep from v0.4.0).

#### Test layer

```typescript
export interface WorkspaceDetectorTestState {
  readonly info: WorkspaceInfo;
  readonly packages: Array<WorkspacePackage>;
}
```

#### Tests

6 service tests (via test layer), 8 live tests (mocked FileSystem covering pnpm, npm, yarn, single-package detection and package listing).

#### Index exports

```typescript
export {
  WorkspaceDetectorError,
  WorkspaceDetectorErrorBase,
} from "./errors/WorkspaceDetectorError.js";
export type {
  WorkspaceInfo as WorkspaceInfoType,
  WorkspacePackage as WorkspacePackageType,
  WorkspaceType as WorkspaceTypeType,
} from "./schemas/Workspace.js";
export {
  WorkspaceInfo,
  WorkspacePackage,
  WorkspaceType,
} from "./schemas/Workspace.js";
export { WorkspaceDetector } from "./services/WorkspaceDetector.js";
export { WorkspaceDetectorLive } from "./layers/WorkspaceDetectorLive.js";
export type { WorkspaceDetectorTestState } from "./layers/WorkspaceDetectorTest.js";
export { WorkspaceDetectorTest } from "./layers/WorkspaceDetectorTest.js";
```

Follow standard pattern, commit.

---

## Phase 5: Finalization

### Task 7: Update barrel exports and verify

Verify all new exports are in `src/index.ts`, run full test suite, typecheck, lint.

**Files:**

- Modify: `src/index.ts` — verify all new exports present

#### Step 1: Verify index.ts has all exports

Check that all new items from Tasks 1-6 are exported.

#### Step 2: Run full suite

Run: `pnpm vitest run --coverage`

Expected: All tests pass, coverage above 80%.

#### Step 3: Run typecheck and lint

Run: `pnpm run typecheck && pnpm run lint:fix`

Expected: PASS.

#### Step 4: Commit

---

### Task 8: Changeset and documentation

Create changeset for v0.5.0 and update CLAUDE.md.

**Files:**

- Modify: `.changeset/gentle-falcon-321.md` — update for v0.5.0
- Modify: `CLAUDE.md` — add new services to table

#### Step 1: Update changeset

```markdown
---
"@savvy-web/github-action-effects": minor
---

## Features

- **GitHubClient.paginate**: Paginated REST API calls with automatic page concatenation
- **GitHubGraphQL**: Dedicated GraphQL service with structured error extraction and mutation/query distinction
- **DryRun**: Cross-cutting dry-run mode with guard pattern for mutation interception
- **NpmRegistry**: Query npm registry for package metadata (versions, dist-tags, integrity hashes)
- **ErrorAccumulator**: Utility namespace for "process all, collect failures" patterns
- **WorkspaceDetector**: Detect monorepo structure and list workspace packages
```

#### Step 2: Update CLAUDE.md services table

Add new services to the services table.

#### Step 3: Commit
