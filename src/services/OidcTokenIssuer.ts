import type { Effect, Redacted } from "effect";
import { Context } from "effect";
import type { OidcTokenError } from "../errors/OidcTokenError.js";

/**
 * OIDC token issuer service surface.
 *
 * @remarks
 * Fetches an OIDC ID token from the GitHub Actions token service. The
 * runner exposes `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and
 * `ACTIONS_ID_TOKEN_REQUEST_URL` when a workflow has `id-token: write`.
 *
 * @public
 */
export class OidcTokenIssuer extends Context.Tag("github-action-effects/OidcTokenIssuer")<
	OidcTokenIssuer,
	{
		/**
		 * Request an OIDC ID token from the GitHub Actions token service.
		 *
		 * @param audience - The `aud` claim to encode in the JWT
		 *   (e.g. `"sigstore"` for Fulcio cert issuance).
		 */
		readonly getToken: (audience: string) => Effect.Effect<Redacted.Redacted<string>, OidcTokenError>;
	}
>() {}
