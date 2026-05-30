import { HttpClient, HttpClientResponse } from "@effect/platform";
import {
	Cause,
	Chunk,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Metric,
	Option,
	Redacted,
	Ref,
	Stream,
	TestClock,
	TestContext,
} from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubApiCalls } from "../runtime/Telemetry.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { RateLimitState } from "../services/RateLimitState.js";
import { GitHubClientLive } from "./GitHubClientLive.js";

/**
 * Mock `HttpClient` for the `fromApp` revoke path (DELETE /installation/token).
 * Records the requests so tests can assert the revoke fired, and returns the
 * given status without touching the network.
 */
const mockHttpClient = (
	record: (method: string, url: string) => void,
	status = 204,
): Layer.Layer<HttpClient.HttpClient> =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				record(request.method, url.toString());
				return HttpClientResponse.fromWeb(request, new Response(null, { status }));
			}),
		),
	);

const { octokitAuthCalls, mockAuth } = vi.hoisted(() => ({
	octokitAuthCalls: [] as unknown[],
	mockAuth: vi.fn(),
}));
vi.mock("@octokit/rest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@octokit/rest")>();
	class RecordingOctokit extends actual.Octokit {
		constructor(options?: ConstructorParameters<typeof actual.Octokit>[0]) {
			super(options);
			octokitAuthCalls.push(options?.auth);
		}
	}
	return { ...actual, Octokit: RecordingOctokit };
});
vi.mock("@octokit/auth-app", () => ({ createAppAuth: () => mockAuth }));

beforeEach(() => {
	process.env.GITHUB_TOKEN = "fake-token";
	process.env.GITHUB_REPOSITORY = "owner/repo";
});

afterEach(() => {
	delete process.env.GITHUB_TOKEN;
	delete process.env.GITHUB_REPOSITORY;
});

describe("GitHubClientLive", () => {
	describe("fromEnv", () => {
		// Error-wrapping tests disable resilience so retryable failures fail fast;
		// retry behavior has dedicated tests under the "resilience" describe.
		const run = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) =>
			Effect.runPromise(Effect.provide(effect, GitHubClientLive.fromEnv({ enabled: false })));

		const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) =>
			Effect.runPromise(Effect.exit(Effect.provide(effect, GitHubClientLive.fromEnv({ enabled: false }))));

		it("fails when GITHUB_TOKEN is not set", async () => {
			delete process.env.GITHUB_TOKEN;
			const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.repo));
			expect(exit._tag).toBe("Failure");
		});

		describe("rest", () => {
			it("calls the callback and extracts data", async () => {
				const result = await run(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.op", () => Promise.resolve({ data: { id: 42 } }))),
				);
				expect(result).toEqual({ id: 42 });
			});

			it("wraps errors with operation name", async () => {
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.fail", () => Promise.reject(new Error("boom")))),
				);
				expect(exit._tag).toBe("Failure");
			});

			it("marks 429 status as retryable", async () => {
				const error = Object.assign(new Error("rate limited"), { status: 429 });
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.retry", () => Promise.reject(error))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const err = Cause.squash(exit.cause) as { retryable: boolean };
					expect(err.retryable).toBe(true);
				}
			});

			it("marks 500 status as retryable", async () => {
				const error = Object.assign(new Error("server error"), { status: 500 });
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.500", () => Promise.reject(error))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const err = Cause.squash(exit.cause) as { retryable: boolean };
					expect(err.retryable).toBe(true);
				}
			});

			it("marks a 403 carrying Retry-After as retryable (secondary rate limit)", async () => {
				const error = Object.assign(new Error("secondary limit"), {
					status: 403,
					response: { headers: { "retry-after": "5" } },
				});
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.403.retryAfter", () => Promise.reject(error))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const err = Cause.squash(exit.cause) as { retryable: boolean; retryAfterMs: number };
					expect(err.retryable).toBe(true);
					expect(err.retryAfterMs).toBe(5000);
				}
			});

			it("marks a 403 with x-ratelimit-remaining: 0 as retryable (secondary rate limit)", async () => {
				const reset = Math.floor(Date.now() / 1000) + 30;
				const error = Object.assign(new Error("secondary limit"), {
					status: 403,
					response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } },
				});
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.403.ratelimit", () => Promise.reject(error))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const err = Cause.squash(exit.cause) as { retryable: boolean };
					expect(err.retryable).toBe(true);
				}
			});

			it("marks a bare 403 (permission denial) as non-retryable", async () => {
				const error = Object.assign(new Error("forbidden"), { status: 403 });
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.403.bare", () => Promise.reject(error))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const err = Cause.squash(exit.cause) as { retryable: boolean };
					expect(err.retryable).toBe(false);
				}
			});

			it("sanitizes HTML error responses", async () => {
				const htmlError = Object.assign(new Error("<!DOCTYPE html><html><body>Unicorn!</body></html>"), {
					status: 500,
				});
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) => client.rest("test.html", () => Promise.reject(htmlError))),
				);
				expect(exit._tag).toBe("Failure");
				if (Exit.isFailure(exit)) {
					const error = Cause.squash(exit.cause) as { reason: string };
					expect(error.reason).toBe("GitHub API returned 500 (server error)");
					expect(error.reason).not.toContain("<!DOCTYPE");
				}
			});
		});

		describe("graphql", () => {
			it("wraps graphql errors", async () => {
				const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.graphql("{ viewer { login } }")));
				expect(exit._tag).toBe("Failure");
			});
		});

		describe("paginate", () => {
			it("collects results across multiple pages", async () => {
				let callCount = 0;
				const result = await run(
					Effect.flatMap(GitHubClient, (client) =>
						client.paginate(
							"test.paginate",
							(_octokit, page) => {
								callCount++;
								if (page === 1) return Promise.resolve({ data: [1, 2, 3] });
								if (page === 2) return Promise.resolve({ data: [4, 5, 6] });
								return Promise.resolve({ data: [7] });
							},
							{ perPage: 3 },
						),
					),
				);
				expect(callCount).toBe(3);
				expect(result).toEqual([1, 2, 3, 4, 5, 6, 7]);
			});

			it("stops when response has fewer items than perPage", async () => {
				let callCount = 0;
				const result = await run(
					Effect.flatMap(GitHubClient, (client) =>
						client.paginate(
							"test.partial",
							() => {
								callCount++;
								return Promise.resolve({ data: [1, 2] });
							},
							{ perPage: 5 },
						),
					),
				);
				expect(callCount).toBe(1);
				expect(result).toEqual([1, 2]);
			});

			it("stops when maxPages is reached", async () => {
				let callCount = 0;
				const result = await run(
					Effect.flatMap(GitHubClient, (client) =>
						client.paginate(
							"test.maxPages",
							() => {
								callCount++;
								return Promise.resolve({ data: [1, 2, 3] });
							},
							{ perPage: 3, maxPages: 2 },
						),
					),
				);
				expect(callCount).toBe(2);
				expect(result).toEqual([1, 2, 3, 1, 2, 3]);
			});

			it("wraps pagination errors", async () => {
				const exit = await runExit(
					Effect.flatMap(GitHubClient, (client) =>
						client.paginate("test.paginateErr", () => Promise.reject(new Error("page fail"))),
					),
				);
				expect(exit._tag).toBe("Failure");
			});
		});

		describe("repo", () => {
			it("parses GITHUB_REPOSITORY into owner and repo", async () => {
				const result = await run(Effect.flatMap(GitHubClient, (client) => client.repo));
				expect(result).toEqual({ owner: "owner", repo: "repo" });
			});

			it("fails when GITHUB_REPOSITORY is not set", async () => {
				delete process.env.GITHUB_REPOSITORY;
				const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.repo));
				expect(exit._tag).toBe("Failure");
			});

			it("fails when GITHUB_REPOSITORY is empty string", async () => {
				process.env.GITHUB_REPOSITORY = "";
				const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.repo));
				expect(exit._tag).toBe("Failure");
			});

			it("handles repository with no slash gracefully", async () => {
				process.env.GITHUB_REPOSITORY = "noslash";
				const result = await run(Effect.flatMap(GitHubClient, (client) => client.repo));
				expect(result).toEqual({ owner: "noslash", repo: "" });
			});
		});
	});

	describe("fromToken", () => {
		it("builds a client from a Redacted token", async () => {
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: { ok: true } }))),
					GitHubClientLive.fromToken(Redacted.make("explicit-token")),
				),
			);
			expect(result).toEqual({ ok: true });
		});

		it("does not require GITHUB_TOKEN to be set", async () => {
			delete process.env.GITHUB_TOKEN;
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: "ok" }))),
					GitHubClientLive.fromToken(Redacted.make("explicit")),
				),
			);
			expect(result).toBe("ok");
		});

		it("unwraps the Redacted token only at the Octokit boundary (S6/S11)", async () => {
			octokitAuthCalls.length = 0;
			await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: 1 }))),
					GitHubClientLive.fromToken(Redacted.make("secret-token")),
				),
			);
			expect(octokitAuthCalls).toContain("secret-token");
		});
	});

	describe("fromApp", () => {
		// fromApp is a scoped layer that revokes its token (DELETE
		// /installation/token via HttpClient) on scope close. Provide a mock
		// HttpClient so the revoke never touches the network, and wrap provides
		// in Effect.scoped.
		const revokes: Array<{ method: string; url: string }> = [];
		const httpLayer = mockHttpClient((method, url) => {
			revokes.push({ method, url });
		});
		beforeEach(() => {
			revokes.length = 0;
		});

		it("generates an installation token and builds a client", async () => {
			mockAuth.mockResolvedValue({
				token: "app-installation-token",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 42,
				permissions: { contents: "write" },
			});
			const result = await Effect.runPromise(
				Effect.scoped(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: "done" }))),
						Layer.provide(
							GitHubClientLive.fromApp({ clientId: "Iv1.abc", privateKey: Redacted.make("key"), installationId: 42 }),
							httpLayer,
						),
					),
				),
			);
			expect(result).toBe("done");
		});

		it("accepts a Redacted private key", async () => {
			mockAuth.mockResolvedValue({
				token: "app-installation-token",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 42,
				permissions: {},
			});
			const result = await Effect.runPromise(
				Effect.scoped(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: 1 }))),
						Layer.provide(
							GitHubClientLive.fromApp({
								clientId: "Iv1.abc",
								privateKey: Redacted.make("key"),
								installationId: 42,
							}),
							httpLayer,
						),
					),
				),
			);
			expect(result).toBe(1);
		});

		it("propagates GitHubAppError when token generation fails", async () => {
			mockAuth.mockRejectedValue(new Error("bad credentials"));
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.scoped(
						Effect.provide(
							Effect.flatMap(GitHubClient, (client) => client.repo),
							Layer.provide(
								GitHubClientLive.fromApp({ clientId: "Iv1.abc", privateKey: Redacted.make("key"), installationId: 42 }),
								httpLayer,
							),
						),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			if (Exit.isFailure(exit)) {
				const err = Cause.squash(exit.cause) as { _tag?: string };
				expect(err._tag).toBe("GitHubAppError");
			}
		});
	});

	describe("resilience", () => {
		/** Drive a retrying effect under TestClock so backoff sleeps are instant. */
		const runWithClock = <A, E>(effect: Effect.Effect<A, E>, advance = Duration.seconds(600)) =>
			Effect.gen(function* () {
				const fiber = yield* Effect.fork(effect);
				yield* TestClock.adjust(advance);
				return yield* Fiber.join(fiber);
			}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

		it("rest retries a transient 503 then succeeds (default-on)", async () => {
			let attempts = 0;
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () => {
							attempts++;
							if (attempts < 2) {
								return Promise.reject(Object.assign(new Error("unavailable"), { status: 503 }));
							}
							return Promise.resolve({ data: "ok" });
						}),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(exit._tag).toBe("Success");
			expect(attempts).toBe(2);
		});

		it("rest with resilience disabled does not retry", async () => {
			let attempts = 0;
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () => {
							attempts++;
							return Promise.reject(Object.assign(new Error("unavailable"), { status: 503 }));
						}),
					),
					GitHubClientLive.fromToken(Redacted.make("t"), { enabled: false }),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(attempts).toBe(1);
		});

		it("rest does not retry non-retryable (404) errors", async () => {
			let attempts = 0;
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () => {
							attempts++;
							return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
						}),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(attempts).toBe(1);
		});

		it("rest retries a 403 secondary rate limit that carries Retry-After, then succeeds", async () => {
			let attempts = 0;
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () => {
							attempts++;
							if (attempts < 2) {
								return Promise.reject(
									Object.assign(new Error("secondary limit"), {
										status: 403,
										response: { headers: { "retry-after": "5" } },
									}),
								);
							}
							return Promise.resolve({ data: "recovered" });
						}),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(exit._tag).toBe("Success");
			expect(attempts).toBe(2);
		});

		it("rest does not retry a bare 403 (permission denial)", async () => {
			let attempts = 0;
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () => {
							attempts++;
							return Promise.reject(Object.assign(new Error("forbidden"), { status: 403 }));
						}),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(attempts).toBe(1);
		});

		it("honors a Retry-After header as the retry delay", async () => {
			let attempts = 0;
			const exit = await Effect.gen(function* () {
				const fiber = yield* Effect.fork(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) =>
							client.rest("op", () => {
								attempts++;
								if (attempts < 2) {
									return Promise.reject(
										Object.assign(new Error("secondary limit"), {
											status: 429,
											response: { headers: { "retry-after": "5" } },
										}),
									);
								}
								return Promise.resolve({ data: "recovered" });
							}),
						),
						GitHubClientLive.fromToken(Redacted.make("t")),
					),
				);
				// Less than the advised 5s: still pending.
				yield* TestClock.adjust(Duration.seconds(4));
				const stillRunning = (yield* Fiber.poll(fiber))._tag === "None";
				// Past the advised delay: completes.
				yield* TestClock.adjust(Duration.seconds(2));
				const result = yield* Fiber.join(fiber);
				return { stillRunning, result };
			}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

			expect(exit._tag).toBe("Success");
			if (Exit.isSuccess(exit)) {
				expect(exit.value.stillRunning).toBe(true);
				expect(exit.value.result).toBe("recovered");
			}
			expect(attempts).toBe(2);
		});

		it("graphql failures route through the resilient wrapper", async () => {
			// graphql shares the withResilience wrapper. The mocked octokit.graphql
			// rejects without a status (network error) → non-retryable → fails fast.
			const exit = await runWithClock(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.graphql("{ viewer { login } }")),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("rate-limit snapshot", () => {
		it("records x-ratelimit headers into RateLimitState on a successful rest call", async () => {
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const ref = yield* RateLimitState;
					yield* Effect.flatMap(GitHubClient, (client) =>
						client.rest("op", () =>
							Promise.resolve({
								data: "ok",
								headers: {
									"x-ratelimit-remaining": "4321",
									"x-ratelimit-limit": "5000",
									"x-ratelimit-reset": "1700000000",
								},
							}),
						),
					);
					return yield* Ref.get(ref);
				}).pipe(Effect.provide(GitHubClientLive.fromToken(Redacted.make("t"))), Effect.provide(RateLimitState.Default)),
			);
			expect(Option.isSome(snapshot)).toBe(true);
			if (Option.isSome(snapshot)) {
				expect(snapshot.value.remaining).toBe(4321);
				expect(snapshot.value.limit).toBe(5000);
				expect(snapshot.value.resetEpochSeconds).toBe(1700000000);
			}
		});

		it("leaves the snapshot untouched when no headers are present", async () => {
			const snapshot = await Effect.runPromise(
				Effect.gen(function* () {
					const ref = yield* RateLimitState;
					yield* Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: "ok" })));
					return yield* Ref.get(ref);
				}).pipe(Effect.provide(GitHubClientLive.fromToken(Redacted.make("t"))), Effect.provide(RateLimitState.Default)),
			);
			expect(Option.isNone(snapshot)).toBe(true);
		});
	});

	describe("paginateStream", () => {
		it("emits pages lazily — Stream.take(1) fetches only page 1", async () => {
			let callCount = 0;
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						Stream.runCollect(
							client
								.paginateStream(
									"op",
									(_o, page) => {
										callCount++;
										if (page === 1) return Promise.resolve({ data: [1, 2, 3] });
										return Promise.resolve({ data: [4, 5, 6] });
									},
									{ perPage: 3 },
								)
								.pipe(Stream.take(1)),
						).pipe(Effect.map(Chunk.toReadonlyArray)),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(result).toEqual([1]);
			expect(callCount).toBe(1);
		});

		it("stops at maxPages", async () => {
			let callCount = 0;
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						Stream.runCollect(
							client.paginateStream(
								"op",
								(_o, _page) => {
									callCount++;
									return Promise.resolve({ data: [1, 2, 3] });
								},
								{ perPage: 3, maxPages: 2 },
							),
						).pipe(Effect.map(Chunk.toReadonlyArray)),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(callCount).toBe(2);
			expect(result).toEqual([1, 2, 3, 1, 2, 3]);
		});

		it("agrees with paginate on page boundaries", async () => {
			const fn = (_o: unknown, page: number) => {
				if (page === 1) return Promise.resolve({ data: [1, 2, 3] });
				if (page === 2) return Promise.resolve({ data: [4, 5, 6] });
				return Promise.resolve({ data: [7] });
			};
			const eager = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.paginate("op", fn, { perPage: 3 })),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			const streamed = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						Stream.runCollect(client.paginateStream("op", fn, { perPage: 3 })).pipe(Effect.map(Chunk.toReadonlyArray)),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(streamed).toEqual(eager);
			expect(streamed).toEqual([1, 2, 3, 4, 5, 6, 7]);
		});

		it("takeWhile stops fetching subsequent pages", async () => {
			let callCount = 0;
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						Stream.runCollect(
							client
								.paginateStream(
									"op",
									(_o, page) => {
										callCount++;
										if (page === 1) return Promise.resolve({ data: [1, 2, 3] });
										if (page === 2) return Promise.resolve({ data: [4, 5, 6] });
										return Promise.resolve({ data: [7, 8, 9] });
									},
									{ perPage: 3 },
								)
								.pipe(Stream.takeWhile((x) => x < 5)),
						).pipe(Effect.map(Chunk.toReadonlyArray)),
					),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			expect(result).toEqual([1, 2, 3, 4]);
			// page 3 is never fetched; at most 2 pages.
			expect(callCount).toBeLessThanOrEqual(2);
		});

		it("propagates errors through the stream", async () => {
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) =>
							Stream.runCollect(client.paginateStream("op", () => Promise.reject(new Error("page fail")))),
						),
						GitHubClientLive.fromToken(Redacted.make("t")),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("telemetry (item 5, on WS2's resilient client)", () => {
		it("increments the GitHub-API counter per rest call, tagged by operation + outcome", async () => {
			const successCounter = githubApiCalls.pipe(
				Metric.tagged("kind", "rest"),
				Metric.tagged("operation", "tagged.op"),
				Metric.tagged("outcome", "success"),
			);
			const before = await Effect.runPromise(Metric.value(successCounter));
			await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) => client.rest("tagged.op", () => Promise.resolve({ data: 1 }))),
					GitHubClientLive.fromToken(Redacted.make("t")),
				),
			);
			const after = await Effect.runPromise(Metric.value(successCounter));
			expect(after.count - before.count).toBe(1);
		});

		it("increments the failure-tagged counter once even across resilient retries", async () => {
			const failureCounter = githubApiCalls.pipe(
				Metric.tagged("kind", "rest"),
				Metric.tagged("operation", "retry.op"),
				Metric.tagged("outcome", "failure"),
			);
			const before = await Effect.runPromise(Metric.value(failureCounter));
			let attempts = 0;
			// Always-503 so WS2's resilience retries internally; the span/counter
			// must wrap the OUTERMOST effect so the counter ticks exactly once.
			const exit = await Effect.gen(function* () {
				const fiber = yield* Effect.fork(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) =>
							client.rest("retry.op", () => {
								attempts++;
								return Promise.reject(Object.assign(new Error("unavailable"), { status: 503 }));
							}),
						),
						GitHubClientLive.fromToken(Redacted.make("t")),
					),
				);
				yield* TestClock.adjust(Duration.seconds(600));
				return yield* Fiber.join(fiber);
			}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

			expect(exit._tag).toBe("Failure");
			expect(attempts).toBeGreaterThan(1);
			const after = await Effect.runPromise(Metric.value(failureCounter));
			expect(after.count - before.count).toBe(1);
		});
	});

	describe("fromApp scope", () => {
		it("revokes the installation token when the scope closes", async () => {
			const revoked: Array<string> = [];
			mockAuth.mockResolvedValue({
				token: "scoped-installation-token",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 42,
				permissions: {},
			});
			// The revoke (DELETE /installation/token) now goes through HttpClient.
			const httpLayer = mockHttpClient((method, url) => {
				if (method === "DELETE" && url.includes("/installation/token")) {
					revoked.push(url);
				}
			});

			await Effect.runPromise(
				Effect.scoped(
					Effect.provide(
						Effect.flatMap(GitHubClient, (client) => client.rest("op", () => Promise.resolve({ data: "done" }))),
						Layer.provide(
							GitHubClientLive.fromApp({ clientId: "Iv1.abc", privateKey: Redacted.make("key"), installationId: 42 }),
							httpLayer,
						),
					),
				),
			);

			expect(revoked.length).toBe(1);
		});

		it("Layer.memoize builds the App client once across multiple provides", async () => {
			mockAuth.mockResolvedValue({
				token: "memoized-token",
				expiresAt: "2099-01-01T00:00:00Z",
				installationId: 42,
				permissions: {},
			});
			const before = mockAuth.mock.calls.length;
			const httpLayer = mockHttpClient(() => {});

			await Effect.runPromise(
				Effect.gen(function* () {
					const shared = yield* Layer.memoize(
						Layer.provide(
							GitHubClientLive.fromApp({ clientId: "Iv1.abc", privateKey: Redacted.make("key"), installationId: 42 }),
							httpLayer,
						),
					);
					yield* Effect.flatMap(GitHubClient, (client) => client.rest("a", () => Promise.resolve({ data: 1 }))).pipe(
						Effect.provide(shared),
					);
					yield* Effect.flatMap(GitHubClient, (client) => client.rest("b", () => Promise.resolve({ data: 2 }))).pipe(
						Effect.provide(shared),
					);
				}).pipe(Effect.scoped),
			);

			// generateToken (which calls mockAuth) ran exactly once for both provides.
			expect(mockAuth.mock.calls.length - before).toBe(1);
		});
	});
});
