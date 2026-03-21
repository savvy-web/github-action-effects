---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Fix ActionCacheLive save/restore failing on GitHub Actions runners with V2 cache service enabled (`ACTIONS_CACHE_SERVICE_V2=True`).

- Replace V1 REST protocol (`_apis/artifactcache/` at `ACTIONS_CACHE_URL`) with V2 Twirp RPC at `ACTIONS_RESULTS_URL`
- Restore uses `GetCacheEntryDownloadURL` → Azure Blob download via `@azure/storage-blob`
- Save uses `CreateCacheEntry` → Azure Blob upload → `FinalizeCacheEntryUpload`
- Version hash updated to match `@actions/cache` format (`paths|gzip|1.0`)
- Add `@azure/storage-blob` as direct dependency for reliable Azure Blob uploads/downloads
- Add exponential backoff retry for Twirp RPC calls on transient errors
