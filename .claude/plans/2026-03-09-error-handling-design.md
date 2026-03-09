# Error Handling Improvements

**Issue:** [#15](https://github.com/savvy-web/github-action-effects/issues/15)
**Date:** 2026-03-09
**Branch:** `feat/error-handling`

## Problem

`Action.run` fails silently when layer setup errors occur. The `catchAllCause`
handler uses `Cause.pretty(cause)` which returns an empty string for certain
defect types, producing `##[error]Action failed:` with no diagnostic info.

The root cause is `OtelExporterLive` using dynamic `import()` with
`Effect.orDie`, which converts missing-package errors into opaque defects.

## Design

### 1. `Action.formatCause` utility

Pure synchronous function on the `Action` namespace. Returns a non-empty
string with a `[Tag] message` format for consistent parseability.

**Signature:**

```typescript
Action.formatCause(cause: Cause.Cause<unknown>): string
```

**Fallback chain (always produces a non-empty string):**

1. `Cause.pretty(cause)` -- if non-empty, use as-is
2. `Cause.squash(cause)` -- extract underlying error, then:
   - TaggedError with `_tag` + `reason`: `"[_tag] reason"`
   - Standard Error with `message`: `"[Error] message"`
   - Otherwise: `"[UnknownError] JSON.stringify(squashed)"`
3. Last resort: `"Unknown error (no diagnostic information available)"`

Exported for consumer use in custom error handlers.

### 2. OTel as regular dependencies

Move all 11 OTel packages from optional `peerDependencies` to `dependencies`:

- `@effect/opentelemetry`
- `@opentelemetry/api`
- `@opentelemetry/exporter-metrics-otlp-grpc`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-proto`
- `@opentelemetry/exporter-trace-otlp-grpc`
- `@opentelemetry/exporter-trace-otlp-http`
- `@opentelemetry/exporter-trace-otlp-proto`
- `@opentelemetry/resources`
- `@opentelemetry/sdk-metrics`
- `@opentelemetry/sdk-trace-node`

Replace dynamic `import()` calls in `OtelExporterLive` with static imports.
Remove `traceExporterModule`/`metricExporterModule` dynamic module resolution
helpers. Remove `Effect.orDie`. Use a simple switch over the config protocol
at runtime to select the right exporter.

Bundle size impact is negligible for ncc-bundled actions.

### 3. `catchAllCause` upgrade in `Action.run`

Replace the bare `Cause.pretty` call with full diagnostics:

1. `Action.formatCause(cause)` for the human-readable error message
2. Extract JS stack trace from squashed error (`Error.stack`) if available
3. `core.setFailed()` with message + stack trace combined
4. `core.debug()` with `Cause.pretty(cause)` for the Effect span trace
   (visible when `RUNNER_DEBUG=1`)

Example output:

```text
##[error]Action failed: [OtelExporterError] @effect/opentelemetry is required...
    at OtelExporterLive (src/layers/OtelExporterLive.ts:58:12)
    at Layer.unwrapEffect ...
##[debug]<Effect span trace from Cause.pretty>
```

### 4. Scope

**In scope:**

- `Action.formatCause` implementation + export
- `OtelExporterLive` rewrite (static imports, no orDie)
- `package.json` dependency changes
- `catchAllCause` handler upgrade
- Tests for `formatCause` and updated `OtelExporterLive`

**Out of scope:**

- Changing other optional peer deps (cache, exec, github, etc.)
- Standard error handler middleware (proposal D from issue -- deferred)
