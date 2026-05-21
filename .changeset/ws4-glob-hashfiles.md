---
"@savvy-web/github-action-effects": minor
---

## Features

### New `Glob` service + `hashFiles` (`@actions/glob` parity)

- `Glob.glob(patterns, options?)` resolves newline/comma-separated glob patterns
  (`*`, `?`, `[...]`, `**`, `!` excludes, `~` expansion) to a sorted array of
  absolute paths. `GlobLive` wraps `node:fs.globSync`; `GlobTest` is an in-memory
  namespace layer (`empty`/`layer`).
- `Glob.hashFiles(patterns, options?)` computes the `@actions/glob`-compatible
  SHA-256 hash-of-hashes over matched files (per-file SHA-256 binary digests fed,
  in glob order, into one accumulating SHA-256), so keys interoperate with
  `ActionCache`. Files outside the workspace root are skipped. Returns
  `Option.none()` when nothing matches (the toolkit returns `""`; recover that
  verbatim with `Option.getOrElse(() => "")`).
- New `GlobError`. Internal path-resolution shared with `ActionCache` (refactor;
  no behavior change).
