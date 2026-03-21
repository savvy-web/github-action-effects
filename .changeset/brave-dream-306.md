---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Use `-k` (keep old files) flag for tar extraction to skip existing files instead of failing with "Permission denied" on Windows. Tolerates exit code 1 (non-fatal warnings) while still failing on exit code 2+ (fatal errors). Fixes #76.
