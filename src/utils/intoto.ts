/**
 * Pure constructors for in-toto statements.
 *
 * @remarks
 * No I/O, no Effect dependencies — these are plain functions so callers
 * can build statements deterministically and inspect them (or hash them,
 * or feed them straight into a DSSE envelope) without needing the rest
 * of the Attest service plumbing.
 */

import type { AttestInput } from "../schemas/Attestation.js";
import { IN_TOTO_STATEMENT_V1, InTotoStatement, InTotoSubject } from "../schemas/Attestation.js";

/**
 * Build a {@link InTotoStatement} from a list of subjects and a typed
 * predicate.
 *
 * @example
 * ```ts
 * const stmt = buildStatement({
 *   subjects: [{ name: "pkg:npm/@scope/pkg@1.0.0", digest: { sha256: "..." } }],
 *   predicateType: SLSA_PROVENANCE_V1,
 *   predicate: { buildDefinition: ..., runDetails: ... },
 * })
 * ```
 *
 * @public
 */
export const buildStatement = (input: AttestInput): InTotoStatement => {
	return new InTotoStatement({
		_type: IN_TOTO_STATEMENT_V1,
		subject: [...input.subjects],
		predicateType: input.predicateType,
		predicate: input.predicate,
	});
};

/**
 * Build a single-subject {@link InTotoSubject} from a name and sha256
 * digest. Convenience for the common case of attesting one artifact.
 *
 * @param name - PURL or other identifier (e.g. `pkg:npm/@scope/pkg@1.0.0`).
 * @param sha256 - 64-char lowercase hex SHA-256 digest of the artifact.
 *
 * @public
 */
export const subject = (name: string, sha256: string): InTotoSubject =>
	new InTotoSubject({ name, digest: { sha256: sha256.replace(/^sha256:/i, "") } });

/**
 * Serialize a statement to canonical JSON for hashing / DSSE-wrapping.
 *
 * @remarks
 * No special canonicalization beyond `JSON.stringify` with two-space
 * indentation — the DSSE Pre-Authentication Encoding handles
 * canonicalization separately. This is the form we write to disk for
 * local inspection (`Attest.save`) and what gets fed into the DSSE
 * envelope's payload field.
 *
 * @public
 */
export const serializeStatement = (statement: InTotoStatement): string => JSON.stringify(statement, null, 2);

/** PURL helper for npm packages. */
export const npmPurl = (name: string, version: string): string => `pkg:npm/${name}@${version}`;
