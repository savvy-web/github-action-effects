import { Data } from "effect";

/**
 * Errors raised by Attest operations.
 *
 * @remarks
 * The `reason` discriminator lets callers pattern-match on the failing
 * stage without coupling to the implementation graph:
 *
 * - `"build"`  — failure constructing the in-toto statement
 * - `"save"`   — failure writing a statement or bundle to disk
 * - `"oidc"`   — failure obtaining the GitHub Actions OIDC token
 * - `"sign"`   — failure signing the DSSE envelope via Sigstore
 * - `"upload"` — failure POSTing the bundle to GitHub's attestations API
 *
 * @public
 */
export class AttestError extends Data.TaggedError("AttestError")<{
	readonly reason: "build" | "save" | "oidc" | "sign" | "upload";
	readonly message: string;
	readonly cause?: unknown;
}> {}
