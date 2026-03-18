---
"@savvy-web/github-action-effects": minor
---

## Refactoring

Migrate services from `Context.GenericTag` to class-based `Context.Tag` and simplify error declarations.

**Services:** All 30 service definitions now use `class extends Context.Tag("github-action-effects/ServiceName")` instead of the deprecated `interface + Context.GenericTag` pattern.

**Errors:** All 28 error types now use inline `Data.TaggedError` class declarations instead of the separate `Base` export pattern.

**SemverResolver:** Updated to use the new `semver-effect` API (`SemVer.parse`, `Range.parse`, instance bump methods).

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effect/cluster | peerDependency | added | — | ^0.57.0 |
| @effect/rpc | peerDependency | added | — | ^0.74.0 |
| @effect/sql | peerDependency | added | — | ^0.50.0 |

## Breaking Changes

- Removed all `*Base` error exports (e.g., `ActionInputErrorBase`, `GitHubClientErrorBase`)
- Service types are now class-based `Context.Tag` instances; code that used the old interface type as a type annotation should use `typeof ServiceName.Service` instead
