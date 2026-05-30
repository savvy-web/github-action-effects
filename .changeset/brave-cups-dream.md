---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

`Attest.listForSubject` now pins `X-GitHub-Api-Version: 2026-03-10` on requests to the GitHub repository attestations endpoint. The previously used default API version has been deprecated (Sunset 2028-03-10) and produced a deprecation warning on every call.

Under the new version the inline Sigstore `bundle` field is absent from list responses. When a `predicateType` filter is supplied, the server-side `predicate_type` query parameter narrows results without any per-entry bundle fetch. When no filter is supplied, each entry's `bundle_url` is fetched to recover the `predicateType`. The public `AttestationListEntry` type is unchanged.
