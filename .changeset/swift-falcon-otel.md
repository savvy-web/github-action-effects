---
"@savvy-web/github-action-effects": minor
---

## Features

- **OTel Exporter Inputs**: Standardized OpenTelemetry exporter configuration for GitHub Actions. Four inputs (otel-enabled, otel-endpoint, otel-protocol, otel-headers) are automatically parsed by `Action.run()` with env var fallback (`OTEL_EXPORTER_OTLP_*`). Supports auto/enabled/disabled modes, grpc/http-protobuf/http-json protocols, and OTLP-format header parsing.
- **OtelExporterLive**: Layer that dynamically imports the correct OTLP trace and metric exporter packages based on protocol, with helpful error messages when packages are missing.
- **OtelExporterConfig**: Schema and resolution logic for OTel configuration with input-over-env-var precedence.
