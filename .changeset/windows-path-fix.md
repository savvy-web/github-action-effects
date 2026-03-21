---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

- Use `path.delimiter` instead of hardcoded `:` in `ActionOutputs.addPath()` so Windows PATH entries use `;`
- Add `shell: true` to `spawn()` on Windows in `CommandRunner` so `.cmd`/`.bat` files like `corepack.cmd` are resolved
