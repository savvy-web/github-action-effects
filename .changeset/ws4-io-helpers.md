---
"@savvy-web/github-action-effects": minor
---

## Features

### New `IoUtil` namespace (`@actions/io` `which`/`findInPath` parity)

- `IoUtil.which(tool)` returns `Option.some(absolutePath)` for the first
  executable match on `PATH`, `Option.none()` on miss; `IoUtil.whichOrFail(tool)`
  fails with the new `IoError` instead. `IoUtil.findInPath(tool)` returns every
  match. Honors `PATHEXT` on Windows and POSIX execute-bit checks. Reads
  `FileSystem` from context (provided by `ActionsRuntime.Default`).
- `cp`/`mv`/`rmRF`/`mkdirP` are documented as direct `@effect/platform`
  `FileSystem` calls (a documented filesystem I/O recipe) rather than new
  wrappers, since `FileSystem` is already in context everywhere.
