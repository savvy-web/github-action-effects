# Publishing packages with the publish chain

The recommended way to publish is a three-step chain: `pack` the package directory into a tarball, probe the registry for what is already published, then `publishTarball` the exact bytes you packed when they differ. Composing those steps yourself — rather than the older fused `publishIdempotent` — is what makes a re-run recover cleanly across multiple registries.

For the `PackagePublish`, `NpmRegistry` and `RegistryClassifier` interface recaps, see the [services guide](./03-services.md#package-management). For attesting the tarball you publish, see [generating SLSA attestations](./10-slsa-attestations.md).

## The chain

`pack(packageDir)` returns a `PackResult` with two distinct digests. They describe the same bytes but are not interchangeable:

- **`digest`** — npm's `dist.integrity` format, `sha512-<base64>`. Sourced from `npm pack --json` so it matches byte-for-byte what the registry stores. Compare this against the registry to decide whether to publish.
- **`sha256Hex`** — a lowercase hex SHA-256 of the tarball, no `sha256:` prefix. This is the subject digest the GitHub attestation and artifact-metadata APIs accept. Use this when attesting.

Reaching for `digest` where `sha256Hex` is expected (or the reverse) produces a silent mismatch: different algorithm, different encoding. `PackResult` also carries `tarballPath`, `name`, `version`, `packedSize`, `unpackedSize` and `fileCount`.

## Probe then publish

Compare the packed `digest` against the registry's published integrity. Skip the upload when they match; `publishTarball` the packed file otherwise. `getPublishedIntegrity` returns `Option.none()` when the version is not on that registry — a normal branch of the flow, not an error.

```typescript
import { Effect, Option } from "effect"
import {
  Attest,
  CYCLONEDX_BOM,
  NpmRegistry,
  PackagePublish,
} from "@savvy-web/github-action-effects"

const registry = "https://registry.npmjs.org/"

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish
  const npm = yield* NpmRegistry
  const attest = yield* Attest

  // 1. Pack once. The tarball is reused for the upload and the attestation.
  const packed = yield* publisher.pack("./dist/npm")

  // 2. Probe the target registry for the already-published integrity.
  const published = yield* npm.getPublishedIntegrity(packed.name, packed.version, { registry })

  // 3. Skip when identical, publish the exact tarball otherwise.
  if (Option.isSome(published) && published.value === packed.digest) {
    yield* Effect.log("status: skipped (already-published-identical)")
  } else {
    yield* publisher.publishTarball(packed.tarballPath, { registry, access: "public" })
    yield* Effect.log("status: published")
  }

  // 4. Reuse-or-write the attestation against the SHA-256 subject.
  const existing = yield* attest.listForSubject(packed.sha256Hex, { predicateType: CYCLONEDX_BOM })
  if (existing.length > 0) {
    yield* Effect.log(`reused attestation: ${existing[0].attestationUrl}`)
    // reused URL placeholder — points at the already-written attestation
  }
})
```

When a recovery run finds the version already published with a matching integrity and an attestation already written for the digest, it does nothing on either front — that idempotent behaviour is the whole reason the chain exists.

## RegistryTarget and package managers

`publishToRegistries(packageDir, targets)` walks a list of `RegistryTarget` entries in sequence. Each target carries the `registry` URL, the `token`, an optional `tag` and `access`, and an optional `packageManager`:

```typescript
import type { RegistryTarget } from "@savvy-web/github-action-effects"

const targets: ReadonlyArray<RegistryTarget> = [
  { registry: "https://registry.npmjs.org/", token: npmToken, access: "public", packageManager: "pnpm" },
  { registry: "https://npm.pkg.github.com/", token: ghToken },
]
```

`packageManager` (`"npm" | "pnpm" | "yarn" | "bun"`, default `"npm"`) controls how the publish is dispatched. The non-`npm` dispatchers — `pnpm dlx npm`, `yarn npm`, `bun x npm` — fetch a fresh `npm` rather than the runner's bundled one. That matters for OIDC trusted publishing, which needs npm ≥ 11.5.1; GitHub-hosted runners on Node 24 still ship npm 10.x. Set it to match your project's package manager when you publish with provenance.

## Dry runs

`dryRun(packageDir, options?)` simulates `npm publish --dry-run`. It returns a `DryRunResult` with `ok`, the packed sizes and file count, and the raw npm `output`:

```typescript
import { Effect } from "effect"
import { PackagePublish } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish
  const result = yield* publisher.dryRun("./dist/npm", { registry: "https://registry.npmjs.org/" })
  yield* Effect.log(`would publish: ${result.ok}`)
  // would publish: true   (or false on a version conflict / bad auth)
})
```

A non-zero npm exit — bad auth, unreachable registry, version conflict — comes back as `ok: false`, not as a failure. The error channel is reserved for a structural problem: npm could not be spawned, or its `--json` output could not be parsed.

## publishIdempotent (deprecated)

`publishIdempotent` fused the probe and publish into one call. It is deprecated: the fused dispatch hardcoded the default npm registry and could not recover a partial publish across multiple registries. New callers compose `pack` + `getPublishedIntegrity` + `publishTarball` as shown above. It stays exported for the migration window — live callers exist — but do not reach for it in new code.

```typescript
import { Effect } from "effect"
import { PackagePublish } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const publisher = yield* PackagePublish
  const packed = yield* publisher.pack("./dist/npm")

  // Deprecated — kept for the migration window only.
  const result = yield* publisher.publishIdempotent({
    packageDir: "./dist/npm",
    packageName: packed.name,
    version: packed.version,
    digest: packed.digest,
  })
  yield* Effect.log(`status: ${result.status}`)
  // status: skipped   (skipReason: "already-published-identical" when nothing changed)
})
```

## Registry classification

`RegistryClassifier` is a namespace of pure functions that classify a registry URL. The publish flow uses it to label output and to build a package-view URL. Detection parses the URL and matches the hostname; it never substring-matches, so a hostile URL like `http://evil-npmjs.org` does not pass as npm.

```typescript
import { RegistryClassifier } from "@savvy-web/github-action-effects"

RegistryClassifier.getRegistryType("https://npm.pkg.github.com/")
// → "github-packages"

RegistryClassifier.getRegistryType("https://registry.npmjs.org/")
// → "npm"

RegistryClassifier.getRegistryType(null)
// → "npm"   (an absent registry resolves to the public npm registry, the default)

RegistryClassifier.getRegistryDisplayName("https://npm.pkg.github.com/")
// → "GitHub Packages"

RegistryClassifier.generatePackageViewUrl("https://registry.npmjs.org/", "@scope/pkg")
// → "https://www.npmjs.com/package/@scope/pkg"
```

`getRegistryType` resolves to one of `"npm"`, `"github-packages"`, `"jsr"` or `"custom"`. The boolean predicates `isNpmRegistry`, `isGitHubPackagesRegistry`, `isJsrRegistry` and `isCustomRegistry` answer the same question one registry at a time. `generatePackageViewUrl` returns `undefined` for registries with no standard package-view URL.
