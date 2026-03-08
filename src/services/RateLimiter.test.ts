import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RateLimiterTest } from "../layers/RateLimiterTest.js";
import { RateLimiter } from "./RateLimiter.js";

const provide = <A, E>(state: ReturnType<typeof RateLimiterTest.empty>, effect: Effect.Effect<A, E, RateLimiter>) =>
	Effect.provide(effect, RateLimiterTest.layer(state));

const run = <A, E>(state: ReturnType<typeof RateLimiterTest.empty>, effect: Effect.Effect<A, E, RateLimiter>) =>
	Effect.runPromise(provide(state, effect));

describe("RateLimiter", () => {
	describe("checkRest", () => {
		it("returns configured rest status", async () => {
			const state = RateLimiterTest.empty();
			state.restStatus = { limit: 5000, remaining: 4500, reset: state.restStatus.reset, used: 500 };

			const result = await run(
				state,
				Effect.flatMap(RateLimiter, (svc) => svc.checkRest()),
			);

			expect(result.remaining).toBe(4500);
			expect(result.used).toBe(500);
			expect(state.checkRestCalls).toHaveLength(1);
		});
	});

	describe("checkGraphQL", () => {
		it("returns configured graphql status", async () => {
			const state = RateLimiterTest.empty();
			state.graphqlStatus = { limit: 5000, remaining: 3000, reset: state.graphqlStatus.reset, used: 2000 };

			const result = await run(
				state,
				Effect.flatMap(RateLimiter, (svc) => svc.checkGraphQL()),
			);

			expect(result.remaining).toBe(3000);
			expect(result.limit).toBe(5000);
			expect(state.checkGraphQLCalls).toHaveLength(1);
		});
	});

	describe("withRateLimit", () => {
		it("runs effect when under threshold", async () => {
			const state = RateLimiterTest.empty();
			const result = await run(
				state,
				Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))),
			);
			expect(result).toBe("ok");
		});
	});

	describe("withRetry", () => {
		it("runs effect directly in test layer", async () => {
			const state = RateLimiterTest.empty();
			const result = await run(
				state,
				Effect.flatMap(RateLimiter, (svc) => svc.withRetry(Effect.succeed(42))),
			);
			expect(result).toBe(42);
		});
	});
});
