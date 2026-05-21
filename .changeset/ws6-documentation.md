---
"@savvy-web/github-action-effects": minor
---

## Documentation

Comprehensive documentation pass covering the 2.0 release surface.

**Accuracy against the final 2.0 API:** corrects stale descriptions throughout
`docs/` — `GitHubClientLive.fromEnv()` is now a function; `fromToken` takes a
`Redacted<string>`; `fromApp` is a scoped layer that revokes its token on scope
close and requires `HttpClient.HttpClient`. The "Upgrading to 2.0" migration note
and `@actions/*` substitution map are re-verified against the merged code.

**New services documented:** `Glob` (glob patterns + SHA-256 `hashFiles`),
`IoUtil` (`which`/`whichOrFail`/`findInPath`), `Artifact` (upload/list/get/
download/delete, with the "must run inside a JS action" env constraint),
`ActionInput` (YAML 1.2 Core Schema `boolean`, `multiline`), the typed event
payload (`ActionEnvironment.payload`, `repo`, `issue`, `isDebug` +
`WebhookPayload`), `PathUtils`, `ActionLogger.notice`, and the
`WorkflowCommand` notice/stop-commands/echo helpers.
`GitHubClient.paginateStream` and `GithubMarkdown.image`/`quote` are also
covered.

**Four new guides:** "Building a robust action" (best practices), "Coming from
`@actions/*`" (toolkit-parity walkthrough), "Logging and error handling", and
"Resilient GitHub API calls" (retry, rate-limit awareness, streaming pagination).

**Structure:** three existing guides (SLSA attestations, publishing, step-buffered
logging) were already present and are preserved; `docs/` is renumbered to a
contiguous 01-16 reading order with the new guides in the guides cluster.
