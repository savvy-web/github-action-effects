import { Cause, Duration, Effect, Exit, Fiber, Layer, TestClock, TestContext } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitBranch } from "../services/GitBranch.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitBranchLive } from "./GitBranchLive.js";

const mockCreateRef = vi.fn();
const mockGetRef = vi.fn();
const mockDeleteRef = vi.fn();
const mockUpdateRef = vi.fn();

const mockClient: typeof GitHubClient.Service = {
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createRef: mockCreateRef,
							getRef: mockGetRef,
							deleteRef: mockDeleteRef,
							updateRef: mockUpdateRef,
						},
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

const makeMockClient = (): typeof GitHubClient.Service => ({
	rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
		Effect.tryPromise({
			try: () =>
				fn({
					rest: {
						git: {
							createRef: mockCreateRef,
							getRef: mockGetRef,
							deleteRef: mockDeleteRef,
							updateRef: mockUpdateRef,
						},
					},
				}),
			catch: (e) => {
				const status =
					typeof e === "object" && e !== null && "status" in e ? (e as { status: number }).status : undefined;
				let message = e instanceof Error ? e.message : String(e);
				if (message.includes("<!DOCTYPE") || message.includes("<html")) {
					message =
						status !== undefined
							? `GitHub API returned ${status} (server error)`
							: "GitHub API returned an HTML error page";
				}
				return new GitHubClientError({
					operation: _operation,
					status,
					reason: message,
					retryable: status !== undefined && (status === 429 || status >= 500),
				});
			},
		}).pipe(Effect.map((r) => r.data)),
	graphql: () => Effect.die("not used"),
	paginate: () => Effect.die("not used"),
	repo: Effect.succeed({ owner: "test-owner", repo: "test-repo" }),
});

const testLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, mockClient));

const run = <A, E>(effect: Effect.Effect<A, E, GitBranch>) => Effect.runPromise(Effect.provide(effect, testLayer));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitBranch>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, testLayer)));

/** Run an effect that uses retries with TestClock so delays are instant. */
const runWithTestClock = <A, E>(
	effect: Effect.Effect<A, E, GitBranch>,
	retryLayer: Layer.Layer<GitBranch, never, never>,
): Promise<Exit.Exit<A, E>> =>
	Effect.gen(function* () {
		const fiber = yield* Effect.fork(Effect.provide(effect, retryLayer));
		// Advance clock enough to cover all retry delays (1s + 2s + 4s = 7s)
		yield* TestClock.adjust(Duration.seconds(10));
		return yield* Fiber.join(fiber);
	}).pipe(Effect.exit, Effect.provide(TestContext.TestContext), Effect.runPromise);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GitBranchLive", () => {
	describe("create", () => {
		it("calls git.createRef with correct args", async () => {
			mockCreateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.create("feature/new", "abc123")));
			expect(mockCreateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "refs/heads/feature/new",
					sha: "abc123",
				}),
			);
		});

		it("fails on API error", async () => {
			mockCreateRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.create("branch", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("exists", () => {
		it("returns true when ref exists", async () => {
			mockGetRef.mockResolvedValue({ data: { object: { sha: "abc" } } });
			const result = await run(Effect.flatMap(GitBranch, (svc) => svc.exists("main")));
			expect(result).toBe(true);
			expect(mockGetRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
				}),
			);
		});

		it("returns false on 404", async () => {
			mockGetRef.mockRejectedValue(new Error("Not Found"));
			const mockClientWith404: typeof GitHubClient.Service = {
				...mockClient,
				rest: <T>(_operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
					Effect.tryPromise({
						try: () =>
							fn({
								rest: {
									git: {
										createRef: mockCreateRef,
										getRef: mockGetRef,
										deleteRef: mockDeleteRef,
										updateRef: mockUpdateRef,
									},
								},
							}),
						catch: () =>
							new GitHubClientError({
								operation: _operation,
								status: 404,
								reason: "Not Found",
								retryable: false,
							}),
					}).pipe(Effect.map((r) => r.data)),
			};
			const layer404 = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, mockClientWith404));
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(GitBranch, (svc) => svc.exists("missing")),
					layer404,
				),
			);
			expect(result).toBe(false);
		});
	});

	describe("delete", () => {
		it("calls git.deleteRef with correct args", async () => {
			mockDeleteRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.delete("feature/old")));
			expect(mockDeleteRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/feature/old",
				}),
			);
		});
	});

	describe("getSha", () => {
		it("returns the SHA from the ref", async () => {
			mockGetRef.mockResolvedValue({ data: { object: { sha: "def456" } } });
			const result = await run(Effect.flatMap(GitBranch, (svc) => svc.getSha("main")));
			expect(result).toBe("def456");
		});

		it("fails on API error", async () => {
			mockGetRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.getSha("missing")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("reset", () => {
		it("calls git.updateRef with force: true", async () => {
			mockUpdateRef.mockResolvedValue({ data: {} });
			await run(Effect.flatMap(GitBranch, (svc) => svc.reset("main", "new-sha")));
			expect(mockUpdateRef).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "test-owner",
					repo: "test-repo",
					ref: "heads/main",
					sha: "new-sha",
					force: true,
				}),
			);
		});

		it("fails on API error", async () => {
			mockUpdateRef.mockRejectedValue(new Error("api error"));
			const exit = await runExit(Effect.flatMap(GitBranch, (svc) => svc.reset("branch", "sha")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("retry on transient errors", () => {
		it("retries delete on transient 500 error then succeeds", async () => {
			mockDeleteRef
				.mockRejectedValueOnce(Object.assign(new Error("Server Error"), { status: 500 }))
				.mockResolvedValueOnce({ data: {} });

			const retryClient = makeMockClient();
			const retryLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, retryClient));

			const exit = await runWithTestClock(
				Effect.flatMap(GitBranch, (svc) => svc.delete("feature/old")),
				retryLayer,
			);
			expect(exit._tag).toBe("Success");
			expect(mockDeleteRef).toHaveBeenCalledTimes(2);
		});

		it("gives up after max retries on persistent 500", async () => {
			mockDeleteRef.mockRejectedValue(Object.assign(new Error("Server Error"), { status: 500 }));

			const retryClient = makeMockClient();
			const retryLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, retryClient));

			const exit = await runWithTestClock(
				Effect.flatMap(GitBranch, (svc) => svc.delete("feature/old")),
				retryLayer,
			);
			expect(exit._tag).toBe("Failure");
			// 1 initial + 3 retries = 4 total calls
			expect(mockDeleteRef).toHaveBeenCalledTimes(4);
		});

		it("does not retry on non-retryable errors (e.g., 404)", async () => {
			mockDeleteRef.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));

			const retryClient = makeMockClient();
			const retryLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, retryClient));

			const exit = await runWithTestClock(
				Effect.flatMap(GitBranch, (svc) => svc.delete("branch")),
				retryLayer,
			);
			expect(exit._tag).toBe("Failure");
			expect(mockDeleteRef).toHaveBeenCalledTimes(1);
		});

		it("retries create on transient 500 error", async () => {
			mockCreateRef
				.mockRejectedValueOnce(Object.assign(new Error("Server Error"), { status: 500 }))
				.mockResolvedValueOnce({ data: {} });

			const retryClient = makeMockClient();
			const retryLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, retryClient));

			const exit = await runWithTestClock(
				Effect.flatMap(GitBranch, (svc) => svc.create("new-branch", "sha123")),
				retryLayer,
			);
			expect(exit._tag).toBe("Success");
			expect(mockCreateRef).toHaveBeenCalledTimes(2);
		});
	});

	describe("HTML error handling", () => {
		it("produces clean error for HTML 500 responses", async () => {
			const htmlError = Object.assign(new Error("<!DOCTYPE html><html><body>Unicorn!</body></html>"), { status: 500 });
			mockDeleteRef.mockRejectedValue(htmlError);

			const htmlClient = makeMockClient();
			const htmlLayer = Layer.provide(GitBranchLive, Layer.succeed(GitHubClient, htmlClient));

			const exit = await runWithTestClock(
				Effect.flatMap(GitBranch, (svc) => svc.delete("branch")),
				htmlLayer,
			);
			expect(exit._tag).toBe("Failure");
			if (Exit.isFailure(exit)) {
				const error = Cause.squash(exit.cause);
				expect((error as { reason: string }).reason).toBe("GitHub API returned 500 (server error)");
				expect((error as { reason: string }).reason).not.toContain("<!DOCTYPE");
			}
		});
	});
});
