# @savvy-web/pnpm-module-template

## 0.1.0

### Features

* [`8635765`](https://github.com/savvy-web/github-action-effects/commit/8635765a949b36db3b8461fce713418243a85f61) **ActionInputs** service: schema-validated input reading with `get`, `getOptional`, `getSecret`, and `getJson` methods
* **ActionLogger** service: structured logging with three levels (info/verbose/debug), auto mode, two-channel routing (user-facing + GitHub debug), collapsible groups, and buffer-on-failure pattern
* **ActionOutputs** service: typed output setting with `set`, `setJson`, `summary`, `exportVariable`, and `addPath` methods
* **GFM builders**: pure functions for markdown tables, headings, details, lists, checklists, status icons, links, code blocks, and more
* **Schema definitions**: `ActionLogLevel`, `LogLevelInput`, `Status`, `ChecklistItem`, `CapturedOutput` with Effect Schema annotations
* **Test layers**: in-memory implementations for all services with namespace object pattern (`*.empty()` / `*.layer()`)
* **Error types**: `ActionInputError` and `ActionOutputError` using Effect's `Data.TaggedError` pattern

## 0.0.1

### Patch Changes

* ae454d3: Update dependencies:

  **Dependencies:**

  * @savvy-web/commitlint: ^0.2.0 → ^0.2.1
  * @savvy-web/lint-staged: ^0.1.3 → ^0.2.1
  * @savvy-web/rslib-builder: ^0.11.0 → ^0.12.0
