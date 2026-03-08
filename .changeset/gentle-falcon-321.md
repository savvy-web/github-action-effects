---
"@savvy-web/github-action-effects": minor
---

## Breaking Changes

- **ActionTelemetry refactored**: Removed `span()` and `getTimings()` methods. Use `Effect.withSpan()` for tracing instead. `ActionTelemetry` is now metrics-only (`metric`, `attribute`, `getMetrics`).
- **SpanData schema removed**: `SpanData` removed from `schemas/Telemetry.ts`. Use `CompletedSpan` from `InMemoryTracer` instead.

## Features

### Telemetry Overhaul

- **InMemoryTracer**: Custom Effect `Tracer` that captures completed spans in memory for GitHub-native output (step summaries, PR comments).
- **Effect.withSpan instrumentation**: All public service methods across 11 live layers are now instrumented with `Effect.withSpan` for automatic tracing.
- **OtelTelemetryLive**: Optional layer bridging Effect's Tracer to OpenTelemetry exporters. Requires `@effect/opentelemetry` and `@opentelemetry/api` as optional peer deps.
- **TelemetryReport**: Utility namespace for rendering span data as GitHub-flavored Markdown tables.
- **ReportBuilder**: Immutable fluent builder for composing structured Markdown reports with sections, stats, details, and timing data.
- **Action.run() auto-summary**: Automatically writes a timing summary to GitHub step summary after program completion.

### New Services

- **GitHubApp**: GitHub App authentication lifecycle — generate installation tokens, revoke tokens, and bracket-style `withToken` for automatic cleanup. Requires `@octokit/auth-app` as optional peer dep.
- **RateLimiter**: GitHub API rate limit awareness — check remaining quota, wait-and-retry with configurable thresholds, exponential backoff retry.
- **ChangesetAnalyzer**: Parse, query, and generate changeset files with YAML frontmatter validation.
- **GitBranch**: Branch management via GitHub's Git Data API — create, delete, get SHA, and reset branches.
- **GitCommit**: Verified commits via GitHub's Git Data API — create trees, commits, and update refs for programmatic file changes.
- **ConfigLoader**: Schema-validated config file loading for JSON, JSONC, and YAML formats. JSONC requires `jsonc-parser`, YAML requires `yaml` as optional peer deps.
- **ToolInstaller**: Tool binary management — download, extract, cache, and add to PATH. Requires `@actions/tool-cache` as optional peer dep.
- **PackageManagerAdapter**: Unified package manager interface — detect PM from package.json or lockfiles, install dependencies, query cache paths, and execute PM commands. Supports npm, pnpm, yarn, bun, and deno.
