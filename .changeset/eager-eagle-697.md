---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Fix `NpmRegistry.getPackageInfo` returning undefined for `integrity` and `tarball` fields due to `npm view` using flat dot-notation keys (`"dist.integrity"`) instead of nested objects. Fixes #21.
