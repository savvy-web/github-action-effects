import * as github from "@actions/github";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubClientLive } from "./GitHubClientLive.js";

const mockOctokit = vi.hoisted(() => ({
	graphql: vi.fn(),
}));

vi.mock("@actions/github", () => ({
	getOctokit: vi.fn(() => mockOctokit),
}));

beforeEach(() => {
	vi.clearAllMocks();
	process.env.GITHUB_REPOSITORY = "owner/repo";
});

afterEach(() => {
	delete process.env.GITHUB_REPOSITORY;
});

const makeLayer = () => GitHubClientLive("fake-token");

const run = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) => Effect.runPromise(Effect.provide(effect, makeLayer()));

const runExit = <A, E>(effect: Effect.Effect<A, E, GitHubClient>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, makeLayer())));

describe("GitHubClientLive", () => {
	it("creates octokit with token", async () => {
		await run(
			Effect.flatMap(GitHubClient, (client) => client.rest("test.init", (_octokit) => Promise.resolve({ data: null }))),
		);
		expect(github.getOctokit).toHaveBeenCalledWith("fake-token");
	});

	describe("rest", () => {
		it("calls the callback and extracts data", async () => {
			const result = await run(
				Effect.flatMap(GitHubClient, (client) =>
					client.rest("test.op", (_octokit) => Promise.resolve({ data: { id: 42 } })),
				),
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
		});

		it("marks 500 status as retryable", async () => {
			const error = Object.assign(new Error("server error"), { status: 500 });
			const exit = await runExit(
				Effect.flatMap(GitHubClient, (client) => client.rest("test.500", () => Promise.reject(error))),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("graphql", () => {
		it("calls octokit.graphql with query and variables", async () => {
			mockOctokit.graphql.mockResolvedValue({ viewer: { login: "user" } });
			const result = await run(
				Effect.flatMap(GitHubClient, (client) => client.graphql<{ viewer: { login: string } }>("{ viewer { login } }")),
			);
			expect(result).toEqual({ viewer: { login: "user" } });
			expect(mockOctokit.graphql).toHaveBeenCalledWith("{ viewer { login } }", {});
		});

		it("wraps graphql errors", async () => {
			mockOctokit.graphql.mockRejectedValue(new Error("graphql error"));
			const exit = await runExit(Effect.flatMap(GitHubClient, (client) => client.graphql("{ bad }")));
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
	});
});
