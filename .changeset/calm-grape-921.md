---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Fix GitHubApp.withToken failing with "installationId option is required" by auto-discovering the installation ID when not explicitly provided. The fix authenticates as the app (JWT), lists installations, and matches by GITHUB_REPOSITORY owner. Fixes #18.
