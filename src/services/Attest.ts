/**
 * Attest service tag.
 */

import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";
import { Context } from "effect";
import type { AttestError } from "../errors/AttestError.js";
import type { AttestInput, InTotoStatement, SigstoreBundle } from "../schemas/Attestation.js";
import type { OidcTokenIssuer } from "./OidcTokenIssuer.js";
import type { Sbom, SbomInput } from "./Sbom.js";
import type { SigstoreSigner } from "./SigstoreSigner.js";

/**
 * Input for {@link Attest.sbom}.
 *
 * @remarks
 * Callers supply EITHER `dependencies` (the existing path — the
 * service builds a CycloneDX BOM from the resolved dependency graph)
 * OR `bomDocument` (the new path — the caller hands in a pre-built
 * BOM and the service attests it verbatim). The contract is "you give
 * us the BOM, we attest it" — the library does not validate the
 * BOM's NTIA fields, supplier completeness, or component shape on
 * the `bomDocument` path.
 *
 * If neither field is provided, the live implementation falls back
 * to building an empty-deps BOM and logs a debug warning. This keeps
 * existing callers working mid-migration; new code should always
 * supply one of the two fields.
 *
 * `dependencies` is widened to optional on this shape (vs the
 * required `dependencies` on {@link SbomInput}) so callers can pick
 * the `bomDocument` path without needing a dummy dependency list.
 *
 * @public
 */
export interface SbomAttestationInput extends Omit<SbomInput, "dependencies"> {
	/**
	 * Hex-encoded SHA-256 of the package tarball (or other artifact bytes)
	 * the BOM describes. The runtime in-toto subject becomes
	 * `pkg:npm/{rootName}@{rootVersion}` with this digest.
	 */
	readonly subjectSha256: string;
	/**
	 * Resolved direct dependencies of the root package. When provided,
	 * the live implementation builds a CycloneDX BOM from the list and
	 * attests it. Mutually exclusive with {@link bomDocument}.
	 */
	readonly dependencies?: SbomInput["dependencies"];
	/**
	 * Pre-built CycloneDX BOM document to attest verbatim. Used when the
	 * caller (e.g. a publish orchestrator) has already generated the BOM
	 * with full NTIA / supplier metadata via {@link Sbom.generate} and
	 * just wants this service to wrap it in an in-toto envelope, sign it,
	 * and POST it. Mutually exclusive with {@link dependencies}.
	 */
	readonly bomDocument?: Record<string, unknown>;
}

/**
 * One entry in the {@link Attest.listForSubject} result.
 *
 * @public
 */
export interface AttestationListEntry {
	/** GitHub UI URL for the attestation (`/{owner}/{repo}/attestations/{id}`). */
	readonly attestationUrl: string;
	/** Predicate type URI carried by the in-toto statement inside the bundle. */
	readonly predicateType: string;
}

/**
 * Input for {@link Attest.provenance}.
 *
 * @public
 */
export interface ProvenanceAttestationInput {
	/** PURL or other in-toto subject name (e.g. `pkg:npm/@scope/pkg@1.0.0`). */
	readonly subjectName: string;
	/** Hex-encoded SHA-256 of the artifact. */
	readonly subjectSha256: string;
	/** SLSA Provenance v1 predicate (build-definition + run-details). */
	readonly predicate: unknown;
}

/**
 * Attest service surface. Implementation lives in {@link "./live.ts"}.
 *
 * @remarks
 * The Effect signatures land incrementally; for step 1 only
 * `buildStatement` and `save` are usable. The remaining members are
 * declared up-front so consumers see the full API and tests can stub a
 * complete service shape with `AttestTest.empty()`.
 *
 * @public
 */
export class Attest extends Context.Tag("github-action-effects/Attest")<
	Attest,
	{
		/**
		 * Build a {@link InTotoStatement} from subjects + predicate. Pure;
		 * runs synchronously aside from the Effect wrapping.
		 */
		readonly buildStatement: (input: AttestInput) => Effect.Effect<InTotoStatement, AttestError>;

		/**
		 * Write an in-toto statement or Sigstore bundle to a local JSON
		 * file. Used during development to inspect what would be uploaded.
		 * Requires {@link FileSystem.FileSystem} so it composes with
		 * `NodeFileSystem.layer` in production and `FileSystem`'s test
		 * implementation in tests.
		 */
		readonly save: (
			data: InTotoStatement | SigstoreBundle,
			path: string,
		) => Effect.Effect<void, AttestError, FileSystem.FileSystem>;

		/**
		 * Build a signed Sigstore bundle (no upload).
		 *
		 * @remarks
		 * Delegates to {@link SigstoreSigner} which fetches an OIDC token
		 * via {@link OidcTokenIssuer}, signs the in-toto statement through
		 * Fulcio, and witnesses it on Rekor. The returned
		 * {@link SigstoreBundle} is what the GitHub attestations API
		 * accepts as the `bundle` field of the upload payload.
		 */
		readonly buildBundle: (
			input: AttestInput,
		) => Effect.Effect<SigstoreBundle, AttestError, SigstoreSigner | OidcTokenIssuer>;

		/**
		 * Full end-to-end attestation: build the in-toto statement, sign it
		 * via {@link SigstoreSigner}, and POST the resulting Sigstore bundle
		 * to `POST /repos/{owner}/{repo}/attestations`. Returns the local
		 * statement + bundle plus the GitHub-issued attestation id and a
		 * UI URL pointing at the attestation listing.
		 */
		readonly attest: (
			input: AttestInput,
		) => Effect.Effect<
			import("../schemas/Attestation.js").AttestationRecord,
			AttestError,
			SigstoreSigner | OidcTokenIssuer | import("./GitHubClient.js").GitHubClient
		>;

		/**
		 * Generate a CycloneDX SBOM, then attest the artifact with it as
		 * the predicate ({@link CYCLONEDX_BOM} predicateType).
		 *
		 * @remarks
		 * Composes {@link Sbom} (BOM generation) with {@link attest}
		 * (sign + upload). The artifact subject is derived from
		 * `rootName` + `rootVersion` + `subjectSha256` — that's the
		 * identity GitHub records against the attestation.
		 */
		readonly sbom: (
			input: SbomAttestationInput,
		) => Effect.Effect<
			import("../schemas/Attestation.js").AttestationRecord,
			AttestError,
			Sbom | SigstoreSigner | OidcTokenIssuer | import("./GitHubClient.js").GitHubClient
		>;

		/**
		 * Attest an artifact with a caller-supplied SLSA Provenance v1
		 * predicate.
		 *
		 * @remarks
		 * The caller is responsible for assembling the SLSA predicate
		 * (the runner's buildDefinition + runDetails); this method just
		 * wraps it in the in-toto envelope and uploads.
		 */
		readonly provenance: (
			input: ProvenanceAttestationInput,
		) => Effect.Effect<
			import("../schemas/Attestation.js").AttestationRecord,
			AttestError,
			SigstoreSigner | OidcTokenIssuer | import("./GitHubClient.js").GitHubClient
		>;

		/**
		 * List existing attestations for a tarball digest.
		 *
		 * @remarks
		 * Hits `GET /repos/{owner}/{repo}/attestations/sha256:{hex}`. The
		 * GitHub REST API returns one entry per existing attestation; each
		 * entry's Sigstore bundle is parsed to recover the in-toto
		 * statement's `predicateType` (e.g. `https://slsa.dev/provenance/v1`
		 * for provenance, `https://cyclonedx.org/bom` for SBOM).
		 *
		 * `options.predicateType` filters the result client-side so callers
		 * can ask "is there a provenance attestation already?" or "is there
		 * an SBOM attestation already?" without re-fetching. Returns an
		 * empty array when the subject has no attestations or the API
		 * returns a 404 — only true errors (auth, network, rate limit)
		 * surface as {@link AttestError}.
		 *
		 * The orchestrator uses presence to decide whether to skip a
		 * write — reuse the existing URL when found, otherwise call
		 * {@link provenance} or {@link sbom} to write a fresh one. This
		 * keeps recovery runs idempotent against the artifact attestation
		 * store.
		 *
		 * @param subjectSha256 - Hex-encoded SHA-256 of the artifact (no
		 *   `sha256:` prefix; the implementation adds it).
		 * @param options - Optional client-side filter.
		 */
		readonly listForSubject: (
			subjectSha256: string,
			options?: { readonly predicateType?: string },
		) => Effect.Effect<ReadonlyArray<AttestationListEntry>, AttestError, import("./GitHubClient.js").GitHubClient>;
	}
>() {}
