# Generating SLSA attestations

An attestation is a signed in-toto statement that ties an artifact's digest to a claim about how it was built. The `Attest` cluster signs those statements into a Sigstore bundle and uploads them to GitHub's attestation store, so a downstream verifier can confirm a tarball came out of a specific workflow run (provenance) and what went into it (an SBOM). This guide wires the four services involved — `OidcTokenIssuer`, `SigstoreSigner`, `GitHubClient` and `Attest` — and walks the two attestation shapes plus the idempotent-recovery path.

For a per-service interface recap, see the [services guide](./03-services.md#attestation-services). The publish chain that produces the tarball digest these attestations describe is in [publishing packages](./11-publishing.md).

## Requirements

Attestation needs two workflow permissions. Without them the runner does not expose the environment the cluster reads:

```yaml
permissions:
  id-token: write       # exposes ACTIONS_ID_TOKEN_REQUEST_TOKEN / _URL for OIDC
  attestations: write   # allows POST /repos/{owner}/{repo}/attestations
```

`id-token: write` is what lets `OidcTokenIssuer` request the OIDC token Sigstore's Fulcio uses to issue a short-lived signing certificate. `attestations: write` is what lets the upload land. The repo-scoped `GITHUB_TOKEN` carries the `attestations: write` scope once the permission is declared, so `GitHubClientLive.fromEnv()` is enough for the upload.

## The layer stack

The attestation methods carry their dependencies in the requirements channel rather than baking them in, so you compose the stack at the call site. `Attest.provenance`, `Attest.sbom` and `Attest.attest` each require `SigstoreSigner | OidcTokenIssuer | GitHubClient`; `Attest.buildBundle` (sign without uploading) needs only `SigstoreSigner | OidcTokenIssuer`; `Attest.sbom` additionally requires `Sbom` when it builds the BOM itself.

```typescript
import { Layer } from "effect"
import {
  AttestLive,
  GitHubClientLive,
  OidcTokenIssuerLive,
  SbomLive,
  SigstoreSignerLive,
} from "@savvy-web/github-action-effects"

// AttestLive depends on the signing + token + client services beneath it.
const AttestationLayer = Layer.provide(
  AttestLive,
  Layer.mergeAll(
    SigstoreSignerLive,
    OidcTokenIssuerLive,
    GitHubClientLive.fromEnv(),
    SbomLive,
  ),
)
```

`OidcTokenIssuerLive` and `SigstoreSignerLive` read no inputs; `GitHubClientLive.fromEnv()` reads the ambient `GITHUB_TOKEN`. Swap `fromEnv()` for `fromToken(token)` when the upload should run as an explicit identity.

## Provenance

Provenance records who built the artifact and how. The caller assembles the SLSA Provenance v1 predicate from the runner's OIDC claims, then hands it to `Attest.provenance`. The two pure helpers `decodeJwtClaims` and `buildSLSAProvenancePredicate` produce a predicate shaped to match what `@actions/attest` emits, so verifiers see the same `buildDefinition` / `runDetails` structure regardless of which tool wrote it.

```typescript
import { Effect, Redacted } from "effect"
import {
  Attest,
  buildSLSAProvenancePredicate,
  decodeJwtClaims,
  OidcTokenIssuer,
  SIGSTORE_OIDC_AUDIENCE,
} from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const issuer = yield* OidcTokenIssuer
  const attest = yield* Attest

  // 1. Request an OIDC token scoped to the Sigstore audience. The token is
  //    Redacted — unwrap it only to feed the pure JWT decoder.
  const token = yield* issuer.getToken(SIGSTORE_OIDC_AUDIENCE)
  const claims = yield* decodeJwtClaims(Redacted.value(token))

  // 2. Build the SLSA v1 predicate from the claims + runner environment.
  const predicate = yield* buildSLSAProvenancePredicate(claims)

  // 3. Sign and upload. `subjectSha256` is the hex digest of the tarball
  //    (PackResult.sha256Hex from the publish chain).
  const record = yield* attest.provenance({
    subjectName: "pkg:npm/@scope/pkg@1.2.3",
    subjectSha256: tarballSha256Hex,
    predicate,
  })

  yield* Effect.log(`Provenance attestation: ${record.attestationUrl}`)
  // e.g. https://github.com/{owner}/{repo}/attestations/{id} (id varies per run)
})
```

`SIGSTORE_OIDC_AUDIENCE` is the `"sigstore"` audience Fulcio expects. The returned `AttestationRecord` carries the local `statement` and `bundle`, the numeric `attestationId` and the UI `attestationUrl`.

## SBOM

An SBOM attestation records the artifact's bill of materials. `Attest.sbom` accepts the BOM one of two mutually exclusive ways:

- **`dependencies`** — hand the service the resolved dependency list and it builds a CycloneDX 1.5 BOM for you.
- **`bomDocument`** — hand the service a pre-built BOM (typically from `Sbom.generate` + `Sbom.serializeJson`, with full NTIA supplier metadata) and it attests that document verbatim. The library does not validate the BOM's NTIA fields on this path: the contract is "you give us the BOM, we attest it".

Supplying neither falls back to an empty-deps BOM and logs a debug warning. New code should always pick one path.

```typescript
import { Effect } from "effect"
import { Attest, Sbom } from "@savvy-web/github-action-effects"

// Path A — let Attest build the BOM from a resolved dependency list.
const fromDeps = Effect.gen(function* () {
  const attest = yield* Attest
  const record = yield* attest.sbom({
    rootName: "@scope/pkg",
    rootVersion: "1.2.3",
    subjectSha256: tarballSha256Hex,
    dependencies: [
      { name: "effect", version: "3.18.4" },
      { name: "@octokit/rest", version: "21.0.2" },
    ],
  })
  return record
})

// Path B — generate a fully-populated BOM first, then attest it verbatim.
const fromDocument = Effect.gen(function* () {
  const sbom = yield* Sbom
  const attest = yield* Attest

  const bom = yield* sbom.generate({
    rootName: "@scope/pkg",
    rootVersion: "1.2.3",
    supplier: { name: "Acme, Inc." },
    dependencies: [{ name: "effect", version: "3.18.4" }],
  })
  const json = yield* sbom.serializeJson(bom)

  const record = yield* attest.sbom({
    rootName: "@scope/pkg",
    rootVersion: "1.2.3",
    subjectSha256: tarballSha256Hex,
    bomDocument: JSON.parse(json) as Record<string, unknown>,
  })
  yield* Effect.log(`SBOM attestation predicateType: ${record.statement.predicateType}`)
  // SBOM attestations carry predicateType https://cyclonedx.org/bom
  return record
})
```

## Idempotent recovery

A re-run should not write a second attestation for the same artifact. `Attest.listForSubject` reads the existing attestations for a tarball digest so the orchestrator can reuse a URL instead of writing a fresh one.

```typescript
import { Effect } from "effect"
import { Attest, CYCLONEDX_BOM } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const attest = yield* Attest

  // List existing attestations for this artifact, filtered to SBOM entries.
  const existing = yield* attest.listForSubject(tarballSha256Hex, {
    predicateType: CYCLONEDX_BOM,
  })

  if (existing.length > 0) {
    yield* Effect.log(`Reusing SBOM attestation: ${existing[0].attestationUrl}`)
    // reused URL placeholder — points at the already-written attestation
  } else {
    yield* Effect.log("No SBOM attestation found; writing a fresh one")
    // ... call attest.sbom(...) here
  }
})
```

When you pass a `predicateType`, `listForSubject` hands it to GitHub as a server-side filter so the API only returns matching attestations. With no filter it lists every attestation for the digest and recovers each entry's `predicateType` by reading its bundle. Either way the result is the same `{ attestationUrl, predicateType }` entries. Pass `https://slsa.dev/provenance/v1` (or use no filter) to ask the same question about provenance. The call returns an empty array when the subject has no attestations or the API returns a 404; only genuine failures (auth, network, rate limit) surface as `AttestError`.
