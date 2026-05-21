import { Data } from "effect";

/**
 * Errors raised by OidcTokenIssuer.
 *
 * - `"env"`    — required `ACTIONS_ID_TOKEN_REQUEST_*` env var missing
 * - `"http"`   — non-2xx response or transport error from the token service
 * - `"decode"` — token service returned a payload without a `value` field
 * - `"save"`   — failure writing the redacted token to disk
 *
 * @public
 */
export class OidcTokenError extends Data.TaggedError("OidcTokenError")<{
	readonly reason: "env" | "http" | "decode" | "save";
	readonly message: string;
	readonly cause?: unknown;
}> {}
