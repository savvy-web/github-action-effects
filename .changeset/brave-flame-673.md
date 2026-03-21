---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Only use tar `-k` flag on Windows where file locking causes "Permission denied" errors. Linux/macOS use plain `xzf` which correctly overwrites existing files by default. Fixes #76.
