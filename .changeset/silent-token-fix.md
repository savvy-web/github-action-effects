---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Fix `botIdentity()` silently falling back to `github-actions[bot]` when the App's identity could not be resolved. The `/users/{username}` lookup was authenticated with the App JWT, which GitHub rejects on public user endpoints — causing a 401 and a silent fallback. The lookup now uses the installation token, which has the correct permissions. An additional guard prevents a nonsensical `/users/[bot]` request when `GET /app` returns no slug. Consumers that sign commits via the Git Data API will now get the correct author identity (`<appUserId>+<appSlug>[bot]@users.noreply.github.com`) and avoid DCO mismatches.
