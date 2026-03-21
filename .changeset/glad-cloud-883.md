---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Remove `--overwrite` flag from tar extraction — bsdtar (used on macOS and Windows runners) does not support it, and both GNU tar and bsdtar overwrite by default. Fixes #71.
