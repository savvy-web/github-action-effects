import { Schema } from "effect";

/**
 * Schema for GitHub API rate limit status.
 *
 * @public
 */
export const RateLimitStatus = Schema.Struct({
	limit: Schema.Number,
	remaining: Schema.Number,
	reset: Schema.Number,
	used: Schema.Number,
}).annotations({ identifier: "RateLimitStatus" });

/**
 * Decoded type for RateLimitStatus.
 *
 * @public
 */
export type RateLimitStatus = typeof RateLimitStatus.Type;
