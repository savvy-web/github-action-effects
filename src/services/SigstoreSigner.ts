import type { Effect } from "effect";
import { Context } from "effect";
import type { SigstoreSignerError } from "../errors/SigstoreSignerError.js";
import type { InTotoStatement, SigstoreBundle } from "../schemas/Attestation.js";
import type { OidcTokenIssuer } from "./OidcTokenIssuer.js";

/**
 * DSSE payload type for in-toto statements per the GitHub attestations spec.
 *
 * @public
 */
export const IN_TOTO_PAYLOAD_TYPE = "application/vnd.in-toto+json" as const;

/**
 * OIDC audience expected by the Sigstore public-good Fulcio instance.
 *
 * @public
 */
export const SIGSTORE_OIDC_AUDIENCE = "sigstore" as const;

/**
 * Sigstore signer service surface.
 *
 * @public
 */
export class SigstoreSigner extends Context.Tag("github-action-effects/SigstoreSigner")<
	SigstoreSigner,
	{
		/**
		 * Build a Sigstore DSSE bundle from an in-toto statement.
		 *
		 * @remarks
		 * The bundle is the structure GitHub accepts via
		 * `POST /repos/{owner}/{repo}/attestations`.
		 */
		readonly signStatement: (
			statement: InTotoStatement,
		) => Effect.Effect<SigstoreBundle, SigstoreSignerError, OidcTokenIssuer>;
	}
>() {}

/**
 * Configuration knobs for the Live SigstoreSigner.
 *
 * @public
 */
export interface SigstoreSignerConfig {
	readonly fulcioBaseURL?: string;
	readonly rekorBaseURL?: string;
}
