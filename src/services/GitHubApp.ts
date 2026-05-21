import type { Effect, Redacted } from "effect";
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
	// `Schema.Redacted(Schema.String)` decodes a stored string into
	// `Redacted<string>` (so application code can never accidentally
	// log/echo/`String()` the token) and encodes back to the raw string for
	// the `GITHUB_STATE` env file. The on-disk bytes are unchanged.
	token: Schema.Redacted(Schema.String),
	expiresAt: Schema.String,
	installationId: Schema.Number,
	appSlug: Schema.optional(Schema.String),
	appUserId: Schema.optional(Schema.Number),
	appName: Schema.optional(Schema.String),
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
 * Service for GitHub App authentication lifecycle.
 *
 * @public
 */
export class GitHubApp extends Context.Tag("github-action-effects/GitHubApp")<
	GitHubApp,
	{
		/** Generate an installation token for the GitHub App. */
		readonly generateToken: (
			appId: string,
			privateKey: Redacted.Redacted<string>,
			installationId?: number,
		) => Effect.Effect<InstallationToken, GitHubAppError>;

		/** Revoke a previously generated installation token. */
		readonly revokeToken: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>;

		/**
		 * Resolve the App's public identity — slug, bot user ID, and name —
		 * via `GET /app` (App JWT) and `GET /users/<slug>[bot]`.
		 *
		 * `GET /users` is a public endpoint that rejects the App JWT. Pass an
		 * `installationToken` to authenticate that lookup (5000 req/hour);
		 * when omitted, the lookup runs unauthenticated (60 req/hour per IP).
		 */
		readonly resolveAppIdentity: (
			appId: string,
			privateKey: Redacted.Redacted<string>,
			installationToken?: Redacted.Redacted<string>,
		) => Effect.Effect<{ appSlug: string; appUserId: number; appName: string }, GitHubAppError>;

		/**
		 * Derive a bot identity for commit/tag attribution.
		 *
		 * When both `appSlug` and `appUserId` are supplied, returns a verified
		 * identity whose email carries the numeric user-ID prefix GitHub
		 * recognises. Otherwise returns the well-known `github-actions[bot]`
		 * identity. Read the persisted token via `GitHubToken.read()` to obtain
		 * the resolved `appSlug` / `appUserId`.
		 */
		readonly botIdentity: (source?: {
			readonly appSlug?: string | undefined;
			readonly appUserId?: number | undefined;
		}) => BotIdentity;

		/**
		 * Bracket pattern: generate token, run effect, then revoke.
		 * Token is always revoked, even on failure.
		 */
		readonly withToken: <A, E, R>(
			appId: string,
			privateKey: Redacted.Redacted<string>,
			effect: (token: Redacted.Redacted<string>) => Effect.Effect<A, E, R>,
		) => Effect.Effect<A, E | GitHubAppError, R>;
	}
>() {}
