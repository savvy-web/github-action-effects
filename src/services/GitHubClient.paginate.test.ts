import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClientTest } from "../layers/GitHubClientTest.js";
import { GitHubClient } from "./GitHubClient.js";

const makeLayer = (paginateResponses: Map<string, Array<unknown[]>>) =>
	GitHubClientTest.layer({
		restResponses: new Map(),
		graphqlResponses: new Map(),
		paginateResponses,
		repo: { owner: "test-owner", repo: "test-repo" },
	});

describe("GitHubClient.paginate", () => {
	it("paginates until empty page", async () => {
		const layer = makeLayer(new Map([["listRepos", [[{ id: 1 }, { id: 2 }], [{ id: 3 }]]]]));
		const result = await Effect.runPromise(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("listRepos", async () => ({ data: [] }))),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
	});

	it("returns empty array for zero results", async () => {
		const layer = makeLayer(new Map([["empty", [[]]]]));
		const result = await Effect.runPromise(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("empty", async () => ({ data: [] }))),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([]);
	});

	it("concatenates multiple pages correctly", async () => {
		const layer = makeLayer(
			new Map([
				[
					"items",
					[
						[1, 2, 3],
						[4, 5, 6],
						[7, 8],
					],
				],
			]),
		);
		const result = await Effect.runPromise(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("items", async () => ({ data: [] }))),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("handles single-page result", async () => {
		const layer = makeLayer(new Map([["single", [[{ name: "only-item" }]]]]));
		const result = await Effect.runPromise(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("single", async () => ({ data: [] }))),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([{ name: "only-item" }]);
	});

	it("fails when no paginate responses recorded", async () => {
		const layer = GitHubClientTest.empty();
		const exit = await Effect.runPromiseExit(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("unknown", async () => ({ data: [] }))),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("reports errors with operation context", async () => {
		const layer = GitHubClientTest.empty();
		const result = await Effect.runPromise(
			GitHubClient.pipe(
				Effect.flatMap((client) => client.paginate("listPRs", async () => ({ data: [] }))),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("operation", "listPRs");
		expect(result).toHaveProperty("reason");
		expect((result as { reason: string }).reason).toContain("listPRs");
	});
});
