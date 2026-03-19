import { createAppAuth } from "@octokit/auth-app";
import { Effect, Layer } from "effect";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import type { InstallationToken } from "../services/GitHubApp.js";
import { GitHubApp } from "../services/GitHubApp.js";

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

const resolveInstallationId = async (auth: (opts: { type: "app" }) => Promise<{ token: string }>): Promise<number> => {
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
	appId: string,
	privateKey: string,
	installationId?: number,
): Effect.Effect<InstallationToken, GitHubAppError> =>
	Effect.tryPromise({
		try: async () => {
			const auth = createAppAuth({ appId, privateKey });

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
	}).pipe(Effect.withSpan("GitHubApp.generateToken"));

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
	}).pipe(Effect.withSpan("GitHubApp.revokeToken"));

/**
 * Live implementation of GitHubApp using octokit auth-app.
 *
 * @public
 */
export const GitHubAppLive: Layer.Layer<GitHubApp> = Layer.succeed(GitHubApp, {
	generateToken,
	revokeToken,

	botIdentity: (appSlug) => {
		const name = appSlug ? `${appSlug}[bot]` : "github-actions[bot]";
		const email = appSlug
			? `${name}@users.noreply.github.com`
			: "41898282+github-actions[bot]@users.noreply.github.com";
		return { name, email };
	},

	withToken: (appId, privateKey, effect) =>
		Effect.acquireUseRelease(
			generateToken(appId, privateKey),
			(tokenInfo) => effect(tokenInfo.token),
			(tokenInfo) => revokeToken(tokenInfo.token).pipe(Effect.catchAll(() => Effect.void)),
		).pipe(Effect.withSpan("GitHubApp.withToken")),
});
