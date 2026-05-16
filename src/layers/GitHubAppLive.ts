import { Effect, Layer } from "effect";
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

const fetchAllInstallations = async (jwt: string): Promise<Array<Installation>> => {
	const installations: Array<Installation> = [];
	let url: string | null = "https://api.github.com/app/installations?per_page=100";

	while (url) {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to list installations: ${response.status}`);
		}

		const page = (await response.json()) as Array<Installation>;
		installations.push(...page);

		const linkHeader = response.headers.get("link");
		const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
		url = nextMatch ? nextMatch[1] : null;
	}

	return installations;
};

const resolveInstallationId = async (auth: AppAuth): Promise<number> => {
	const { token: jwt } = await auth({ type: "app" });
	const installations = await fetchAllInstallations(jwt);

	if (installations.length === 0) {
		throw new Error("No installations found for this GitHub App");
	}

	const repo = process.env.GITHUB_REPOSITORY;
	if (repo) {
		const owner = repo.split("/")[0];
		const match = installations.find((i) => i.account?.login?.toLowerCase() === owner?.toLowerCase());
		if (match) return match.id;
		throw new Error(
			`No installation found for owner "${owner}" (from GITHUB_REPOSITORY="${repo}"). ` +
				`Available installations: ${installations.map((i) => i.account?.login ?? "unknown").join(", ")}`,
		);
	}

	return installations[0].id;
};

const generateToken = (
	authApp: OctokitAuthApp["Type"],
	appId: string,
	privateKey: string,
	installationId?: number,
): Effect.Effect<InstallationToken, GitHubAppError> =>
	Effect.tryPromise({
		try: async () => {
			const auth = authApp.createAppAuth({ appId, privateKey });

			const resolvedId = installationId ?? (await resolveInstallationId(auth));

			const result = await auth({
				type: "installation",
				installationId: resolvedId,
			});
			return {
				token: result.token,
				expiresAt: result.expiresAt,
				installationId: result.installationId,
				permissions: result.permissions ?? {},
			};
		},
		catch: (error) => new GitHubAppError({ operation: "token", reason: String(error) }),
	});

const resolveAppIdentity = (
	authApp: OctokitAuthApp["Type"],
	appId: string,
	privateKey: string,
): Effect.Effect<{ appSlug: string; appUserId: number; appName: string }, GitHubAppError> =>
	Effect.tryPromise({
		try: async () => {
			const auth = authApp.createAppAuth({ appId, privateKey });
			const { token: jwt } = await auth({ type: "app" });

			const appResponse = await fetch("https://api.github.com/app", {
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!appResponse.ok) {
				throw new Error(`GET /app failed: ${appResponse.status}`);
			}
			const appData = (await appResponse.json()) as { slug: string; name: string };

			const botLogin = `${appData.slug}[bot]`;
			// Authenticate the public users lookup with the App JWT: an
			// unauthenticated request shares the 60 req/hour IP rate limit,
			// the JWT bumps it to 5000/hour at no extra cost.
			const userResponse = await fetch(`https://api.github.com/users/${encodeURIComponent(botLogin)}`, {
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!userResponse.ok) {
				throw new Error(`GET /users/<slug>[bot] failed: ${userResponse.status}`);
			}
			const userData = (await userResponse.json()) as { id: number };

			return { appSlug: appData.slug, appUserId: userData.id, appName: appData.name };
		},
		catch: (error) => new GitHubAppError({ operation: "identity", reason: String(error) }),
	});

const revokeToken = (token: string): Effect.Effect<void, GitHubAppError> =>
	Effect.tryPromise({
		try: async () => {
			const response = await fetch("https://api.github.com/installation/token", {
				method: "DELETE",
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!response.ok && response.status !== 204) {
				throw new Error(`Revoke failed: ${response.status}`);
			}
		},
		catch: (error) => new GitHubAppError({ operation: "revoke", reason: String(error) }),
	});

/**
 * Live implementation of GitHubApp using octokit auth-app.
 *
 * @public
 */
export const GitHubAppLive: Layer.Layer<GitHubApp, never, OctokitAuthApp> = Layer.effect(
	GitHubApp,
	Effect.gen(function* () {
		const authApp = yield* OctokitAuthApp;

		return {
			generateToken: (appId, privateKey, installationId) => generateToken(authApp, appId, privateKey, installationId),

			resolveAppIdentity: (appId, privateKey) => resolveAppIdentity(authApp, appId, privateKey),

			revokeToken,

			botIdentity: formatBotIdentity,

			withToken: (appId, privateKey, effect) =>
				Effect.acquireUseRelease(
					generateToken(authApp, appId, privateKey),
					(tokenInfo) => effect(tokenInfo.token),
					(tokenInfo) => revokeToken(tokenInfo.token).pipe(Effect.catchAll(() => Effect.void)),
				),
		};
	}),
);
