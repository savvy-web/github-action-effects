---
"@savvy-web/github-action-effects": minor
---

## Features

Telemetry timing reports are now only written to step summaries when
`log-level` is set to `debug` (or `auto` with `RUNNER_DEBUG=1`),
reducing clutter in action output for most users.

## Refactoring

Replace imperative parsing libraries with pure Effect implementations.
SemverResolver now uses `semver-effect`, ConfigLoaderLive uses
`jsonc-effect` and `yaml-effect`, and WorkspaceDetectorLive uses
`yaml-effect`. All three provide typed errors natively, eliminating
manual `Effect.try` wrappers. `jsonc-parser` and `yaml` are no longer
required as peer dependencies.

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| semver-effect | dependency | added | — | ^0.1.0 |
| jsonc-effect | dependency | added | — | ^0.2.0 |
| yaml-effect | dependency | added | — | ^0.1.5 |
| semver | dependency | removed | ^7.7.4 | — |
| @types/semver | devDependency | removed | ^7.7.1 | — |
| jsonc-parser | peerDependency | removed | ^3.3.1 | — |
| yaml | peerDependency | removed | ^2.8.2 | — |
