import { Data } from "effect";

/**
 * Base class for RateLimitError.
 *
 * @internal
 */
export const RateLimitErrorBase = Data.TaggedError("RateLimitError");

/**
 * Error when GitHub API rate limit is exhausted or nearly exhausted.
 */
export class RateLimitError extends RateLimitErrorBase<{
	/** Which API is rate limited. */
	readonly api: "rest" | "graphql";

	/** Remaining requests before exhaustion. */
	readonly remaining: number;

	/** ISO timestamp when the rate limit resets. */
	readonly resetAt: string;

	/** Human-readable description. */
	readonly reason: string;
}> {}
