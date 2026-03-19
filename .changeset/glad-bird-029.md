---
"@savvy-web/github-action-effects": minor
---

## Breaking Changes

- Remove `OtelExporterLive`, `OtelTelemetryLive`, `InMemoryTracer`,
  `ActionTelemetry`, `ActionTelemetryLive`, `ActionTelemetryTest`,
  `TelemetryReport`, `GitHubOtelAttributes`, and all OTel schemas
- Remove `Effect.withSpan` instrumentation from all service layers
- Remove `timings()` method from `ReportBuilder`
- Remove 12 `@opentelemetry/*` dependencies
- `Action.run()` no longer reads `otel-*` inputs

## Features

- Add `cacheFile` to `ActionsToolCache` service (closes #46)
- Add `installBinary` and `installBinaryAndAddToPath` to `ToolInstaller`
  for single-binary tools like Biome CLI (closes #40)
- Add `BinaryInstallOptions` type export

## Other

Fixes #47.
