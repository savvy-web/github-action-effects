import { Effect, Option, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { RateLimitState } from "./RateLimitState.js";

describe("RateLimitState", () => {
	it("seeds an empty snapshot", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const ref = yield* RateLimitState;
				return yield* Ref.get(ref);
			}).pipe(Effect.provide(RateLimitState.Default)),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("can hold a snapshot once written", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const ref = yield* RateLimitState;
				yield* Ref.set(
					ref,
					Option.some({ remaining: 10, limit: 5000, resetEpochSeconds: 1700000000, observedAt: 123 }),
				);
				return yield* Ref.get(ref);
			}).pipe(Effect.provide(RateLimitState.Default)),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.remaining).toBe(10);
		}
	});
});
