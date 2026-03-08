# OpenTelemetry Integration

`@savvy-web/github-action-effects` includes built-in OpenTelemetry support for
tracing and metrics in GitHub Actions. Traces are auto-configured by
`Action.run` with zero-config defaults.

## How It Works

When `Action.run` starts, it reads four optional action inputs and resolves
an OTel configuration. If an OTLP endpoint is available, traces and metrics
are exported. Otherwise, an in-memory tracer captures span data and writes a
timing summary to the step summary on completion.

## Action Inputs

Add these to your `action.yml` to let consumers configure tracing:

```yaml
inputs:
  otel-enabled:
    description: 'Enable OpenTelemetry export (enabled, disabled, auto)'
    required: false
    default: 'auto'
  otel-endpoint:
    description: 'OTLP endpoint URL'
    required: false
  otel-protocol:
    description: 'OTLP protocol (grpc, http/protobuf, http/json)'
    required: false
    default: 'grpc'
  otel-headers:
    description: 'OTLP headers as comma-separated key=value pairs'
    required: false
```

## Resolution Logic

The `resolveOtelConfig` function determines the final configuration using
this priority order:

1. **Action inputs** take highest priority
2. **Environment variables** are used as fallback:
   - `OTEL_EXPORTER_OTLP_ENDPOINT` for the endpoint
   - `OTEL_EXPORTER_OTLP_PROTOCOL` for the protocol
   - `OTEL_EXPORTER_OTLP_HEADERS` for the headers
3. **Defaults**: protocol defaults to `"grpc"`

### Enabled Modes

| `otel-enabled` | Behavior |
| --- | --- |
| `"auto"` (default) | Enabled if an endpoint is configured (via input or env var), disabled otherwise |
| `"enabled"` | Always enabled; fails if no endpoint is configured |
| `"disabled"` | Always disabled, even if an endpoint is available |

### Protocol Options

| Protocol | Description |
| --- | --- |
| `grpc` | gRPC transport (default, most common) |
| `http/protobuf` | HTTP with Protocol Buffers encoding |
| `http/json` | HTTP with JSON encoding |

### Header Format

Headers are specified as comma-separated `key=value` pairs:

```text
api-key=my-secret-key,x-custom-header=value
```

## Usage in Workflows

### Basic: Auto-detect from environment

If your runner has `OTEL_EXPORTER_OTLP_ENDPOINT` set (e.g., via an OTel
collector sidecar), tracing works automatically with no input configuration:

```yaml
- uses: my-org/my-action@v1
  # OTel auto-detected from OTEL_EXPORTER_OTLP_ENDPOINT
```

### Explicit configuration

```yaml
- uses: my-org/my-action@v1
  with:
    otel-enabled: 'enabled'
    otel-endpoint: 'https://otel.example.com:4317'
    otel-protocol: 'grpc'
    otel-headers: 'api-key=${{ secrets.OTEL_API_KEY }}'
```

### Disable tracing

```yaml
- uses: my-org/my-action@v1
  with:
    otel-enabled: 'disabled'
```

## In-Memory Fallback

When no OTLP endpoint is configured, `Action.run` uses an `InMemoryTracer`
that captures all spans created via `Effect.withSpan`. On completion, it
writes a timing summary to the GitHub Actions step summary showing:

- Operation names with parent/child hierarchy
- Duration for each span
- Status (success/error) indicators

This means you always get basic observability even without an external
collector.

## Adding Spans to Your Action

Use Effect's built-in `withSpan` to instrument your code:

```typescript
import { Effect } from "effect";

const fetchData = Effect.gen(function* () {
  // your logic
}).pipe(Effect.withSpan("fetchData"));

const processData = Effect.gen(function* () {
  // your logic
}).pipe(Effect.withSpan("processData"));
```

Spans are automatically nested when composed.

## Recording Metrics

Use the `ActionTelemetry` service for custom metrics:

```typescript
import { Effect } from "effect";
import { ActionTelemetry, ActionTelemetryLive } from "@savvy-web/github-action-effects";

const program = Effect.gen(function* () {
  const telemetry = yield* ActionTelemetry;

  yield* telemetry.metric("packages.processed", 42);
  yield* telemetry.metric("build.duration", 1234, "ms");
  yield* telemetry.attribute("build.target", "production");
});
```

## GitHub OTel Resource Attributes

The `GitHubOtelAttributes` namespace maps standard GitHub Actions environment
variables to OpenTelemetry semantic convention resource attributes:

```typescript
import { GitHubOtelAttributes } from "@savvy-web/github-action-effects";

const attrs = GitHubOtelAttributes.fromEnvironment();
// {
//   "cicd.pipeline.name": "CI",
//   "cicd.pipeline.run.id": "12345",
//   "vcs.ref.head.name": "refs/heads/main",
//   "vcs.ref.head.revision": "abc123",
//   "enduser.id": "octocat",
//   "vcs.repository.url.full": "https://github.com/org/repo",
//   ...
// }
```

Mapped variables:

| Environment Variable | OTel Attribute |
| --- | --- |
| `GITHUB_WORKFLOW` | `cicd.pipeline.name` |
| `GITHUB_RUN_ID` | `cicd.pipeline.run.id` |
| `GITHUB_RUN_NUMBER` | `cicd.pipeline.run.counter` |
| `GITHUB_REF` | `vcs.ref.head.name` |
| `GITHUB_SHA` | `vcs.ref.head.revision` |
| `GITHUB_ACTOR` | `enduser.id` |
| `RUNNER_NAME` | `cicd.worker.name` |
| `RUNNER_OS` | `cicd.worker.os` |
| `GITHUB_SERVER_URL` + `GITHUB_REPOSITORY` | `vcs.repository.url.full` |

## Required Peer Dependencies

To use OTLP export (not needed for in-memory fallback):

```bash
npm install @effect/opentelemetry @opentelemetry/api \
  @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics \
  @opentelemetry/resources
```

Plus one exporter package matching your protocol:

| Protocol | Trace Exporter | Metrics Exporter |
| --- | --- | --- |
| `grpc` | `@opentelemetry/exporter-trace-otlp-grpc` | `@opentelemetry/exporter-metrics-otlp-grpc` |
| `http/protobuf` | `@opentelemetry/exporter-trace-otlp-proto` | `@opentelemetry/exporter-metrics-otlp-proto` |
| `http/json` | `@opentelemetry/exporter-trace-otlp-http` | `@opentelemetry/exporter-metrics-otlp-http` |
