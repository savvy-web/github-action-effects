# github-action-effects Documentation

Effect-based utility library for building GitHub Actions with schema-validated
inputs, structured logging, typed outputs, and GFM report builders.

## Installation

```bash
npm install @savvy-web/github-action-effects
```

Required peer dependencies:

```bash
npm install effect @actions/core @actions/exec @actions/github
```

Optional peer dependencies (needed to run the action):

```bash
npm install @effect/platform @effect/platform-node
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
| ActionInputs | Schema-validated input reading (get, getOptional, getSecret, getJson) |
| ActionLogger | Structured logging with group, withBuffer, annotation |
| ActionOutputs | Typed outputs (set, setJson, summary, exportVariable, addPath) |
| GFM Builders | Pure functions for tables, checklists, details, status icons |

## See Also

See the [project README](../README.md) for a quick-start example.

For build tooling and the action runner, see the companion package
`@savvy-web/github-action-builder`.
