import { Effect, Layer, Redacted } from "effect";
import { OidcTokenIssuer } from "../services/OidcTokenIssuer.js";

/**
 * Noop OidcTokenIssuer test layer — returns a fixed dummy JWT.
 *
 * @public
 */
export const OidcTokenIssuerTest: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: (_audience?: string) => Effect.succeed(Redacted.make("test-oidc-token")),
});
