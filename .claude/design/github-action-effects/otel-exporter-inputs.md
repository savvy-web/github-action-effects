---
status: current
module: github-action-effects
category: architecture
created: 2026-03-06
updated: 2026-03-19
last-synced: 2026-03-19
completeness: 85
related:
  - ./index.md
  - ./services.md
dependencies: []
---

# OTel Exporter Inputs Design

## Overview

Standardized OpenTelemetry exporter configuration for GitHub Actions built with
`@savvy-web/github-action-effects`. Four action inputs follow the OTLP exporter
specification, are automatically parsed by `Action.run()`, and conditionally wire
up trace + metric exporters when enabled.

## Inputs

| Input | Type | Default | Env Var Fallback |
| ----- | ---- | ------- | ---------------- |
| `otel-enabled` | `"enabled" \| "disabled" \| "auto"` | `"auto"` | -- |
| `otel-endpoint` | `string` | -- | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `otel-protocol` | `"grpc" \| "http/protobuf" \| "http/json"` | `"grpc"` | `OTEL_EXPORTER_OTLP_PROTOCOL` |
| `otel-headers` | `string` (key=value,key=value) | -- | `OTEL_EXPORTER_OTLP_HEADERS` |

## Resolution Logic

* `otel-enabled = "disabled"` produces a no-op layer
* `otel-enabled = "enabled"` requires an endpoint (from input or env var), fails
  with `OtelExporterError` if missing
* `otel-enabled = "auto"` enables export if an endpoint is found (input or env
  var), otherwise produces a no-op layer

Inputs take precedence over env vars. Env vars serve as org-level defaults.

## Signals

Traces and metrics are exported. Logs are not -- GitHub Actions has its own log
output.

* `OTLPTraceExporter` captures all `Effect.withSpan` spans
* `OTLPMetricExporter` forwards `ActionTelemetry.metric()` data

## Protocol to Package Mapping

| Protocol | Trace Package | Metric Package |
| -------- | ------------- | -------------- |
| `grpc` | `@opentelemetry/exporter-trace-otlp-grpc` | `@opentelemetry/exporter-metrics-otlp-grpc` |
| `http/protobuf` | `@opentelemetry/exporter-trace-otlp-proto` | `@opentelemetry/exporter-metrics-otlp-proto` |
| `http/json` | `@opentelemetry/exporter-trace-otlp-http` | `@opentelemetry/exporter-metrics-otlp-http` |

All packages are regular `dependencies` (not optional peers), statically
imported. This ensures reliable `@vercel/ncc` bundling.

## Header Parsing

Standard OTLP comma-separated format: `key1=value1,key2=value2`. Split on `,`,
then split each entry on first `=`. Trim whitespace.

## Components

### OtelExporterConfig schema (`src/schemas/OtelExporter.ts`)

Validates the 4 inputs with env var fallback resolution. Produces a resolved
config:

* `enabled: boolean` (resolved from the auto/enabled/disabled + endpoint
  detection)
* `endpoint: string`
* `protocol: "grpc" | "http/protobuf" | "http/json"`
* `headers: Record<string, string>`

### OtelExporterError (`src/errors/OtelExporterError.ts`)

Covers:

* Config validation failures (enabled but no endpoint)
* Initialization failures
* Export failures

### OtelExporterLive layer

Takes resolved `ResolvedOtelConfig`. When `enabled=false`, returns
`InMemoryTracer.layer`. When `enabled=true`, uses a static import of
`@effect/opentelemetry` to configure `EffectOtel.Tracer.layerGlobal` with
GitHub-aware resource attributes.

### Action.run() integration

The 4 OTel inputs are parsed alongside user inputs automatically. The resolved
config composes the exporter layer (or no-op) into the layer stack. Action
authors get OTel support with zero configuration.

## Integration with Existing Code

* `OtelTelemetryLive` is refactored to accept the resolved config and wire up
  exporters (currently only does `@effect/opentelemetry` tracer bridge with no
  exporter)
* `GitHubOtelAttributes.fromEnvironment()` is automatically merged into resource
  attributes
* `ActionTelemetry` metrics are forwarded to the OTLP metric exporter when
  enabled
* When disabled, everything stays as-is (in-memory tracing, markdown reports)

## Error Handling

* `otel-enabled: "enabled"` with no endpoint: `OtelExporterError` with clear
  message
* Initialization failure: `OtelExporterError` with operation `"init"`
* Export failure: `OtelExporterError` with operation `"export"`
* Invalid protocol value: schema validation catches at parse time
* Malformed headers: `OtelExporterError` with parse details

## Testing

* `OtelExporterTest` layer: no-op implementation for test environments
* Schema tests for config resolution (input priority over env var over defaults)
* Header parsing edge cases
* Auto mode resolution (with and without endpoint present)

## Current State

The OTel exporter input design is fully specified with schema validation, static protocol-based package imports, and integration into `Action.run()`. Implementation covers all three OTLP protocols with automatic env var fallback resolution. All OTel packages are regular dependencies with static imports, consistent with the library-wide pattern of no dynamic `import()` calls in Live layers.

## Rationale

Standardizing OTel configuration as four action inputs with env var fallbacks allows org-level defaults while giving individual actions override control. OTel packages are regular dependencies with static imports to ensure reliable ncc bundling.

## Related Documentation

* [Architecture Index](./index.md) -- overall architecture and design overview
* [Services](./services.md) -- service interface definitions including ActionTelemetry
