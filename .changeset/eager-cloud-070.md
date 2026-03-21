---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Remove `--force-local` flag from tar commands — bsdtar (used on all GitHub Actions runner platforms) does not support it and does not need it. Plain `tar czf`/`tar xzf` works correctly across all platforms. Fixes #71.
