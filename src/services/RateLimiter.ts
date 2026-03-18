import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import type { RateLimitError } from "../errors/RateLimitError.js";
import type { RateLimitStatus } from "../schemas/RateLimit.js";

/**
 * Service for GitHub API rate limit awareness.
 *
 * @public
 */
export class RateLimiter extends Context.Tag("github-action-effects/RateLimiter")<
	RateLimiter,
	{
		/** Check current REST API rate limit status. */
		readonly checkRest: () => Effect.Effect<RateLimitStatus, GitHubClientError>;

		/** Check current GraphQL API rate limit status. */
		readonly checkGraphQL: () => Effect.Effect<RateLimitStatus, GitHubClientError>;

		/**
		 * Guard an effect with a rate limit check.
		 * If remaining requests are below 10% of the limit, waits until reset
		 * (up to 60s) or fails with RateLimitError.
		 */
		readonly withRateLimit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | RateLimitError, R>;

		/**
		 * Retry an effect with exponential backoff on failure.
		 */
		readonly withRetry: <A, E, R>(
			effect: Effect.Effect<A, E, R>,
			options?: { readonly maxRetries?: number; readonly baseDelay?: number },
		) => Effect.Effect<A, E, R>;
	}
>() {}
