/**
 * OIDC token issuer for GitHub Actions.
 *
 * @remarks
 * Fetches an OIDC ID token from the GitHub Actions token service. The
 * runner exposes two environment variables when a workflow has the
 * `id-token: write` permission:
 *
 * - `ACTIONS_ID_TOKEN_REQUEST_TOKEN` — bearer token authorizing the request
 * - `ACTIONS_ID_TOKEN_REQUEST_URL`   — token issuance endpoint
 *
 * Callers may pass an optional audience (e.g. `"sigstore"` for Fulcio cert
 * issuance) and receive a {@link Redacted} JWT. When the audience is omitted,
 * no `audience` query param is sent (matching `@actions/core.getIDToken`). The
 * redacted wrapper keeps the JWT out of default `toString` / log paths; the
 * value is unwrapped only at the point where it crosses the wire to Fulcio or
 * Rekor.
 *
 * The implementation depends on {@link HttpClient.HttpClient} so the service
 * composes with `FetchHttpClient.layer` in production and an in-memory mock
 * layer in tests — no `node:fetch` import means no undici in the bundle.
 */

import { FileSystem, HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Effect, Layer, Redacted, Schema } from "effect";
import { OidcTokenError } from "../errors/OidcTokenError.js";
import { OidcTokenIssuer } from "../services/OidcTokenIssuer.js";

/**
 * Response shape from the GitHub Actions OIDC token service.
 *
 * @internal
 */
const OidcTokenResponse = Schema.Struct({
	value: Schema.String,
	count: Schema.optional(Schema.Number),
});

const ACTIONS_ID_TOKEN_REQUEST_TOKEN = "ACTIONS_ID_TOKEN_REQUEST_TOKEN" as const;
const ACTIONS_ID_TOKEN_REQUEST_URL = "ACTIONS_ID_TOKEN_REQUEST_URL" as const;

const readEnv = (name: string): Effect.Effect<string, OidcTokenError> =>
	Effect.sync(() => process.env[name]).pipe(
		Effect.flatMap((value) =>
			value && value.length > 0
				? Effect.succeed(value)
				: Effect.fail(
						new OidcTokenError({
							reason: "env",
							message: `Missing required environment variable ${name}. The workflow needs \`permissions: id-token: write\` for OIDC token issuance.`,
						}),
					),
		),
	);

/**
 * Live {@link OidcTokenIssuer} layer. Requires {@link HttpClient.HttpClient}.
 *
 * @public
 */
export const OidcTokenIssuerLive = Layer.effect(
	OidcTokenIssuer,
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;

		return {
			getToken: (audience?: string) =>
				Effect.gen(function* () {
					const bearer = yield* readEnv(ACTIONS_ID_TOKEN_REQUEST_TOKEN);
					const baseUrl = yield* readEnv(ACTIONS_ID_TOKEN_REQUEST_URL);

					// Match @actions/core.getIDToken: when an audience is provided,
					// append `&audience=<encodeURIComponent(audience)>` to the URL;
					// otherwise leave the URL unchanged (no audience param at all).
					const url = audience !== undefined ? `${baseUrl}&audience=${encodeURIComponent(audience)}` : baseUrl;

					const request = HttpClientRequest.get(url).pipe(
						HttpClientRequest.bearerToken(bearer),
						HttpClientRequest.acceptJson,
					);

					const response = yield* http.execute(request).pipe(
						Effect.mapError(
							(cause) =>
								new OidcTokenError({
									reason: "http",
									message: `OIDC token request failed: ${cause.message}`,
									cause,
								}),
						),
					);

					if (response.status < 200 || response.status >= 300) {
						const body = yield* response.text.pipe(Effect.orElseSucceed(() => "<unreadable body>"));
						return yield* Effect.fail(
							new OidcTokenError({
								reason: "http",
								message: `OIDC token request returned ${response.status}: ${body.slice(0, 200)}`,
							}),
						);
					}

					const parsed = yield* HttpClientResponse.schemaBodyJson(OidcTokenResponse)(response).pipe(
						Effect.mapError(
							(cause) =>
								new OidcTokenError({
									reason: "decode",
									message: `OIDC token response did not match the expected shape: ${cause}`,
									cause,
								}),
						),
					);

					return Redacted.make(parsed.value);
				}),
		};
	}),
);

/**
 * Save the redacted OIDC token to disk for local inspection.
 *
 * @remarks
 * Convenience helper used during development to dump the JWT payload so
 * you can decode it (e.g. with `jwt.io`) and inspect the claims. The
 * redacted wrapper is unwrapped at the call site so the value lands on
 * disk as plain text — only use this against a tmpdir.
 *
 * @public
 */
export const saveToken = (
	token: Redacted.Redacted<string>,
	path: string,
): Effect.Effect<void, OidcTokenError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const payload = JSON.stringify({ token: Redacted.value(token) }, null, 2);
		yield* fs.writeFileString(path, payload).pipe(
			Effect.mapError(
				(error) =>
					new OidcTokenError({
						reason: "save",
						message: `Failed to write OIDC token to ${path}: ${error.message}`,
						cause: error,
					}),
			),
		);
	});
