---
"@savvy-web/github-action-effects": minor
---

## Features

### Toolkit parity II — context, inputs, and core conveniences

- `ActionInput.boolean` / `ActionInput.multiline`: GitHub-faithful input `Config`
  combinators. `boolean` follows the YAML 1.2 "Core Schema" exactly
  (`true|True|TRUE` / `false|False|FALSE`), failing on anything else — unlike
  `Config.boolean`, which silently accepts `yes`/`on`/`1`/`no`/`off`/`0`.
- `ActionEnvironment.payload`: parses `GITHUB_EVENT_PATH` into a schema-validated
  `WebhookPayload` (tolerant of unknown keys; empty when unset/missing).
  `ActionEnvironment.repo` / `.issue` mirror `@actions/github` `context.repo` /
  `context.issue`; `ActionEnvironment.isDebug` mirrors `core.isDebug()`.
- `WorkflowCommand.notice` + `ActionLogger.notice` for `::notice::` annotations,
  with an `AnnotationProperties` → command-properties mapper matching the toolkit.
- `WorkflowCommand.stopCommands` / `resumeCommands` / `setCommandEcho` for
  untrusted-output handling.
- `GithubMarkdown.image` / `GithubMarkdown.quote` (exact `@actions/core` summary
  HTML).
- `PathUtils.toPosixPath` / `toWin32Path` / `toPlatformPath`.
- `OidcTokenIssuer.getToken(audience?)` — `audience` is now optional, matching
  `core.getIDToken(audience?)` for cloud-provider OIDC federation. Backward
  compatible; Sigstore callers are unaffected.
