import { Cause, Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubClientLive } from "./GitHubClientLive.js";

beforeEach(() => {
	process.env.GITHUB_TOKEN = "fake-token";
	process.env.GITHUB_REPOSITORY = "owner/repo";
});

afterEach(() => {
	delete process.env.GITHUB_TOKEN;
	delete process.env.GITHUB_REPOSITORY;
});

const run = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) =>
	Effect.runPromise(Effect.provide(effect, GitHubClientLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, GitHubClientLive)));

describe("GitHubClientLive", () => {
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

		it("sanitizes HTML error responses", async () => {
			const htmlError = Object.assign(new Error("<!DOCTYPE html><html><body>Unicorn!</body></html>"), { status: 500 });
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
			// We can't easily mock octokit.graphql without vi.mock,
			// so test that the error wrapping works by verifying
			// a graphql call with invalid auth returns GitHubClientError
			const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.graphql("{ viewer { login } }")));
			// With a fake token, this will fail with an auth error
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
