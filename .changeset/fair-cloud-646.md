---
"@savvy-web/github-action-effects": minor
---

## Features

- Add `Action.formatCause` for robust error extraction from Effect causes
  with `[Tag] message` format and fallback chain that never returns empty

## Bug Fixes

- Fix `Action.run` silent failures by upgrading `catchAllCause` with
  diagnostic output (error message, JS stack trace, Effect span trace via
  `core.debug`). Fixes #15.

## Other

- Move OTel packages from optional peer dependencies to regular dependencies
  with static imports, eliminating dynamic `import()` failures in ncc bundles
- Remove unused `OtelExporterError` after OTel layer rewrite
