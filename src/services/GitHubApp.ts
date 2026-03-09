import type { Effect } from "effect";
import { Context, Schema } from "effect";
import type { GitHubAppError } from "../errors/GitHubAppError.js";

/**
 * Bot identity for commit attribution.
 *
 * @public
 */
export interface BotIdentity {
	readonly name: string;
	readonly email: string;
}

/**
 * An installation token generated from a GitHub App.
 *
 * @public
 */
export const InstallationToken = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.String,
	installationId: Schema.Number,
	permissions: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
		default: () => ({}),
	}),
}).annotations({ identifier: "InstallationToken" });

/**
 * Decoded type for InstallationToken.
 *
 * @public
 */
export type InstallationToken = typeof InstallationToken.Type;

/**
 * Service interface for GitHub App authentication lifecycle.
 *
 * @public
 */
export interface GitHubApp {
	/** Generate an installation token for the GitHub App. */
	readonly generateToken: (
		appId: string,
		privateKey: string,
		installationId?: number,
	) => Effect.Effect<InstallationToken, GitHubAppError>;

	/** Revoke a previously generated installation token. */
	readonly revokeToken: (token: string) => Effect.Effect<void, GitHubAppError>;

	/**
	 * Get bot identity for commit attribution from an app slug.
	 *
	 * When a custom `appSlug` is provided, the email uses the format
	 * `appSlug[bot]@users.noreply.github.com` (without a numeric user-ID prefix).
	 * This may prevent commits from appearing as "verified" on GitHub.
	 * The default `github-actions[bot]` identity includes the well-known numeric
	 * ID prefix (`41898282+`) that GitHub recognises for verified attribution.
	 */
	readonly botIdentity: (appSlug?: string) => BotIdentity;

	/**
	 * Bracket pattern: generate token, run effect, then revoke.
	 * Token is always revoked, even on failure.
	 */
	readonly withToken: <A, E, R>(
		appId: string,
		privateKey: string,
		effect: (token: string) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | GitHubAppError, R>;
}

/**
 * GitHubApp tag for dependency injection.
 *
 * @public
 */
export const GitHubApp = Context.GenericTag<GitHubApp>("GitHubApp");
