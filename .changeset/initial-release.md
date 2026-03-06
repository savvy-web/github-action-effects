---
"@savvy-web/github-action-effects": minor
---

## Features

- **ActionInputs** service: schema-validated input reading with `get`, `getOptional`, `getSecret`, and `getJson` methods
- **ActionLogger** service: structured logging with three levels (info/verbose/debug), auto mode, two-channel routing (user-facing + GitHub debug), collapsible groups, and buffer-on-failure pattern
- **ActionOutputs** service: typed output setting with `set`, `setJson`, `summary`, `exportVariable`, and `addPath` methods
- **GFM builders**: pure functions for markdown tables, headings, details, lists, checklists, status icons, links, code blocks, and more
- **Schema definitions**: `ActionLogLevel`, `LogLevelInput`, `Status`, `ChecklistItem`, `CapturedOutput` with Effect Schema annotations
- **Test layers**: in-memory implementations for all services with namespace object pattern (`*.empty()` / `*.layer()`)
- **Error types**: `ActionInputError` and `ActionOutputError` using Effect's `Data.TaggedError` pattern
