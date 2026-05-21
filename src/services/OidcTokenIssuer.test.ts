/**
 * Step-2 tests for the Attest service: OIDC token issuer.
 *
 * @remarks
 * Drives `OidcTokenIssuerLive` against a mocked `HttpClient` so we can
 * exercise the env-var, transport, and decode error paths without
 * hitting the real GitHub Actions token endpoint.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { HttpClient, HttpClientResponse } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Layer, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OidcTokenError, OidcTokenIssuer, OidcTokenIssuerLive, saveToken } from "../testing.js";

interface MockResponse {
	readonly status: number;
	readonly body: string;
}

const mockHttpClient = (
	respond: (url: string, headers: Record<string, string>) => MockResponse,
): Layer.Layer<HttpClient.HttpClient> =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				const headers: Record<string, string> = {};
				for (const [k, v] of Object.entries(request.headers)) {
					if (typeof v === "string") headers[k.toLowerCase()] = v;
				}
				const { status, body } = respond(url.toString(), headers);
				return HttpClientResponse.fromWeb(
					request,
					new Response(body, { status, headers: { "content-type": "application/json" } }),
				);
			}),
		),
	);

const withEnv = <A, E, R>(
	env: Record<string, string | undefined>,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const prev: Record<string, string | undefined> = {};
			for (const [k, v] of Object.entries(env)) {
				prev[k] = process.env[k];
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
			return prev;
		}),
		() => effect,
		(prev) =>
			Effect.sync(() => {
				for (const [k, v] of Object.entries(prev)) {
					if (v === undefined) delete process.env[k];
					else process.env[k] = v;
				}
			}),
	);

describe("OidcTokenIssuer — step 2: token issuance", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "attest-oidc-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe("getToken", () => {
		it("returns a redacted JWT on a successful request", async () => {
			let capturedUrl = "";
			let capturedAuth = "";
			const http = mockHttpClient((url, headers) => {
				capturedUrl = url;
				capturedAuth = headers.authorization ?? "";
				return { status: 200, body: JSON.stringify({ value: "header.payload.signature", count: 1 }) };
			});

			const program = Effect.gen(function* () {
				const issuer = yield* OidcTokenIssuer;
				return yield* issuer.getToken("sigstore");
			});

			const token = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-bearer-token",
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/foo?api-version=2.0",
					},
					program.pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http))),
				),
			);

			expect(Redacted.value(token)).toBe("header.payload.signature");
			expect(capturedUrl).toBe("https://token.actions.githubusercontent.com/foo?api-version=2.0&audience=sigstore");
			expect(capturedAuth).toBe("Bearer runner-bearer-token");
		});

		it("omits the audience query param when not provided", async () => {
			let capturedUrl = "";
			const http = mockHttpClient((url) => {
				capturedUrl = url;
				return { status: 200, body: JSON.stringify({ value: "header.payload.signature" }) };
			});

			const program = Effect.gen(function* () {
				const issuer = yield* OidcTokenIssuer;
				return yield* issuer.getToken();
			});

			const token = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-bearer-token",
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/foo?api-version=2.0",
					},
					program.pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http))),
				),
			);

			expect(Redacted.value(token)).toBe("header.payload.signature");
			expect(capturedUrl).toBe("https://token.actions.githubusercontent.com/foo?api-version=2.0");
			expect(capturedUrl).not.toContain("audience");
		});

		it("url-encodes the audience", async () => {
			let capturedUrl = "";
			const http = mockHttpClient((url) => {
				capturedUrl = url;
				return { status: 200, body: JSON.stringify({ value: "x" }) };
			});

			await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/",
					},
					Effect.gen(function* () {
						const issuer = yield* OidcTokenIssuer;
						return yield* issuer.getToken("a b/c");
					}).pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http))),
				),
			);

			expect(capturedUrl).toContain("audience=a%20b%2Fc");
		});

		it("fails with `reason: env` when ACTIONS_ID_TOKEN_REQUEST_TOKEN is missing", async () => {
			const http = mockHttpClient(() => ({ status: 200, body: JSON.stringify({ value: "x" }) }));

			const program = Effect.gen(function* () {
				const issuer = yield* OidcTokenIssuer;
				return yield* issuer.getToken("sigstore");
			});

			const exit = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined,
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/",
					},
					program.pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http)), Effect.exit),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const cause = JSON.stringify(exit.cause);
				expect(cause).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
				expect(cause).toContain('"reason":"env"');
			}
		});

		it("fails with `reason: env` when ACTIONS_ID_TOKEN_REQUEST_URL is missing", async () => {
			const http = mockHttpClient(() => ({ status: 200, body: JSON.stringify({ value: "x" }) }));

			const exit = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
						ACTIONS_ID_TOKEN_REQUEST_URL: undefined,
					},
					Effect.gen(function* () {
						const issuer = yield* OidcTokenIssuer;
						return yield* issuer.getToken("sigstore");
					}).pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http)), Effect.exit),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(exit.cause)).toContain("ACTIONS_ID_TOKEN_REQUEST_URL");
			}
		});

		it("fails with `reason: http` on a non-2xx response", async () => {
			const http = mockHttpClient(() => ({ status: 403, body: '{"message":"Forbidden"}' }));

			const exit = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/",
					},
					Effect.gen(function* () {
						const issuer = yield* OidcTokenIssuer;
						return yield* issuer.getToken("sigstore");
					}).pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http)), Effect.exit),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const cause = JSON.stringify(exit.cause);
				expect(cause).toContain('"reason":"http"');
				expect(cause).toContain("403");
				expect(cause).toContain("Forbidden");
			}
		});

		it("fails with `reason: decode` when the response shape is wrong", async () => {
			const http = mockHttpClient(() => ({ status: 200, body: '{"not_value": "oops"}' }));

			const exit = await Effect.runPromise(
				withEnv(
					{
						ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
						ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/",
					},
					Effect.gen(function* () {
						const issuer = yield* OidcTokenIssuer;
						return yield* issuer.getToken("sigstore");
					}).pipe(Effect.provide(Layer.provide(OidcTokenIssuerLive, http)), Effect.exit),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(exit.cause)).toContain('"reason":"decode"');
			}
		});

		it("error class is OidcTokenError with the correct _tag", () => {
			const err = new OidcTokenError({ reason: "env", message: "x" });
			expect(err._tag).toBe("OidcTokenError");
			expect(err.reason).toBe("env");
		});
	});

	describe("saveToken", () => {
		it("writes the redacted JWT to disk as JSON", async () => {
			const outPath = join(tmp, "token.json");
			const token = Redacted.make("eyJhbGciOiJSUzI1NiJ9.payload.sig");

			await Effect.runPromise(
				saveToken(token, outPath).pipe(
					Effect.provide(NodeFileSystem.layer) as <A, E>(
						eff: Effect.Effect<A, E, FileSystem.FileSystem>,
					) => Effect.Effect<A, E>,
				),
			);

			const parsed = JSON.parse(readFileSync(outPath, "utf-8"));
			expect(parsed.token).toBe("eyJhbGciOiJSUzI1NiJ9.payload.sig");
		});
	});
});
