---
"@savvy-web/github-action-effects": patch
---

## Maintenance

### Trim required peer dependencies to the three Effect packages actually used

`@effect/cluster`, `@effect/rpc`, and `@effect/sql` were declared as required
peers but are never imported anywhere in the library. They are now removed from
`peerDependencies` and `peerDependenciesMeta`. Consumers only need `effect`,
`@effect/platform`, and `@effect/platform-node`; the dropped packages still
resolve transitively through `@effect/platform-node` if any code path needs
them. The install docs (`docs/README.md`, `docs/01-example-action.md`,
`docs/05-peer-dependencies.md`) are corrected to match the README's already-
accurate three-peer list.

### CI now runs the full production build on every pull request

The shared `release-validate` reusable workflow now runs `ci:build` (rslib dev +
prod, api-extractor forgotten-export detection, and TSDoc validation) on PRs.
The previous PR checks ran lint and tests but not the production build, which is
how a forgotten barrel export / multi-line TSDoc code span shipped a broken
build in a prior release.
