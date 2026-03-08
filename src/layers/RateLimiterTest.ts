import { Effect, Layer } from "effect";
import type { RateLimitStatus } from "../schemas/RateLimit.js";
import { RateLimiter } from "../services/RateLimiter.js";

/**
 * Test state for RateLimiter.
 *
 * @public
 */
export interface RateLimiterTestState {
	readonly checkRestCalls: Array<void>;
	readonly checkGraphQLCalls: Array<void>;
	restStatus: RateLimitStatus;
	graphqlStatus: RateLimitStatus;
}

const makeTestRateLimiter = (state: RateLimiterTestState): RateLimiter => ({
	checkRest: () =>
		Effect.sync(() => {
			state.checkRestCalls.push(undefined);
			return state.restStatus;
		}),

	checkGraphQL: () =>
		Effect.sync(() => {
			state.checkGraphQLCalls.push(undefined);
			return state.graphqlStatus;
		}),

	withRateLimit: (effect) => effect,

	withRetry: (effect) => effect,
});

const defaultStatus: RateLimitStatus = {
	limit: 5000,
	remaining: 4999,
	reset: Math.floor(Date.now() / 1000) + 3600,
	used: 1,
};

/**
 * Test implementation for RateLimiter.
 *
 * @public
 */
export const RateLimiterTest = {
	/** Create test layer with configured state. */
	layer: (state: RateLimiterTestState): Layer.Layer<RateLimiter> =>
		Layer.succeed(RateLimiter, makeTestRateLimiter(state)),

	/** Create a fresh test state with default (healthy) rate limits. */
	empty: (): RateLimiterTestState => ({
		checkRestCalls: [],
		checkGraphQLCalls: [],
		restStatus: { ...defaultStatus },
		graphqlStatus: { ...defaultStatus },
	}),
} as const;
