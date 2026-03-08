import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import type { GitHubClientTestState } from "../layers/GitHubClientTest.js";
import { GitHubClientTest } from "../layers/GitHubClientTest.js";
import type { GitHubClient as GitHubClientService } from "./GitHubClient.js";
import { GitHubClient } from "./GitHubClient.js";

// -- Shared provide helper --

const provide = <A, E>(state: GitHubClientTestState, effect: Effect.Effect<A, E, GitHubClientService>) =>
	Effect.provide(effect, GitHubClientTest.layer(state));

const provideEmpty = <A, E>(effect: Effect.Effect<A, E, GitHubClientService>) =>
	Effect.provide(effect, GitHubClientTest.empty());

const run = <A, E>(state: GitHubClientTestState, effect: Effect.Effect<A, E, GitHubClientService>) =>
	Effect.runPromise(provide(state, effect));

const runEmpty = <A, E>(effect: Effect.Effect<A, E, GitHubClientService>) => Effect.runPromise(provideEmpty(effect));

const runExitEmpty = <A, E>(effect: Effect.Effect<A, E, GitHubClientService>) =>
	Effect.runPromise(Effect.exit(provideEmpty(effect)));

// -- Service method shorthands --

const rest = <T>(operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
	Effect.flatMap(GitHubClient, (svc) => svc.rest(operation, fn));

const graphql = <T>(query: string, variables?: Record<string, unknown>) =>
	Effect.flatMap(GitHubClient, (svc) => svc.graphql<T>(query, variables));

const repo = Effect.flatMap(GitHubClient, (svc) => svc.repo);

describe("GitHubClient", () => {
	describe("rest", () => {
		it("returns data from recorded response", async () => {
			const state: GitHubClientTestState = {
				restResponses: new Map([["repos.get", { data: { full_name: "owner/repo" } }]]),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "test-owner", repo: "test-repo" },
			};

			const result = await run(
				state,
				rest("repos.get", async () => ({ data: { full_name: "ignored" } })),
			);
			expect(result).toEqual({ full_name: "owner/repo" });
		});

		it("fails on unrecorded operation", async () => {
			const exit = await runExitEmpty(rest("repos.get", async () => ({ data: {} })));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = exit.cause;
				expect(String(error)).toContain("GitHubClientError");
			}
		});
	});

	describe("graphql", () => {
		it("returns data from recorded response", async () => {
			const query = "query { viewer { login } }";
			const state: GitHubClientTestState = {
				restResponses: new Map(),
				graphqlResponses: new Map([[query, { viewer: { login: "test-user" } }]]),
				paginateResponses: new Map(),
				repo: { owner: "test-owner", repo: "test-repo" },
			};

			const result = await run(state, graphql<{ viewer: { login: string } }>(query));
			expect(result).toEqual({ viewer: { login: "test-user" } });
		});

		it("fails on unrecorded query", async () => {
			const exit = await runExitEmpty(graphql("query { viewer { login } }"));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe("repo", () => {
		it("returns owner and repo from test state", async () => {
			const state: GitHubClientTestState = {
				restResponses: new Map(),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "my-org", repo: "my-repo" },
			};

			const result = await run(state, repo);
			expect(result).toEqual({ owner: "my-org", repo: "my-repo" });
		});

		it("returns defaults from empty()", async () => {
			const result = await runEmpty(repo);
			expect(result).toEqual({ owner: "test-owner", repo: "test-repo" });
		});
	});

	describe("GitHubClientError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new GitHubClientError({
				operation: "repos.get",
				status: 404,
				reason: "Not Found",
				retryable: false,
			});
			expect(error._tag).toBe("GitHubClientError");
			expect(error.operation).toBe("repos.get");
			expect(error.status).toBe(404);
			expect(error.reason).toBe("Not Found");
			expect(error.retryable).toBe(false);
		});

		it("has retryable flag for rate limits", () => {
			const error = new GitHubClientError({
				operation: "repos.list",
				status: 429,
				reason: "Rate limit exceeded",
				retryable: true,
			});
			expect(error.retryable).toBe(true);
		});

		it("supports undefined status", () => {
			const error = new GitHubClientError({
				operation: "graphql",
				status: undefined,
				reason: "Network error",
				retryable: false,
			});
			expect(error.status).toBeUndefined();
		});
	});
});
