# Filesystem I/O (`@actions/io` parity)

`@actions/io` splits into two parts here:

1. **`IoUtil`** — a namespace for the lookups with no `@effect/platform` equivalent: locating a binary on `PATH` (`which` / `findInPath`).
2. **A substitution recipe** for `cp` / `mv` / `rmRF` / `mkdirP`, which map straight onto `@effect/platform` `FileSystem` and need no wrappers.

## `IoUtil` — `which` / `findInPath`

`IoUtil` is a namespace object, like `RegistryClassifier` and `SemverResolver` — not a service. Its functions return `Effect` values and read `FileSystem` from context. `ActionsRuntime.Default` already provides `FileSystem`, so inside `Action.run` you wire up nothing extra.

```typescript
import { IoUtil } from "@savvy-web/github-action-effects"
import { Effect, Option } from "effect"

const program = Effect.gen(function* () {
  // First executable match, or Option.none() on miss — never fails on miss.
  const git = yield* IoUtil.which("git")
  if (Option.isNone(git)) {
    yield* Effect.logWarning("git not found on PATH")
  }

  // Strict variant: fails with IoError when not found.
  const node = yield* IoUtil.whichOrFail("node")

  // Every match across PATH.
  const all = yield* IoUtil.findInPath("python")
})
```

| Function | Returns | On miss |
| --- | --- | --- |
| `IoUtil.which(tool)` | `Effect<Option<string>, never, FileSystem>` | `Option.none()` |
| `IoUtil.whichOrFail(tool)` | `Effect<string, IoError, FileSystem>` | fails with `IoError` |
| `IoUtil.findInPath(tool)` | `Effect<ReadonlyArray<string>, never, FileSystem>` | `[]` |

Behavior mirrors `@actions/io`:

- `PATH` is split on the OS path delimiter; empty segments are dropped.
- A `tool` that already contains a path separator is resolved directly rather than searched on `PATH`.
- **POSIX:** a candidate is executable when it is a regular file with any execute bit set (`mode & 0o111`). The platform `FileSystem.File.Info.mode` is the raw numeric stat mode, so this check works directly; a defensive `fs.access(path, X_OK)` probe covers the rare zero-mode case.
- **Windows:** every `PATHEXT` extension is tried for each PATH directory; extension membership, not execute bits, is the test.

The two `which` shapes replace `@actions/io`'s overloaded `check` boolean. The common "is it installed?" case stays in the success channel (`which`); the "must exist" case (`whichOrFail`) puts the failure in the typed error channel.

## `cp` / `mv` / `rmRF` / `mkdirP` → `@effect/platform` `FileSystem`

These four `@actions/io` helpers map cleanly onto `FileSystem`, which `ActionsRuntime.Default` already puts in context everywhere. A wrapper would just add a layer of indirection over a method that already does the job — use `FileSystem` directly.

> Verified against `@effect/platform` `0.96.1`: `copy` (with `overwrite`),
> `rename`, `remove` (with `recursive` / `force`) and `makeDirectory` (with
> `recursive`) all exist with the option names below.

| `@actions/io` | `@effect/platform` `FileSystem` | Notes |
| --- | --- | --- |
| `mkdirP(dir)` | `fs.makeDirectory(dir, { recursive: true })` | `recursive` is opt-in |
| `cp(src, dst, opts)` | `fs.copy(src, dst, { overwrite })` | `copy` is recursive; `@actions/io`'s `recursive` flag maps to default behavior |
| `mv(src, dst, opts)` | `fs.rename(src, dst)` | cross-device falls back to copy+remove inside the platform impl |
| `rmRF(path)` | `fs.remove(path, { recursive: true, force: true })` | `force` ignores `ENOENT`, matching `rmRF`'s "no error if missing" |

```typescript
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"

const fileOps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  yield* fs.makeDirectory("build/out", { recursive: true })          // mkdirP
  yield* fs.copy("src/assets", "build/out/assets", { overwrite: true }) // cp -r
  yield* fs.rename("build/out/old.txt", "build/out/new.txt")          // mv
  yield* fs.remove("build/tmp", { recursive: true, force: true })     // rmRF
})
```
