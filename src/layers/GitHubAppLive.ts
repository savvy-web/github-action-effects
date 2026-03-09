import { Effect, Layer } from "effect";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import type { InstallationToken } from "../services/GitHubApp.js";
import { GitHubApp } from "../services/GitHubApp.js";

const generateToken = (
	appId: string,
	privateKey: string,
	installationId?: number,
): Effect.Effect<InstallationToken, GitHubAppError> =>
	Effect.tryPromise({
		try: async () => {
			const { createAppAuth } = await import("@octokit/auth-app");
			const auth = createAppAuth({ appId, privateKey });
			const result = await auth({
				type: "installation",
				...(installationId !== undefined ? { installationId } : {}),
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
