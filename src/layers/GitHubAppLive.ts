import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Effect, Layer, Redacted, Schema } from "effect";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import type { InstallationToken } from "../services/GitHubApp.js";
import { GitHubApp } from "../services/GitHubApp.js";
import type { AppAuth } from "../services/OctokitAuthApp.js";
import { OctokitAuthApp } from "../services/OctokitAuthApp.js";
import { formatBotIdentity } from "../utils/botIdentity.js";

interface Installation {
	readonly id: number;
	readonly account: { readonly login: string } | null;
}

/** Response schema for `GET /app/installations`. */
const InstallationsPage = Schema.Array(
	Schema.Struct({
		id: Schema.Number,
		account: Schema.NullOr(Schema.Struct({ login: Schema.String })),
	}),
);

/** Response schema for `GET /app`. */
const AppResponse = Schema.Struct({
	slug: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
});

/** Response schema for `GET /users/<slug>[bot]`. */
const UserResponse = Schema.Struct({ id: Schema.Number });

const githubError = (operation: "token" | "identity" | "revoke", reason: string): GitHubAppError =>
	new GitHubAppError({ operation, reason });

/**
 * Page through `GET /app/installations`, following the `Link: rel="next"`
 * header. The App JWT is unwrapped only inside the request builder.
 */
const fetchAllInstallations = (
	http: HttpClient.HttpClient,
	jwt: string,
): Effect.Effect<ReadonlyArray<Installation>, GitHubAppError> => {
	const loop = (
		url: string,
		acc: ReadonlyArray<Installation>,
	): Effect.Effect<ReadonlyArray<Installation>, GitHubAppError> =>
		Effect.gen(function* () {
			const request = HttpClientRequest.get(url).pipe(
				HttpClientRequest.bearerToken(jwt),
				HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
			);
			const response = yield* http
				.execute(request)
				.pipe(Effect.mapError((cause) => githubError("token", `list installations: ${cause.message}`)));
			if (response.status < 200 || response.status >= 300) {
				return yield* Effect.fail(githubError("token", `Failed to list installations: ${response.status}`));
			}
			const page = yield* HttpClientResponse.schemaBodyJson(InstallationsPage)(response).pipe(
				Effect.mapError((cause) => githubError("token", `decode installations: ${cause}`)),
			);
			const next = [...acc, ...page];
			const linkHeader = response.headers.link;
			const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
			if (nextMatch?.[1]) {
				return yield* loop(nextMatch[1], next);
			}
			return next;
		});

	return loop("https://api.github.com/app/installations?per_page=100", []);
};

const resolveInstallationId = (http: HttpClient.HttpClient, auth: AppAuth): Effect.Effect<number, GitHubAppError> =>
	Effect.gen(function* () {
		const jwt = yield* Effect.tryPromise({
			try: async () => (await auth({ type: "app" })).token,
			catch: (error) => githubError("token", String(error)),
		});
		const installations = yield* fetchAllInstallations(http, jwt);

		if (installations.length === 0) {
			return yield* Effect.fail(githubError("token", "No installations found for this GitHub App"));
		}

		const repo = process.env.GITHUB_REPOSITORY;
		if (repo) {
			const owner = repo.split("/")[0];
			const match = installations.find((i) => i.account?.login?.toLowerCase() === owner?.toLowerCase());
			if (match) return match.id;
			return yield* Effect.fail(
				githubError(
					"token",
					`No installation found for owner "${owner}" (from GITHUB_REPOSITORY="${repo}"). ` +
						`Available installations: ${installations.map((i) => i.account?.login ?? "unknown").join(", ")}`,
				),
			);
		}

		return installations[0].id;
	});

const generateToken = (
	http: HttpClient.HttpClient,
	authApp: OctokitAuthApp["Type"],
	appId: string,
	privateKey: Redacted.Redacted<string>,
	installationId?: number,
): Effect.Effect<InstallationToken, GitHubAppError> =>
	Effect.gen(function* () {
		// Unwrap the private key only at the `createAppAuth` wire boundary.
		const auth = authApp.createAppAuth({ appId, privateKey: Redacted.value(privateKey) });

		const resolvedId = installationId ?? (yield* resolveInstallationId(http, auth));

		const result = yield* Effect.tryPromise({
			try: () => auth({ type: "installation", installationId: resolvedId }),
			catch: (error) => githubError("token", String(error)),
		});
		return {
			// The minted installation token is itself a live credential; keep it
			// redacted from here on.
			token: Redacted.make(result.token),
			expiresAt: result.expiresAt,
			installationId: result.installationId,
			permissions: result.permissions ?? {},
		};
	});

const resolveAppIdentity = (
	http: HttpClient.HttpClient,
	authApp: OctokitAuthApp["Type"],
	appId: string,
	privateKey: Redacted.Redacted<string>,
	installationToken?: Redacted.Redacted<string>,
): Effect.Effect<{ appSlug: string; appUserId: number; appName: string }, GitHubAppError> =>
	Effect.gen(function* () {
		const auth = authApp.createAppAuth({ appId, privateKey: Redacted.value(privateKey) });
		const jwt = yield* Effect.tryPromise({
			try: async () => (await auth({ type: "app" })).token,
			catch: (error) => githubError("identity", String(error)),
		});

		const appRequest = HttpClientRequest.get("https://api.github.com/app").pipe(
			HttpClientRequest.bearerToken(jwt),
			HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
		);
		const appResponse = yield* http
			.execute(appRequest)
			.pipe(Effect.mapError((cause) => githubError("identity", `GET /app failed: ${cause.message}`)));
		if (appResponse.status < 200 || appResponse.status >= 300) {
			return yield* Effect.fail(githubError("identity", `GET /app failed: ${appResponse.status}`));
		}
		const appData = yield* HttpClientResponse.schemaBodyJson(AppResponse)(appResponse).pipe(
			Effect.mapError((cause) => githubError("identity", `decode /app: ${cause}`)),
		);

		if (!appData.slug) {
			return yield* Effect.fail(
				githubError("identity", "GET /app returned no slug; cannot resolve the bot user identity"),
			);
		}

		const botLogin = `${appData.slug}[bot]`;
		// `GET /users/{username}` is public but the App JWT is NOT valid there —
		// authenticate with the installation token when available (5000 req/hour),
		// otherwise fall back to an unauthenticated request (60 req/hour per IP).
		let userRequest = HttpClientRequest.get(`https://api.github.com/users/${encodeURIComponent(botLogin)}`).pipe(
			HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
		);
		if (installationToken !== undefined) {
			// Unwrap the installation token only at the request bearer boundary.
			userRequest = userRequest.pipe(HttpClientRequest.bearerToken(Redacted.value(installationToken)));
		}
		const userResponse = yield* http
			.execute(userRequest)
			.pipe(Effect.mapError((cause) => githubError("identity", `GET /users/${botLogin} failed: ${cause.message}`)));
		if (userResponse.status < 200 || userResponse.status >= 300) {
			return yield* Effect.fail(githubError("identity", `GET /users/${botLogin} failed: ${userResponse.status}`));
		}
		const userData = yield* HttpClientResponse.schemaBodyJson(UserResponse)(userResponse).pipe(
			Effect.mapError((cause) => githubError("identity", `decode /users: ${cause}`)),
		);

		return { appSlug: appData.slug, appUserId: userData.id, appName: appData.name ?? appData.slug };
	});

const revokeToken = (
	http: HttpClient.HttpClient,
	token: Redacted.Redacted<string>,
): Effect.Effect<void, GitHubAppError> =>
	Effect.gen(function* () {
		const request = HttpClientRequest.del("https://api.github.com/installation/token").pipe(
			// `token <value>` (not `Bearer`) is the revoke endpoint's scheme.
			HttpClientRequest.setHeader("Authorization", `token ${Redacted.value(token)}`),
			HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
		);
		const response = yield* http
			.execute(request)
			.pipe(Effect.mapError((cause) => githubError("revoke", `Revoke failed: ${cause.message}`)));
		// 204 is the documented success status; tolerate any 2xx, and the special
		// 204 case is preserved.
		if (response.status !== 204 && (response.status < 200 || response.status >= 300)) {
			return yield* Effect.fail(githubError("revoke", `Revoke failed: ${response.status}`));
		}
	});

/**
 * Live implementation of GitHubApp using octokit auth-app and the
 * `@effect/platform` `HttpClient`.
 *
 * @public
 */
export const GitHubAppLive: Layer.Layer<GitHubApp, never, OctokitAuthApp | HttpClient.HttpClient> = Layer.effect(
	GitHubApp,
	Effect.gen(function* () {
		const authApp = yield* OctokitAuthApp;
		const http = yield* HttpClient.HttpClient;

		return {
			generateToken: (appId, privateKey, installationId) =>
				generateToken(http, authApp, appId, privateKey, installationId),

			resolveAppIdentity: (appId, privateKey, installationToken) =>
				resolveAppIdentity(http, authApp, appId, privateKey, installationToken),

			revokeToken: (token) => revokeToken(http, token),

			botIdentity: formatBotIdentity,

			withToken: (appId, privateKey, effect) =>
				Effect.acquireUseRelease(
					generateToken(http, authApp, appId, privateKey),
					(tokenInfo) => effect(tokenInfo.token),
					(tokenInfo) => revokeToken(http, tokenInfo.token).pipe(Effect.catchAll(() => Effect.void)),
				),
		};
	}),
);
