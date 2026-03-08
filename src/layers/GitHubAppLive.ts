import { Effect, Layer } from "effect";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import { GitHubApp } from "../services/GitHubApp.js";

/**
 * Live implementation of GitHubApp using octokit auth-app.
 *
 * @public
 */
export const GitHubAppLive: Layer.Layer<GitHubApp> = Layer.succeed(GitHubApp, {
	generateToken: (appId, privateKey, installationId?) =>
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
				};
			},
			catch: (error) => new GitHubAppError({ operation: "token", reason: String(error) }),
		}).pipe(Effect.withSpan("GitHubApp.generateToken")),

	revokeToken: (token) =>
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
		}).pipe(Effect.withSpan("GitHubApp.revokeToken")),

	withToken: (appId, privateKey, effect) =>
		Effect.acquireUseRelease(
			Effect.tryPromise({
				try: async () => {
					const { createAppAuth } = await import("@octokit/auth-app");
					const auth = createAppAuth({ appId, privateKey });
					const result = await auth({ type: "installation" });
					return {
						token: result.token,
						expiresAt: result.expiresAt,
						installationId: result.installationId,
					};
				},
				catch: (error) => new GitHubAppError({ operation: "token", reason: String(error) }),
			}),
			(tokenInfo) => effect(tokenInfo.token),
			(tokenInfo) =>
				Effect.tryPromise({
					try: async () => {
						const response = await fetch("https://api.github.com/installation/token", {
							method: "DELETE",
							headers: {
								Authorization: `token ${tokenInfo.token}`,
								Accept: "application/vnd.github+json",
							},
						});
						if (!response.ok && response.status !== 204) {
							throw new Error(`Revoke failed: ${response.status}`);
						}
					},
					catch: (error) => new GitHubAppError({ operation: "revoke", reason: String(error) }),
				}).pipe(Effect.catchAll(() => Effect.void)),
		).pipe(Effect.withSpan("GitHubApp.withToken")),
});
