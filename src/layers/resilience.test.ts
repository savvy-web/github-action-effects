import { Clock, Duration, Effect, Fiber, Ref, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { resilienceSchedule, withResilience } from "./resilience.js";

const retryableError = (overrides?: Partial<{ status: number; retryAfterMs: number }>) =>
	new GitHubClientError({
		operation: "test",
		status: overrides?.status ?? 503,
		reason: "transient",
		retryable: true,
		retryAfterMs: overrides?.retryAfterMs,
	});

const nonRetryableError = () =>
	new GitHubClientError({
		operation: "test",
		status: 404,
		reason: "not found",
		retryable: false,
		retryAfterMs: undefined,
	});

/** Run an effect that uses TestClock-driven delays; advance the clock then join. */
const runWithClock = <A, E>(effect: Effect.Effect<A, E>, advance = Duration.seconds(600)) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.fork(effect);
		yield* TestClock.adjust(advance);
		return yield* Fiber.join(fiber);
	}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

describe("resilienceSchedule", () => {
	it("does not retry non-retryable errors (single attempt)", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			withResilience(
				Effect.flatMap(
					Ref.updateAndGet(counter, (x) => x + 1),
					() => Effect.fail(nonRetryableError()),
				),
				{ maxRetries: 4 },
			),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Failure");
		expect(count).toBe(1);
	});

	it("recovers after transient failures within maxRetries", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			withResilience(
				Effect.gen(function* () {
					const n = yield* Ref.updateAndGet(counter, (x) => x + 1);
					if (n < 3) return yield* Effect.fail(retryableError());
					return n;
				}),
				{ maxRetries: 4, baseDelay: Duration.seconds(1) },
			),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Success");
		expect(count).toBe(3);
	});

	it("gives up after maxRetries on persistent retryable errors", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			withResilience(
				Effect.flatMap(
					Ref.updateAndGet(counter, (x) => x + 1),
					() => Effect.fail(retryableError()),
				),
				{ maxRetries: 4, baseDelay: Duration.seconds(1) },
			),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Failure");
		// 1 initial + 4 retries = 5 total attempts
		expect(count).toBe(5);
	});

	it("disabled resilience does not retry", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			withResilience(
				Effect.flatMap(
					Ref.updateAndGet(counter, (x) => x + 1),
					() => Effect.fail(retryableError()),
				),
				{ enabled: false },
			),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Failure");
		expect(count).toBe(1);
	});

	it("caps each backoff delay at maxDelay", async () => {
		// Record the wall-clock time before each attempt to measure inter-attempt sleeps.
		const timestamps = await Effect.runPromise(Ref.make<Array<number>>([]));
		const counter = await Effect.runPromise(Ref.make(0));
		await runWithClock(
			withResilience(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					yield* Ref.update(timestamps, (xs) => [...xs, now]);
					const n = yield* Ref.updateAndGet(counter, (x) => x + 1);
					if (n < 5) return yield* Effect.fail(retryableError());
					return n;
				}),
				{ maxRetries: 10, baseDelay: Duration.seconds(1), maxDelay: Duration.seconds(5) },
			),
		);
		const stamps = await Effect.runPromise(Ref.get(timestamps));
		const deltas = stamps.slice(1).map((t, i) => t - stamps[i]);
		// With baseDelay 1s doubling (1,2,4,8,...) but capped at 5s, no inter-attempt
		// sleep may exceed the cap (allow small jitter slack above the cap).
		for (const d of deltas) {
			expect(d).toBeLessThanOrEqual(5000 + 1);
		}
	});

	it("honors retryAfterMs over the exponential backoff", async () => {
		const timestamps = await Effect.runPromise(Ref.make<Array<number>>([]));
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			withResilience(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					yield* Ref.update(timestamps, (xs) => [...xs, now]);
					const n = yield* Ref.updateAndGet(counter, (x) => x + 1);
					// First attempt fails with a server-advised 7s delay, then succeeds.
					if (n < 2) return yield* Effect.fail(retryableError({ retryAfterMs: 7000 }));
					return n;
				}),
				{ maxRetries: 4, baseDelay: Duration.seconds(1), maxDelay: Duration.seconds(30) },
			),
		);
		const stamps = await Effect.runPromise(Ref.get(timestamps));
		expect(exit._tag).toBe("Success");
		// The single inter-attempt sleep must be the advised 7s, not the 1s base.
		expect(stamps.length).toBe(2);
		expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(7000);
	});

	it("falls back to exponential when retryAfterMs is absent", async () => {
		const timestamps = await Effect.runPromise(Ref.make<Array<number>>([]));
		const counter = await Effect.runPromise(Ref.make(0));
		await runWithClock(
			withResilience(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					yield* Ref.update(timestamps, (xs) => [...xs, now]);
					const n = yield* Ref.updateAndGet(counter, (x) => x + 1);
					if (n < 2) return yield* Effect.fail(retryableError());
					return n;
				}),
				{ maxRetries: 4, baseDelay: Duration.seconds(1), maxDelay: Duration.seconds(30) },
			),
		);
		const stamps = await Effect.runPromise(Ref.get(timestamps));
		// The single inter-attempt sleep is roughly the 1s base (jittered, so < 7s).
		expect(stamps[1] - stamps[0]).toBeLessThan(7000);
	});

	it("resilienceSchedule retries retryable errors and stops at maxRetries", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			Effect.flatMap(
				Ref.updateAndGet(counter, (x) => x + 1),
				() => Effect.fail(retryableError()),
			).pipe(Effect.retry(resilienceSchedule({ maxRetries: 2, baseDelay: Duration.seconds(1) }))),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Failure");
		// 1 initial + 2 retries = 3 attempts.
		expect(count).toBe(3);
	});

	it("resilienceSchedule does not recur on non-retryable errors", async () => {
		const counter = await Effect.runPromise(Ref.make(0));
		const exit = await runWithClock(
			Effect.flatMap(
				Ref.updateAndGet(counter, (x) => x + 1),
				() => Effect.fail(nonRetryableError()),
			).pipe(Effect.retry(resilienceSchedule({ maxRetries: 4 }))),
		);
		const count = await Effect.runPromise(Ref.get(counter));
		expect(exit._tag).toBe("Failure");
		expect(count).toBe(1);
	});
});
