---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

- Fix Windows tar extraction by adding `--force-local` flag to prevent colons in paths from being interpreted as remote hosts, and `--overwrite` to handle extracting over existing files. Fixes #71.
- Treat HTTP 409 (Conflict) on `CreateCacheEntry` as silent success since the cache already exists for that key. Fixes #72.
