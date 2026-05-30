---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

`GitHubClientLive` now correctly treats GitHub secondary rate-limit responses as retryable. A 403 carrying a `Retry-After` header, or a 403 with `x-ratelimit-remaining: 0` and an `x-ratelimit-reset` timestamp, is retried with back-off rather than surfacing as a permanent failure. A bare 403 with no rate-limit signals remains non-retryable so genuine permission denials are not looped on.
