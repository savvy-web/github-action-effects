import { Data } from "effect";

/**
 * Error when GitHub API rate limit is exhausted or nearly exhausted.
 */
export class RateLimitError extends Data.TaggedError("RateLimitError")<{
	/** Which API is rate limited. */
	readonly api: "rest" | "graphql";

	/** Remaining requests before exhaustion. */
	readonly remaining: number;

	/** ISO timestamp when the rate limit resets. */
	readonly resetAt: string;

	/** Human-readable description. */
	readonly reason: string;
}> {}
