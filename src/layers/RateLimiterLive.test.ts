import { Effect, Exit, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value needed for Layer.succeed
import { GitHubClient } from "../services/GitHubClient.js";
import { RateLimiter } from "../services/RateLimiter.js";
import { RateLimiterLive } from "./RateLimiterLive.js";

const mockRateLimitGet = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						rateLimit: { get: mockRateLimitGet },
					},
				}),
			catch: (e) =>
				new GitHubClientError({
					operation: _operation,
					status: undefined,
					reason: e instanceof Error ? e.message : String(e),
					retryable: false,
				}),
		}).pipe(Effect.map((r) => r.data)),
	graphql: () => Effect.die("not used"),
	paginate: () => Effect.die("not used"),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
};

const testLayer = Layer.provide(RateLimiterLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, RateLimiter>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, RateLimiter>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("RateLimiterLive", () => {
	describe("checkRest", () => {
		it("calls GitHub API and maps core resource", async () => {
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
			expect(mockRateLimitGet).toHaveBeenCalledTimes(1);
		});

		it("fails on API error", async () => {
			mockRateLimitGet.mockRejectedValue(new Error("network error"));
			const exit = await runExit(Effect.flatMap(RateLimiter, (svc) => svc.checkRest()));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("checkGraphQL", () => {
		it("calls GitHub API and maps graphql resource", async () => {
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
	});

	describe("withRateLimit", () => {
		it("runs effect when rate limit is healthy", async () => {
			mockRateLimitGet.mockResolvedValue({
				data: {
					resources: {
						core: { limit: 5000, remaining: 4000, reset: 1700000000, used: 1000 },
						graphql: { limit: 5000, remaining: 5000, reset: 1700000000, used: 0 },
					},
				},
			});

			const result = await run(Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))));
			expect(result).toBe("ok");
		});

		it("fails with RateLimitError when near limit and wait exceeds 60s", async () => {
			const futureReset = Math.floor(Date.now() / 1000) + 120; // 2 minutes from now
			mockRateLimitGet.mockResolvedValue({
				data: {
					resources: {
						core: { limit: 5000, remaining: 10, reset: futureReset, used: 4990 },
						graphql: { limit: 5000, remaining: 5000, reset: futureReset, used: 0 },
					},
				},
			});

			const exit = await runExit(Effect.flatMap(RateLimiter, (svc) => svc.withRateLimit(Effect.succeed("ok"))));

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = exit.cause;
				expect(String(error)).toContain("RateLimitError");
			}
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
