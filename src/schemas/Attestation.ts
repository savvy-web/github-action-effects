/**
 * Schema definitions for in-toto statements, Sigstore bundles, and the
 * attestation service's public input/output shapes.
 *
 * @remarks
 * Stays decoupled from any HTTP or crypto primitives so consumers can
 * reason about (and serialize) attestation artifacts before any signing
 * or upload happens. Modeled after the same JSON shapes that GitHub's
 * REST API (`POST /repos/{owner}/{repo}/attestations`) and
 * `@actions/attest` produce, so a bundle built here interoperates with
 * existing sigstore tooling (cosign verify-blob, slsa-verifier, etc.).
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// in-toto Statement v1
// ---------------------------------------------------------------------------

/**
 * Type URI for in-toto Statement v1. Stored verbatim as the `_type` field of
 * every statement we emit.
 *
 * @see https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
 */
export const IN_TOTO_STATEMENT_V1 = "https://in-toto.io/Statement/v1" as const;

/** Subject of an in-toto statement: a content-addressed artifact. */
export class InTotoSubject extends Schema.Class<InTotoSubject>("InTotoSubject")({
	/**
	 * Name of the subject. Conventionally a PURL for npm packages
	 * (e.g. `pkg:npm/@scope/name@1.0.0`) but the spec only requires
	 * uniqueness within the statement.
	 */
	name: Schema.String,
	/**
	 * One or more algorithm → hex digest mappings for the artifact.
	 * SHA-256 is conventionally provided as `{ sha256: "<64 hex chars>" }`.
	 */
	digest: Schema.Record({ key: Schema.String, value: Schema.String }),
}) {}

/**
 * In-toto Statement v1. The `predicate` body is intentionally typed as
 * `unknown` — different predicate types (SLSA provenance, CycloneDX SBOM,
 * SPDX, etc.) carry different shapes, and the statement layer doesn't
 * need to introspect them.
 */
export class InTotoStatement extends Schema.Class<InTotoStatement>("InTotoStatement")({
	_type: Schema.Literal(IN_TOTO_STATEMENT_V1),
	subject: Schema.Array(InTotoSubject),
	predicateType: Schema.String,
	predicate: Schema.Unknown,
}) {}

// ---------------------------------------------------------------------------
// Predicate type URIs we support out of the box
// ---------------------------------------------------------------------------

/** SLSA Provenance v1.0 predicate URI. */
export const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1" as const;
/** CycloneDX BOM predicate URI. Used for SBOM attestations. */
export const CYCLONEDX_BOM = "https://cyclonedx.org/bom" as const;
/** SPDX SBOM predicate URI. */
export const SPDX_V2_3 = "https://spdx.dev/Document/v2.3" as const;

// ---------------------------------------------------------------------------
// Sigstore Bundle v0.3
// ---------------------------------------------------------------------------

/**
 * Sigstore Bundle media type, v0.3. GitHub's `POST /repos/.../attestations`
 * endpoint expects bundles in this shape.
 */
export const SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json" as const;

/**
 * A Sigstore bundle — the wire format for attestations. The exact
 * `verificationMaterial` and `dsseEnvelope` shapes are defined by the
 * sigstore protobuf-specs; we model them as `unknown` at this layer and
 * delegate construction to `@sigstore/sign`. The bundle is opaque to
 * callers that just want to upload it.
 *
 * @see https://github.com/sigstore/protobuf-specs/blob/main/protos/sigstore_bundle.proto
 */
export class SigstoreBundle extends Schema.Class<SigstoreBundle>("SigstoreBundle")({
	mediaType: Schema.Literal(SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE),
	verificationMaterial: Schema.Unknown,
	dsseEnvelope: Schema.Unknown,
}) {}

// ---------------------------------------------------------------------------
// Public input/output shapes for the Attest service
// ---------------------------------------------------------------------------

/**
 * Common input for any attestation operation.
 *
 * @remarks
 * Either a list of pre-built {@link InTotoSubject} entries or a
 * single subject (name + digest) — matching `@actions/attest`'s
 * convenience overload.
 */
export interface AttestInput {
	readonly subjects: ReadonlyArray<InTotoSubject>;
	readonly predicateType: string;
	readonly predicate: unknown;
}

/**
 * Result of a successful end-to-end attestation: the statement,
 * the signed Sigstore bundle, and the GitHub attestation record.
 */
export interface AttestationRecord {
	readonly statement: InTotoStatement;
	readonly bundle: SigstoreBundle;
	readonly attestationId: number;
	readonly attestationUrl: string;
}
