import { Duration, Effect, Exit, Fiber, Layer, Metric, Option, Ref, Stream, TestClock, TestContext } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { rateLimitHits } from "../runtime/Telemetry.js";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value needed for Layer.succeed
import { GitHubClient } from "../services/GitHubClient.js";
import { RateLimiter } from "../services/RateLimiter.js";
import type { RateLimitSnapshot } from "../services/RateLimitState.js";
import { RateLimitState } from "../services/RateLimitState.js";
import { RateLimiterLive } from "./RateLimiterLive.js";

const mockRateLimitGet = vi.fn();
/** Records every operation name the rate limiter routes through client.rest. */
const restOperations: Array<string> = [];

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) => {
		restOperations.push(operation);
		return Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						rateLimit: { get: mockRateLimitGet },
					},
				}),
			catch: (e) =>
				new GitHubClientError({
					operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
					retryAfterMs: undefined,
				}),
		}).pipe(Effect.map((r) => r.data));
	},
	graphql: () => Effect.die("not used"),
	paginate: () => Effect.die("not used"),
	paginateStream: () => Stream.die("not used"),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const clientLayer = Layer.succeed(GitHubClient, mockClient);
const baseLayer = Layer.provideMerge(RateLimiterLive, Layer.merge(clientLayer, RateLimitState.Default));

const run = <A, E>(effect: Effect.Effect<A, E, RateLimiter>) => Effect.runPromise(Effect.provide(effect, baseLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, RateLimiter>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, baseLayer)));

/** Seed the shared RateLimitState snapshot, then run an effect against the limiter. */
const withSeededSnapshot = <A, E>(snapshot: RateLimitSnapshot, effect: Effect.Effect<A, E, RateLimiter>) =>
	Effect.gen(function* () {
		const ref = yield* RateLimitState;
		yield* Ref.set(ref, Option.some(snapshot));
		return yield* effect;
	}).pipe(Effect.provide(baseLayer));

beforeEach(() => {
	vi.clearAllMocks();
	restOperations.length = 0;
});

describe("RateLimiterLive", () => {
	describe("checkRest", () => {
		it("returns the cached snapshot without probing when the cache is warm", async () => {
			const snapshot: RateLimitSnapshot = {
				remaining: 4500,
				limit: 5000,
				resetEpochSeconds: 1700000000,
				observedAt: Date.now(),
			};
			const result = await Effect.runPromise(
				withSeededSnapshot(
					snapshot,
					Effect.flatMap(RateLimiter, (svc) => svc.checkRest()),
				),
			);
			expect(result).toEqual({ limit: 5000, remaining: 4500, reset: 1700000000, used: 500 });
			// No GET /rate_limit probe when the cache is warm.
			expect(restOperations).not.toContain("rate_limit");
			expect(mockRateLimitGet).not.toHaveBeenCalled();
		});

		it("probes GitHub on a cache miss and maps the core resource", async () => {
			mockRateLimitGet.mockResolvedValue({
				data: {
					resources: {
						core: { limit: 5000, remaining: 4500, reset: 1700000000, used: 500 },
						graphql: { limit: 5000, remaining: 5000, reset: 1700000000, used: 0 },
					},
				},
			});

			const result = await run(Effect.flatMap(RateLimiter, (svc) => svc.checkRest()));
			expect(result).toEqual({ limit: 5000, remaining: 4500, reset: 1700000000, used: 500 });
			expect(restOperations).toContain("rate_limit");
			expect(mockRateLimitGet).toHaveBeenCalledTimes(1);
		});

		it("fails on API error during a cache-miss probe", async () => {
			mockRateLimitGet.mockRejectedValue(new Error("network error"));
			const exit = await runExit(Effect.flatMap(RateLimiter, (svc) => svc.checkRest()));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("checkGraphQL", () => {
		it("probes on a cache miss and maps the graphql resource", async () => {
			mockRateLimitGet.mockResolvedValue({
				data: {
					resources: {
						core: { limit: 5000, remaining: 5000, reset: 1700000000, used: 0 },
						graphql: { limit: 5000, remaining: 3000, reset: 1700000000, used: 2000 },
					},
				},
			});

			const result = await run(Effect.flatMap(RateLimiter, (svc) => svc.checkGraphQL()));
			expect(result).toEqual({ limit: 5000, remaining: 3000, reset: 1700000000, used: 2000 });
		});

		it("always probes the graphql resource even when the REST-sourced cache is warm", async () => {
			// A warm snapshot represents the core (REST) bucket. checkGraphQL must
			// NOT serve it — REST and GraphQL have independent quotas — so it probes.
			mockRateLimitGet.mockResolvedValue({
				data: {
					resources: {
						core: { limit: 5000, remaining: 4500, reset: 1700000000, used: 500 },
						graphql: { limit: 5000, remaining: 3000, reset: 1700000000, used: 2000 },
					},
				},
			});

			const result = await Effect.runPromise(
				withSeededSnapshot(
					{ remaining: 4500, limit: 5000, resetEpochSeconds: 1700000000, observedAt: Date.now() },
					Effect.flatMap(RateLimiter, (svc) => svc.checkGraphQL()),
				),
			);

			// Returns the graphql bucket (3000), not the seeded core snapshot (4500).
			expect(result).toEqual({ limit: 5000, remaining: 3000, reset: 1700000000, used: 2000 });
			expect(restOperations).toContain("rate_limit");
			expect(mockRateLimitGet).toHaveBeenCalledTimes(1);
		});
	});

	describe("withRateLimit", () => {
		it("runs the effect without any probe when the cache is empty", async () => {
			const result = await run(Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))));
			expect(result).toBe("ok");
			// No pre-flight GET /rate_limit on an empty cache.
			expect(restOperations).not.toContain("rate_limit");
			expect(mockRateLimitGet).not.toHaveBeenCalled();
		});

		it("runs the effect when cached remaining is healthy", async () => {
			const result = await Effect.runPromise(
				withSeededSnapshot(
					{ remaining: 4000, limit: 5000, resetEpochSeconds: 1700000000, observedAt: Date.now() },
					Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))),
				),
			);
			expect(result).toBe("ok");
			expect(restOperations).not.toContain("rate_limit");
		});

		it("waits then runs when cached remaining is below the threshold and reset is near", async () => {
			const nearReset = Math.floor(Date.now() / 1000) + 10; // 10s out
			const outcome = await Effect.gen(function* () {
				const ref = yield* RateLimitState;
				yield* Ref.set(
					ref,
					Option.some({ remaining: 10, limit: 5000, resetEpochSeconds: nearReset, observedAt: Date.now() }),
				);
				let ran = 0;
				const fiber = yield* Effect.fork(
					Effect.flatMap(RateLimiter, (svc) =>
						svc.withRateLimit(
							Effect.sync(() => {
								ran++;
								return "done";
							}),
						),
					),
				);
				// Before advancing the clock the guarded effect must not have run.
				const pollBefore = yield* Fiber.poll(fiber);
				yield* TestClock.adjust(Duration.seconds(11));
				const result = yield* Fiber.join(fiber);
				return { pollBefore, result, ran };
			}).pipe(Effect.provide(baseLayer), Effect.provide(TestContext.TestContext), Effect.runPromise);

			expect(Option.isNone(outcome.pollBefore)).toBe(true);
			expect(outcome.result).toBe("done");
			expect(outcome.ran).toBe(1);
		});

		it("fails with RateLimitError when below threshold and wait exceeds 60s", async () => {
			const farReset = Math.floor(Date.now() / 1000) + 120; // 2 minutes out
			const exit = await Effect.runPromise(
				Effect.exit(
					withSeededSnapshot(
						{ remaining: 10, limit: 5000, resetEpochSeconds: farReset, observedAt: Date.now() },
						Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))),
					),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(String(exit.cause)).toContain("RateLimitError");
			}
			// Policy is cache-driven; no probe issued.
			expect(restOperations).not.toContain("rate_limit");
		});
	});

	describe("telemetry", () => {
		const sleptCounter = rateLimitHits.pipe(Metric.tagged("api", "rest"), Metric.tagged("action", "slept"));
		const failedCounter = rateLimitHits.pipe(Metric.tagged("api", "rest"), Metric.tagged("action", "failed"));

		it("counts a rate-limit hit when it sleeps", async () => {
			const nearReset = Math.floor(Date.now() / 1000) + 10;
			const delta = await Effect.gen(function* () {
				const before = (yield* Metric.value(sleptCounter)).count;
				const ref = yield* RateLimitState;
				yield* Ref.set(
					ref,
					Option.some({ remaining: 10, limit: 5000, resetEpochSeconds: nearReset, observedAt: Date.now() }),
				);
				const fiber = yield* Effect.fork(
					Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("done"))),
				);
				yield* TestClock.adjust(Duration.seconds(11));
				yield* Fiber.join(fiber);
				const after = (yield* Metric.value(sleptCounter)).count;
				return after - before;
			}).pipe(Effect.provide(baseLayer), Effect.provide(TestContext.TestContext), Effect.runPromise);

			expect(delta).toBe(1);
		});

		it("counts a rate-limit hit when it fails fast", async () => {
			const farReset = Math.floor(Date.now() / 1000) + 120;
			const before = await Effect.runPromise(Metric.value(failedCounter));
			await Effect.runPromise(
				Effect.exit(
					withSeededSnapshot(
						{ remaining: 10, limit: 5000, resetEpochSeconds: farReset, observedAt: Date.now() },
						Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))),
					),
				),
			);
			const after = await Effect.runPromise(Metric.value(failedCounter));
			expect(after.count - before.count).toBe(1);
		});
	});

	describe("withRetry", () => {
		it("retries on failure and succeeds", async () => {
			let attempts = 0;
			const result = await run(
				Effect.flatMap(RateLimiter, (svc) =>
					svc.withRetry(
						Effect.suspend(() => {
							attempts++;
							if (attempts < 3) {
								return Effect.fail(new Error("transient"));
							}
							return Effect.succeed("recovered");
						}),
						{ maxRetries: 3, baseDelay: 10 },
					),
				),
			);
			expect(result).toBe("recovered");
			expect(attempts).toBe(3);
		});

		it("fails after exhausting retries", async () => {
			const exit = await runExit(
				Effect.flatMap(RateLimiter, (svc) =>
					svc.withRetry(Effect.fail(new Error("persistent")), {
						maxRetries: 2,
						baseDelay: 10,
					}),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});
