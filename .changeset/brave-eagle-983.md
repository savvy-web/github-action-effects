---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

- Retry GitBranch operations on transient 5xx errors with exponential backoff (#24)
- Auto-buffer action output at info level and flush on failure (#25)
- Enrich CommandRunnerError.message with command, args, and stderr context (#26)
