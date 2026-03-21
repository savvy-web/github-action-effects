---
"@savvy-web/github-action-effects": patch
---

## Bug Fixes

Fix ToolInstaller.download() hanging on Windows GitHub Actions runners by replacing fetch/undici with node:https direct streaming. Add Windows PowerShell zip extraction support for extractZip().

- Replace `globalThis.fetch` + `Readable.fromWeb()` with `node:https`/`node:http` and `stream.pipeline()` for reliable cross-platform binary downloads
- Add 3-minute socket timeout matching `@actions/tool-cache` behavior
- Add manual HTTP redirect following (up to 10 hops)
- Add retry with exponential backoff for transient errors (5xx, 408, 429, socket timeout, network errors)
- Add `User-Agent: github-action-effects` header
- Add Windows zip extraction via PowerShell `System.IO.Compression.ZipFile` (pwsh → powershell fallback)
- Add `-oq` flags to `unzip` on non-Windows for quiet overwrite behavior
