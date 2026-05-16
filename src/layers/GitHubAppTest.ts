import { Effect, Layer } from "effect";
import { GitHubAppError } from "../errors/GitHubAppError.js";
import type { InstallationToken } from "../services/GitHubApp.js";
import { GitHubApp } from "../services/GitHubApp.js";
import { formatBotIdentity } from "../utils/botIdentity.js";

/**
 * Test state for GitHubApp.
 *
 * @public
 */
export interface GitHubAppTestState {
	readonly generateCalls: Array<{ appId: string; privateKey: string; installationId?: number }>;
	readonly revokeCalls: Array<string>;
	readonly tokenToReturn: InstallationToken;
	/**
	 * Identity returned by `resolveAppIdentity`. When omitted, `resolveAppIdentity`
	 * fails — exercising `provision`'s best-effort degradation path.
	 */
	readonly appIdentity?: { appSlug: string; appUserId: number; appName: string };
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

		resolveAppIdentity: (_appId, _privateKey) =>
			state.appIdentity !== undefined
				? Effect.succeed(state.appIdentity)
				: Effect.fail(
						new GitHubAppError({
							operation: "identity",
							reason: "GitHubAppTest: no appIdentity configured in test state",
						}),
					),

		botIdentity: formatBotIdentity,

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
		appIdentity: { appSlug: "test-app", appUserId: 99999, appName: "Test App" },
	}),
} as const;
