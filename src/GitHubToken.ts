import type { ConfigError, Redacted } from "effect";
import { Config, Effect, Exit, Layer, Option } from "effect";
import type { ActionStateError } from "./errors/ActionStateError.js";
import type { GitHubAppError } from "./errors/GitHubAppError.js";
import type { TokenPermissionError } from "./errors/TokenPermissionError.js";
import { GitHubClientLive } from "./layers/GitHubClientLive.js";
import { TokenPermissionCheckerLive } from "./layers/TokenPermissionCheckerLive.js";
import type { PermissionLevel } from "./schemas/TokenPermission.js";
import { ActionState } from "./services/ActionState.js";
import type { BotIdentity } from "./services/GitHubApp.js";
import { GitHubApp, InstallationToken } from "./services/GitHubApp.js";
import type { GitHubClient } from "./services/GitHubClient.js";
import { TokenPermissionChecker } from "./services/TokenPermissionChecker.js";
import { formatBotIdentity } from "./utils/botIdentity.js";
import { unwrapRedacted } from "./utils/unwrapRedacted.js";

/** Internal ActionState key for the persisted installation-token envelope. */
const STATE_KEY = "github-action-effects/installation-token";

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
		const privateKey = unwrapRedacted(options?.privateKey ?? (yield* Config.redacted("app-private-key")));

		const app = yield* GitHubApp;

		// Generate the token, then verify its scopes and persist it. If either
		// step fails, revoke the token so a rejected token is not left orphaned
		// (alive until GitHub expires it) — defense-in-depth for retry loops.
		return yield* Effect.acquireUseRelease(
			app.generateToken(clientId, privateKey, options?.installationId),
			(token) =>
				Effect.gen(function* () {
					const required = options?.permissions;
					if (required !== undefined) {
						yield* Effect.flatMap(TokenPermissionChecker, (checker) => checker.assertSufficient(required)).pipe(
							Effect.provide(TokenPermissionCheckerLive(token.permissions)),
						);
					}

					// Best-effort identity resolution: a GET hiccup degrades to a
					// token without identity fields rather than failing the action.
					const identity = yield* Effect.option(app.resolveAppIdentity(clientId, privateKey));
					const enriched = Option.isSome(identity) ? { ...token, ...identity.value } : token;

					const state = yield* ActionState;
					yield* state.save(STATE_KEY, enriched, InstallationToken);

					return enriched;
				}),
			(token, exit) => (Exit.isFailure(exit) ? Effect.ignore(app.revokeToken(token.token)) : Effect.void),
		);
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

const read = (): Effect.Effect<InstallationToken, ActionStateError, ActionState> =>
	Effect.flatMap(ActionState, (state) => state.get(STATE_KEY, InstallationToken));

const botIdentity = (): Effect.Effect<BotIdentity, ActionStateError, ActionState> =>
	Effect.map(read(), (token) => formatBotIdentity({ appSlug: token.appSlug, appUserId: token.appUserId }));

/**
 * Phase-oriented helpers for the GitHub App installation-token lifecycle:
 * `provision` in `pre`, `client` in `main`, `dispose` in `post`. `read` and
 * `botIdentity` surface the persisted token (and a verified commit identity)
 * to any phase after `provision`.
 *
 * `provision` and `dispose` require a `GitHubApp` layer in context — provide
 * `GitHubAppLive` (composed with `OctokitAuthAppLive`) in production, or
 * `GitHubAppTest` in tests. `client`, `read`, and `botIdentity` require
 * `ActionState`.
 *
 * @public
 */
export const GitHubToken = {
	provision,
	client,
	read,
	botIdentity,
	dispose,
} as const;
