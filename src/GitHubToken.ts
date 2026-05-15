import type { ConfigError } from "effect";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import type { ActionStateError } from "./errors/ActionStateError.js";
import type { GitHubAppError } from "./errors/GitHubAppError.js";
import type { TokenPermissionError } from "./errors/TokenPermissionError.js";
import { GitHubClientLive } from "./layers/GitHubClientLive.js";
import { TokenPermissionCheckerLive } from "./layers/TokenPermissionCheckerLive.js";
import type { PermissionLevel } from "./schemas/TokenPermission.js";
import { ActionState } from "./services/ActionState.js";
import { GitHubApp, InstallationToken } from "./services/GitHubApp.js";
import type { GitHubClient } from "./services/GitHubClient.js";
import { TokenPermissionChecker } from "./services/TokenPermissionChecker.js";

/** Internal ActionState key for the persisted installation-token envelope. */
const STATE_KEY = "github-action-effects/installation-token";

/** Unwrap a value that may be plain or Redacted. */
const unwrap = (value: string | Redacted.Redacted<string>): string =>
	typeof value === "string" ? value : Redacted.value(value);

/** Options for {@link GitHubToken.provision}. */
export interface ProvisionOptions {
	/** App client ID. Defaults to the `app-client-id` action input. */
	readonly clientId?: string;
	/** App private key. Defaults to the `app-private-key` action input. */
	readonly privateKey?: string | Redacted.Redacted<string>;
	/** Target installation ID. Auto-resolved from the repo owner when omitted. */
	readonly installationId?: number;
	/** When set, the generated token is verified to grant at least these scopes. */
	readonly permissions?: Record<string, PermissionLevel>;
}

const provision = (
	options?: ProvisionOptions,
): Effect.Effect<
	InstallationToken,
	GitHubAppError | TokenPermissionError | ActionStateError | ConfigError.ConfigError,
	ActionState | GitHubApp
> =>
	Effect.gen(function* () {
		const clientId = options?.clientId ?? (yield* Config.string("app-client-id"));
		const privateKey =
			options?.privateKey !== undefined
				? unwrap(options.privateKey)
				: Redacted.value(yield* Config.redacted("app-private-key"));

		const app = yield* GitHubApp;
		const token = yield* app.generateToken(clientId, privateKey, options?.installationId);

		const required = options?.permissions;
		if (required !== undefined) {
			yield* Effect.flatMap(TokenPermissionChecker, (checker) => checker.assertSufficient(required)).pipe(
				Effect.provide(TokenPermissionCheckerLive(token.permissions)),
			);
		}

		const state = yield* ActionState;
		yield* state.save(STATE_KEY, token, InstallationToken);

		return token;
	});

const client = (): Layer.Layer<GitHubClient, ActionStateError, ActionState> =>
	Layer.unwrapEffect(
		Effect.gen(function* () {
			const state = yield* ActionState;
			const token = yield* state.get(STATE_KEY, InstallationToken);
			return GitHubClientLive.fromToken(token.token);
		}),
	);

const dispose = (): Effect.Effect<void, GitHubAppError | ActionStateError, ActionState | GitHubApp> =>
	Effect.gen(function* () {
		const state = yield* ActionState;
		const persisted = yield* state.getOptional(STATE_KEY, InstallationToken);
		if (Option.isNone(persisted)) {
			return;
		}
		const app = yield* GitHubApp;
		yield* app.revokeToken(persisted.value.token);
	});

/**
 * Phase-oriented helpers for the GitHub App installation-token lifecycle:
 * `provision` in `pre`, `client` in `main`, `dispose` in `post`.
 *
 * `provision` and `dispose` require a `GitHubApp` layer in context — provide
 * `GitHubAppLive` (composed with `OctokitAuthAppLive`) in production, or
 * `GitHubAppTest` in tests. `client` requires `ActionState`.
 *
 * @public
 */
export const GitHubToken = {
	provision,
	client,
	dispose,
} as const;
