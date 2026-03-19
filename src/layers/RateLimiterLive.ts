import { Duration, Effect, Layer, Schedule } from "effect";
import { RateLimitError } from "../errors/RateLimitError.js";
import type { RateLimitStatus } from "../schemas/RateLimit.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { RateLimiter } from "../services/RateLimiter.js";

/** Minimal Octokit shape for rate limit API calls. */
interface OctokitRateLimit {
	readonly rest: {
		readonly rateLimit: {
			readonly get: () => Promise<{
				data: {
					resources: {
						core: RateLimitStatus;
						graphql: RateLimitStatus;
					};
				};
			}>;
		};
	};
}

const asRateLimit = (octokit: unknown): OctokitRateLimit => octokit as OctokitRateLimit;

/**
 * Executes `effect` with a pre-flight REST rate limit check.
 * Note: only checks the REST core quota. For GraphQL-heavy effects,
 * call `checkGraphQL` separately.
 */
export const RateLimiterLive: Layer.Layer<RateLimiter, never, GitHubClient> = Layer.effect(
	RateLimiter,
	Effect.map(GitHubClient, (client) => {
		/** Fetch all rate limit resources via the REST API (used by both checkRest and checkGraphQL). */
		const fetchRateLimits = () => client.rest("rate_limit", (octokit) => asRateLimit(octokit).rest.rateLimit.get());

		const checkRest = (): Effect.Effect<RateLimitStatus, import("../errors/GitHubClientError.js").GitHubClientError> =>
			fetchRateLimits().pipe(
				Effect.map((data) => {
					const typed = data as { resources: { core: RateLimitStatus } };
					return typed.resources.core;
				}),
			);

		const checkGraphQL = (): Effect.Effect<
			RateLimitStatus,
			import("../errors/GitHubClientError.js").GitHubClientError
		> =>
			fetchRateLimits().pipe(
				Effect.map((data) => {
					const typed = data as { resources: { graphql: RateLimitStatus } };
					return typed.resources.graphql;
				}),
			);

		return {
			checkRest,
			checkGraphQL,

			withRateLimit: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | RateLimitError, R> =>
				checkRest().pipe(
					Effect.mapError(
						(e): E | RateLimitError =>
							new RateLimitError({
								api: "rest",
								remaining: 0,
								resetAt: "",
								reason: `Failed to check rate limit: ${e.reason}`,
							}),
					),
					Effect.flatMap((status): Effect.Effect<A, E | RateLimitError, R> => {
						const threshold = Math.ceil(status.limit * 0.1);
						if (status.remaining <= threshold) {
							const resetDate = new Date(status.reset * 1000);
							const waitMs = Math.max(0, resetDate.getTime() - Date.now());
							if (waitMs > 60000) {
								return Effect.fail(
									new RateLimitError({
										api: "rest",
										remaining: status.remaining,
										resetAt: resetDate.toISOString(),
										reason: `Rate limit nearly exhausted (${status.remaining}/${status.limit}). Resets at ${resetDate.toISOString()}`,
									}),
								);
							}
							return Effect.sleep(Duration.millis(waitMs)).pipe(Effect.flatMap(() => effect));
						}
						return effect;
					}),
				),

			withRetry: <A, E, R>(
				effect: Effect.Effect<A, E, R>,
				options?: { readonly maxRetries?: number; readonly baseDelay?: number },
			) => {
				const maxRetries = options?.maxRetries ?? 3;
				const baseDelay = options?.baseDelay ?? 1000;
				return effect.pipe(
					Effect.retry(
						Schedule.exponential(Duration.millis(baseDelay)).pipe(Schedule.compose(Schedule.recurs(maxRetries))),
					),
				);
			},
		};
	}),
);
