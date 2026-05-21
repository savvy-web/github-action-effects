---
"@savvy-web/github-action-effects": minor
---

## Features

### New `Artifact` service (`@actions/artifact` v2 parity)

- `uploadArtifact(name, files, rootDirectory, options?)` zips the file set and
  uploads it via the GitHub Actions results backend (Twirp
  `github.actions.results.api.v1.ArtifactService` + Azure Block Blob), returning
  `{ id, size }`. `listArtifacts`, `getArtifact` (-> `Option`), `downloadArtifact`
  (signed-URL download + unzip) and `deleteArtifact` complete the surface. A
  `findBy` option is reserved for cross-run/cross-repo reads through the public
  REST API (`actions:read`); that path is not yet implemented and fails clearly.
- Reads `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN` (set on GitHub-hosted
  runners), decoding the run/job backend IDs from the runtime token's `scp`
  claim. v2 rejects re-uploading the same artifact name in a run, surfaced as a
  typed error. New `ArtifactError` (with a `retryable` flag) and `ArtifactTest`
  in-memory layer. No dependency on `@actions/artifact`; zip/unzip shells out to
  `zip`/`unzip` with a Windows PowerShell fallback.
- The Twirp plumbing (`twirpCall`, the `CONFLICT` sentinel and the retry
  schedule) is now shared between the cache and artifact layers; no behavior
  change to `ActionCache`.

> The artifact backend is an internal GitHub protocol reverse-engineered from
> `actions/toolkit` and may change without notice; the implementation mirrors
> the already-shipped V2 cache layer. This ships as a draft pending end-to-end
> validation against a live GitHub-hosted runner.
