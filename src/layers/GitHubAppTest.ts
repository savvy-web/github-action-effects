import { Effect, Layer } from "effect";
import type { InstallationToken } from "../services/GitHubApp.js";
import { GitHubApp } from "../services/GitHubApp.js";

/**
 * Test state for GitHubApp.
 *
 * @public
 */
export interface GitHubAppTestState {
	readonly generateCalls: Array<{ appId: string; privateKey: string; installationId?: number }>;
	readonly revokeCalls: Array<string>;
	readonly tokenToReturn: InstallationToken;
}

const makeTestGitHubApp = (state: GitHubAppTestState): typeof GitHubApp.Service => {
	const impl: typeof GitHubApp.Service = {
		generateToken: (appId, privateKey, installationId) =>
			Effect.sync(() => {
				const call: { appId: string; privateKey: string; installationId?: number } = { appId, privateKey };
				if (installationId !== undefined) {
					call.installationId = installationId;
				}
				state.generateCalls.push(call);
				return state.tokenToReturn;
			}),

		revokeToken: (token) =>
			Effect.sync(() => {
				state.revokeCalls.push(token);
			}),

		botIdentity: (appSlug) => {
			const name = appSlug ? `${appSlug}[bot]` : "github-actions[bot]";
			const email = appSlug
				? `${name}@users.noreply.github.com`
				: "41898282+github-actions[bot]@users.noreply.github.com";
			return { name, email };
		},

		withToken: (appId, privateKey, effect) =>
			Effect.flatMap(impl.generateToken(appId, privateKey), (tokenInfo) =>
				Effect.matchCauseEffect(effect(tokenInfo.token), {
					onFailure: (cause) => Effect.flatMap(impl.revokeToken(tokenInfo.token), () => Effect.failCause(cause)),
					onSuccess: (result) => Effect.map(impl.revokeToken(tokenInfo.token), () => result),
				}),
			),
	};
	return impl;
};

/**
 * Test implementation for GitHubApp.
 *
 * @public
 */
export const GitHubAppTest = {
	/** Create test layer with configured state. */
	layer: (state: GitHubAppTestState): Layer.Layer<GitHubApp> => Layer.succeed(GitHubApp, makeTestGitHubApp(state)),

	/** Create a fresh test state with a default token. */
	empty: (): GitHubAppTestState => ({
		generateCalls: [],
		revokeCalls: [],
		tokenToReturn: {
			token: "ghs_test_token_123",
			expiresAt: "2099-01-01T00:00:00Z",
			installationId: 12345,
			permissions: {},
		},
	}),
} as const;
