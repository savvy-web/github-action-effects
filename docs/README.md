# github-action-effects Documentation

Effect-based utility library for building GitHub Actions with schema-validated
inputs, structured logging, typed outputs, multi-phase state management, and
GFM report builders.

## Installation

```bash
npm install @savvy-web/github-action-effects
```

Required peer dependencies:

```bash
npm install effect @actions/core
```

Optional peer dependencies (for future services):

```bash
npm install @actions/exec @actions/github @effect/platform @effect/platform-node
```

## Table of Contents

* [Architecture](./architecture.md) -- How the module works, service design,
  and layer composition
* [Example Action](./example-action.md) -- End-to-end walkthrough building a
  GitHub Action
* [Testing Guide](./testing.md) -- Testing with in-memory test layers

## Services at a Glance

| Service | Purpose |
| --- | --- |
| ActionInputs | Schema-validated input reading (get, getOptional, getSecret, getJson, getMultiline, getBoolean, getBooleanOptional) |
| ActionLogger | Structured logging with group, withBuffer, annotationError/Warning/Notice |
| ActionOutputs | Typed outputs (set, setJson, summary, exportVariable, addPath, setFailed, setSecret) |
| ActionState | Schema-serialized state for multi-phase actions (save, get, getOptional) |
| GFM Builders | Pure functions for tables, checklists, details, status icons |

## Helpers

| Helper | Purpose |
| --- | --- |
| `runAction` | Top-level convenience that provides core layers, installs the logger, and catches errors |
| `parseAllInputs` | Batch input reading from a config record with cross-validation |

## See Also

See the [project README](../README.md) for a quick-start example.

For build tooling and the action runner, see the companion package
`@savvy-web/github-action-builder`.
