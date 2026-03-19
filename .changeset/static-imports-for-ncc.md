---
"@savvy-web/github-action-effects": minor
---

## Bug Fixes

Replace dynamic `import()` with static imports in Live layers for ncc bundling compatibility.

ToolInstallerLive and GitHubAppLive previously used dynamic `import()` for `@actions/tool-cache`, `@actions/core`, and `@octokit/auth-app`. This broke `@vercel/ncc` bundling because ncc cannot follow dynamic imports, requiring consumers to add bare import hints in their entry points. All Live layers now use static imports consistently, so ncc resolves every dependency chain automatically without manual workarounds.
