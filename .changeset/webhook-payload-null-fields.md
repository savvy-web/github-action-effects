---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

- Accept `null` in `WebhookPayload`'s `IssueRef.body`, `IssueRef.html_url`, `Repository.full_name`, and `Repository.html_url` fields. GitHub webhook payloads carry these as `null` (not absent) when the issue or PR has no description, or when an event payload omits the rendered URL. Previously decoding any such payload through `ActionEnvironment.payload` failed with `ActionEnvironmentError: Event payload did not match the expected shape: WebhookPayload — Expected string, actual null`.
