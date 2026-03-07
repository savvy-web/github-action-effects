---
"@savvy-web/github-action-effects": minor
---

## Features

- **ActionState service**: New Effect service for typed state transfer between action phases (pre/main/post) using Schema encode/decode for complex object serialization
- **ActionInputs additions**: `getMultiline` for newline-delimited lists, `getBoolean`/`getBooleanOptional` for boolean inputs
- **ActionOutputs additions**: `setFailed` for marking action failure, `setSecret` for masking generated values in logs
- **Action namespace**: Groups top-level helpers under `Action.*` — `Action.run()`, `Action.parseInputs()`, `Action.makeLogger()`, `Action.setLogLevel()`, `Action.resolveLogLevel()`
- **GithubMarkdown namespace**: Groups GFM builder functions under `GithubMarkdown.*` — `GithubMarkdown.table()`, `GithubMarkdown.bold()`, etc.
