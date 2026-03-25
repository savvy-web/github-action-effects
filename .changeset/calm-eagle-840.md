---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

- Fix cache restore extracting files relative to working directory instead of at
  their correct absolute paths by adding `-P` (absolute-names) flag to both tar
  create and extract operations (Fixes #81)

## Features

- Add `streaming` option to `CommandRunner.ExecOptions` that forwards
  stdout/stderr to `process.stdout`/`process.stderr` in real-time while still
  capturing output, improving log visibility for long-running commands (Fixes #80)
- Add Windows shell argument escaping via `escapeWindowsArg()` to prevent
  cmd.exe metacharacter injection when `shell: true` is used for `.cmd`/`.bat`
  file resolution (Fixes #62)
