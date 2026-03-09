# Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix silent action failures by making error reporting robust, OTel deps static, and exporting a reusable `formatCause` utility.

**Architecture:** Three changes layered bottom-up: (1) add `formatCause` utility with fallback chain, (2) rewrite `OtelExporterLive` with static imports, (3) upgrade `Action.run`'s `catchAllCause` to use `formatCause` + stack trace + span trace.

**Tech Stack:** Effect (Cause, Data.TaggedError), @actions/core, @effect/opentelemetry, @opentelemetry/*

**Design doc:** `docs/plans/2026-03-09-error-handling-design.md`

---

## Task 1: Add `Action.formatCause` with tests

**Files:**

- Modify: `src/Action.ts` (add `formatCause` to the `Action` namespace)
- Modify: `src/Action.test.ts` (add test suite for `formatCause`)
- Modify: `src/index.ts` (no change needed — `Action` is already exported)

### Step 1: Write failing tests for `formatCause`

Add a new `describe("Action.formatCause")` block to `src/Action.test.ts`:

```typescript
import { Cause, Data, Effect, Exit } from "effect";

describe("Action.formatCause", () => {
  it("extracts message from a Fail cause with TaggedError", () => {
    const TestError = Data.TaggedError("TestError");
    const error = new TestError({ reason: "something broke" });
    const cause = Cause.fail(error);
    const message = Action.formatCause(cause);
    expect(message).toContain("[TestError]");
    expect(message).toContain("something broke");
  });

  it("extracts message from a Die cause with standard Error", () => {
    const cause = Cause.die(new Error("unexpected boom"));
    const message = Action.formatCause(cause);
    expect(message).toContain("unexpected boom");
  });

  it("extracts message from a Die cause with non-Error value", () => {
    const cause = Cause.die({ code: 42, detail: "weird" });
    const message = Action.formatCause(cause);
    expect(message).not.toBe("");
    expect(message).toContain("42");
  });

  it("never returns an empty string", () => {
    const cause = Cause.empty;
    const message = Action.formatCause(cause);
    expect(message.length).toBeGreaterThan(0);
  });

  it("handles interrupt cause", () => {
    const cause = Cause.interrupt("fiber-1");
    const message = Action.formatCause(cause);
    expect(message.length).toBeGreaterThan(0);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm vitest run src/Action.test.ts`
Expected: FAIL — `Action.formatCause is not a function`

### Step 3: Implement `formatCause`

In `src/Action.ts`, add the import for `Cause` (already imported) and `Data`.
Add `formatCause` to the `Action` namespace object:

```typescript
/**
 * Extract a human-readable error message from an Effect Cause.
 *
 * Uses a fallback chain that always produces a non-empty string:
 * 1. Cause.pretty — works for most typed errors
 * 2. Cause.squash — extracts underlying error with [Tag] prefix
 * 3. Last resort — "Unknown error" sentinel
 *
 * Output uses a `[Tag] message` format for consistent parseability.
 */
formatCause: (cause: Cause.Cause<unknown>): string => {
  // Try Cause.pretty first
  const pretty = Cause.pretty(cause);
  if (pretty.trim() !== "") {
    return pretty;
  }

  // Fall back to squashing and inspecting the error
  try {
    const squashed = Cause.squash(cause);

    // TaggedError pattern: has _tag and reason
    if (
      squashed != null &&
      typeof squashed === "object" &&
      "_tag" in squashed &&
      typeof (squashed as Record<string, unknown>)._tag === "string"
    ) {
      const tag = (squashed as Record<string, unknown>)._tag as string;
      const reason =
        (squashed as Record<string, unknown>).reason ??
        (squashed as Record<string, unknown>).message ??
        "";
      return `[${tag}] ${String(reason)}`;
    }

    // Standard Error
    if (squashed instanceof Error) {
      return `[Error] ${squashed.message}`;
    }

    // Unknown shape — JSON stringify
    const json = JSON.stringify(squashed);
    if (json && json !== "{}") {
      return `[UnknownError] ${json}`;
    }
  } catch {
    // squash or stringify failed — fall through
  }

  return "Unknown error (no diagnostic information available)";
},
```

### Step 4: Run tests to verify they pass

Run: `pnpm vitest run src/Action.test.ts`
Expected: PASS — all existing + new tests pass

### Step 5: Commit

```bash
git add src/Action.ts src/Action.test.ts
git commit -m "feat: add Action.formatCause for robust error extraction

Closes part of #15"
```

---

## Task 2: Move OTel packages to regular dependencies

**Files:**

- Modify: `package.json` (move deps, remove peerDependenciesMeta entries)

### Step 1: Update `package.json`

Move these 11 packages from `peerDependencies` to `dependencies` (keep exact
version ranges from current `peerDependencies`):

```text
@effect/opentelemetry: ">=0.61.0"
@opentelemetry/api: ">=1.0.0"
@opentelemetry/exporter-metrics-otlp-grpc: ">=0.57.0"
@opentelemetry/exporter-metrics-otlp-http: ">=0.57.0"
@opentelemetry/exporter-metrics-otlp-proto: ">=0.57.0"
@opentelemetry/exporter-trace-otlp-grpc: ">=0.57.0"
@opentelemetry/exporter-trace-otlp-http: ">=0.57.0"
@opentelemetry/exporter-trace-otlp-proto: ">=0.57.0"
@opentelemetry/resources: ">=1.30.0"
@opentelemetry/sdk-metrics: ">=1.30.0"
@opentelemetry/sdk-trace-node: ">=1.30.0"
```

Remove all 11 entries from `peerDependenciesMeta`.
Remove all 11 entries from `peerDependencies`.

### Step 2: Run `pnpm install` to verify lockfile resolves

Run: `pnpm install`
Expected: Clean install with no warnings about missing peers

### Step 3: Run typecheck

Run: `pnpm run typecheck`
Expected: PASS

### Step 4: Commit

```bash
git add package.json pnpm-lock.yaml
git commit -m "refactor: move OTel packages from optional peers to dependencies

Part of #15 — eliminates dynamic import failures in ncc bundles"
```

---

## Task 3: Rewrite `OtelExporterLive` with static imports

**Files:**

- Modify: `src/layers/OtelExporterLive.ts` (replace dynamic imports with static)
- Modify: `src/layers/OtelExporterLive.test.ts` (update tests)

### Step 1: Write failing test for static import behavior

Replace the existing `OtelExporterLive.test.ts` with tests that expect
the layer to work reliably (no try/catch for missing packages):

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { InMemoryTracer } from "./InMemoryTracer.js";
import { OtelExporterLive } from "./OtelExporterLive.js";

describe("OtelExporterLive", () => {
  it("returns InMemoryTracer layer when disabled", async () => {
    const layer = OtelExporterLive({
      enabled: false,
      endpoint: "",
      protocol: "grpc",
      headers: {},
    });

    // Should work without any OTel setup
    const result = await Effect.runPromise(
      Effect.succeed("ok").pipe(Effect.withSpan("test-span"), Effect.provide(layer)),
    );
    expect(result).toBe("ok");
  });

  it("creates layer successfully when enabled with grpc protocol", async () => {
    const layer = OtelExporterLive({
      enabled: true,
      endpoint: "http://localhost:4317",
      protocol: "grpc",
      headers: {},
    });

    // Layer builds — may fail at runtime due to missing TracerProvider,
    // but the static imports and layer construction succeed.
    expect(layer).toBeDefined();
  });

  it("creates layer successfully when enabled with http/protobuf protocol", async () => {
    const layer = OtelExporterLive({
      enabled: true,
      endpoint: "http://localhost:4318",
      protocol: "http/protobuf",
      headers: {},
    });

    expect(layer).toBeDefined();
  });

  it("creates layer successfully when enabled with http/json protocol", async () => {
    const layer = OtelExporterLive({
      enabled: true,
      endpoint: "http://localhost:4318",
      protocol: "http/json",
      headers: {},
    });

    expect(layer).toBeDefined();
  });
});
```

### Step 2: Rewrite `OtelExporterLive.ts` with static imports

Replace the entire file:

```typescript
import * as EffectOtel from "@effect/opentelemetry";
import { Layer } from "effect";
import type { ResolvedOtelConfig } from "../schemas/OtelExporter.js";
import { GitHubOtelAttributes } from "../utils/GitHubOtelAttributes.js";
import { InMemoryTracer } from "./InMemoryTracer.js";

/**
 * Create the OTel exporter layer based on resolved config.
 *
 * When enabled=false, returns InMemoryTracer (no-op for external export).
 * When enabled=true, configures the @effect/opentelemetry bridge with
 * GitHub-aware resource attributes.
 *
 * @public
 */
export const OtelExporterLive = (config: ResolvedOtelConfig): Layer.Layer<never> => {
  if (!config.enabled) {
    return InMemoryTracer.layer;
  }

  const githubAttrs = GitHubOtelAttributes.fromEnvironment();
  const attributes = { ...githubAttrs, ...config.resourceAttributes };

  return EffectOtel.Tracer.layer.pipe(
    Layer.provide(
      EffectOtel.Resource.layer({
        serviceName: config.serviceName ?? "github-action",
        serviceVersion: process.env.__PACKAGE_VERSION__ ?? "0.0.0",
        attributes,
      }),
    ),
  );
};
```

Note: The protocol-specific exporter packages (`exporter-trace-otlp-grpc`, etc.)
register themselves globally when imported by the OTel SDK. The `@effect/opentelemetry`
bridge picks up whatever provider is registered. The protocol selection happens
at the OTel SDK level via environment variables (`OTEL_EXPORTER_OTLP_PROTOCOL`),
not via our code. Remove `traceExporterModule`/`metricExporterModule` helpers and
the `OtelExporterError` import.

### Step 3: Run tests

Run: `pnpm vitest run src/layers/OtelExporterLive.test.ts`
Expected: PASS

### Step 4: Run full test suite

Run: `pnpm run test`
Expected: PASS (no regressions)

### Step 5: Commit

```bash
git add src/layers/OtelExporterLive.ts src/layers/OtelExporterLive.test.ts
git commit -m "refactor: replace dynamic imports in OtelExporterLive with static imports

Part of #15 — removes Effect.orDie and dynamic import() that caused silent failures"
```

---

## Task 4: Rewrite `OtelTelemetryLive` with static imports

**Files:**

- Modify: `src/layers/OtelTelemetryLive.ts` (replace dynamic import with static)
- Modify: `src/layers/OtelTelemetryLive.test.ts` (update tests)

### Step 1: Rewrite `OtelTelemetryLive.ts`

This file has the same dynamic import + `Effect.orDie` pattern. Replace with:

```typescript
import * as EffectOtel from "@effect/opentelemetry";
import { Layer } from "effect";

/**
 * Configuration for the OpenTelemetry bridge layer.
 *
 * @public
 */
export interface OtelConfig {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly resourceAttributes?: Record<string, string>;
}

/**
 * Create a layer that bridges Effect's Tracer to OpenTelemetry.
 *
 * All `Effect.withSpan` calls will export spans to the configured OTel collector.
 *
 * @example
 * ```ts
 * import { OtelTelemetryLive } from "@savvy-web/github-action-effects";
 *
 * const program = myEffect.pipe(
 *   Effect.provide(OtelTelemetryLive({ serviceName: "my-action" })),
 * );
 * ```
 *
 * @public
 */
export const OtelTelemetryLive = (config?: OtelConfig): Layer.Layer<never> =>
  EffectOtel.Tracer.layer.pipe(
    Layer.provide(
      EffectOtel.Resource.layer({
        serviceName: config?.serviceName ?? "github-action",
        serviceVersion: config?.serviceVersion ?? process.env.__PACKAGE_VERSION__ ?? "0.0.0",
      }),
    ),
  );
```

### Step 2: Update `OtelTelemetryLive.test.ts`

```typescript
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { OtelTelemetryLive } from "./OtelTelemetryLive.js";

describe("OtelTelemetryLive", () => {
  it("can be imported without errors", () => {
    expect(OtelTelemetryLive).toBeDefined();
    expect(typeof OtelTelemetryLive).toBe("function");
  });

  it("returns a Layer when called with no config", () => {
    const layer = OtelTelemetryLive();
    expect(layer).toBeDefined();
  });

  it("returns a Layer when called with config", () => {
    const layer = OtelTelemetryLive({ serviceName: "test-action", serviceVersion: "1.0.0" });
    expect(layer).toBeDefined();
  });

  it("fails when OTel TracerProvider is not registered", async () => {
    // @effect/opentelemetry is installed but no TracerProvider is
    // registered globally, so the layer produces a defect.
    const layer = OtelTelemetryLive();
    const program = Effect.void.pipe(Effect.provide(layer));
    const exit = await Effect.runPromiseExit(program);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.squash(exit.cause);
      expect(defect).toBeInstanceOf(Error);
    }
  });
});
```

### Step 3: Run tests

Run: `pnpm vitest run src/layers/OtelTelemetryLive.test.ts`
Expected: PASS

### Step 4: Commit

```bash
git add src/layers/OtelTelemetryLive.ts src/layers/OtelTelemetryLive.test.ts
git commit -m "refactor: replace dynamic imports in OtelTelemetryLive with static imports

Part of #15"
```

---

## Task 5: Upgrade `catchAllCause` in `Action.run`

**Files:**

- Modify: `src/Action.ts` (update the `catchAllCause` handler in `run`)

### Step 1: Write failing test for improved error output

Add to `src/Action.test.ts`:

```typescript
import { Cause } from "effect";

describe("Action.run error handling", () => {
  it("formatCause produces non-empty output for Die with TaggedError", () => {
    const TestError = Data.TaggedError("LayerSetupError");
    const error = new TestError({ reason: "missing dependency" });
    const cause = Cause.die(error);
    const msg = Action.formatCause(cause);
    expect(msg).not.toBe("");
    expect(msg.length).toBeGreaterThan(5);
  });
});
```

### Step 2: Update `catchAllCause` in `Action.run`

Replace the existing handler in `src/Action.ts` (lines 135-138):

```typescript
Effect.catchAllCause((cause) => {
  const message = Action.formatCause(cause);

  // Extract JS stack trace if available
  let stack = "";
  try {
    const squashed = Cause.squash(cause);
    if (squashed instanceof Error && squashed.stack) {
      // Remove first line (error message already in `message`)
      const lines = squashed.stack.split("\n");
      stack = lines.slice(1).join("\n");
    }
  } catch {
    // squash failed — no stack available
  }

  // Emit Effect span trace via debug (visible with RUNNER_DEBUG=1)
  const spanTrace = Cause.pretty(cause);
  if (spanTrace.trim() !== "") {
    core.debug(`Effect span trace:\n${spanTrace}`);
  }

  const fullMessage = stack
    ? `Action failed: ${message}\n${stack}`
    : `Action failed: ${message}`;

  return Effect.sync(() => core.setFailed(fullMessage));
}),
```

### Step 3: Run tests

Run: `pnpm vitest run src/Action.test.ts`
Expected: PASS

### Step 4: Run full suite + typecheck + lint

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: All PASS

### Step 5: Commit

```bash
git add src/Action.ts src/Action.test.ts
git commit -m "fix: Action.run catchAllCause now produces diagnostic error output

Fixes #15 — uses formatCause fallback chain, includes JS stack trace,
emits Effect span trace via core.debug"
```

---

## Task 6: Clean up unused OtelExporterError (if orphaned)

**Files:**

- Check: `src/errors/OtelExporterError.ts` — verify if still used elsewhere
- Possibly modify: `src/index.ts` (remove export if orphaned)
- Possibly delete: `src/errors/OtelExporterError.ts`

### Step 1: Search for remaining usages

Run: `grep -r "OtelExporterError" src/ --include="*.ts" | grep -v ".test.ts"`

If only used in `OtelExporterLive.ts` (which no longer imports it), remove:

- Delete `src/errors/OtelExporterError.ts`
- Remove export from `src/index.ts`

If used elsewhere, keep it.

### Step 2: Run full suite

Run: `pnpm run test && pnpm run typecheck`
Expected: PASS

### Step 3: Commit (if changes made)

```bash
git add -u
git commit -m "chore: remove unused OtelExporterError

Orphaned after OtelExporterLive rewrite in #15"
```

---

## Task 7: Final verification

### Step 1: Run full CI-equivalent checks

```bash
pnpm run lint:fix && pnpm run typecheck && pnpm run test
```

Expected: All PASS

### Step 2: Verify the fix addresses the issue

Manually verify in `src/Action.ts`:

1. `Action.formatCause` exists and is exported via the `Action` namespace
2. `catchAllCause` uses `formatCause` + stack trace + span trace
3. `OtelExporterLive` uses static imports, no `Effect.orDie`
4. `package.json` has OTel packages in `dependencies`

### Step 3: Final commit if any lint fixes were applied

```bash
git add -u
git commit -m "chore: lint fixes"
```
