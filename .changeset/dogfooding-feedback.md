---
"@savvy-web/github-action-effects": minor
---

## Features

- **ActionState service**: New Effect service for typed state transfer between action phases (pre/main/post) using Schema encode/decode for complex object serialization
- **ActionInputs additions**: `getMultiline` for newline-delimited lists, `getBoolean`/`getBooleanOptional` for boolean inputs
- **ActionOutputs additions**: `setFailed` for marking action failure, `setSecret` for masking generated values in logs
- **parseAllInputs**: Standalone function for reading and validating all inputs at once with optional cross-validation
- **runAction helper**: Top-level convenience that provides all Live layers, installs ActionLoggerLayer, catches errors with setFailed, and runs with Effect.runPromise
