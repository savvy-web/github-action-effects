import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubGraphQLTest } from "../layers/GitHubGraphQLTest.js";
import { GitHubGraphQL } from "./GitHubGraphQL.js";

describe("GitHubGraphQL", () => {
	describe("query", () => {
		it("returns response for recorded query", async () => {
			const state = {
				queryResponses: new Map([["GetViewer", { viewer: { login: "test" } }]]),
				mutationResponses: new Map(),
				queryCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
				mutationCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
			};
			const layer = GitHubGraphQLTest.layer(state);
			const result = await Effect.runPromise(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) => gql.query("GetViewer", "{ viewer { login } }")),
					Effect.provide(layer),
				),
			);
			expect(result).toEqual({ viewer: { login: "test" } });
		});

		it("fails for unrecorded query", async () => {
			const { layer } = GitHubGraphQLTest.empty();
			const exit = await Effect.runPromiseExit(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) => gql.query("Unknown", "{ unknown }")),
					Effect.provide(layer),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});

		it("records query calls", async () => {
			const { state, layer } = GitHubGraphQLTest.empty();
			await Effect.runPromiseExit(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) =>
						gql.query("GetViewer", "{ viewer { login } }", {
							org: "test",
						}),
					),
					Effect.provide(layer),
				),
			);
			expect(state.queryCalls).toHaveLength(1);
			expect(state.queryCalls[0]).toEqual({
				operation: "GetViewer",
				query: "{ viewer { login } }",
				variables: { org: "test" },
			});
		});

		it("passes variables through", async () => {
			const state = {
				queryResponses: new Map([["GetRepo", { repository: { name: "test" } }]]),
				mutationResponses: new Map(),
				queryCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
				mutationCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
			};
			const layer = GitHubGraphQLTest.layer(state);
			const result = await Effect.runPromise(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) =>
						gql.query("GetRepo", "query($owner: String!) { repository(owner: $owner) { name } }", {
							owner: "test-owner",
						}),
					),
					Effect.provide(layer),
				),
			);
			expect(result).toEqual({ repository: { name: "test" } });
			expect(state.queryCalls[0]?.variables).toEqual({
				owner: "test-owner",
			});
		});
	});

	describe("mutation", () => {
		it("returns response for recorded mutation", async () => {
			const state = {
				queryResponses: new Map(),
				mutationResponses: new Map([["EnableAutoMerge", { enableAutoMerge: { id: "123" } }]]),
				queryCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
				mutationCalls: [] as Array<{
					operation: string;
					query: string;
					variables?: Record<string, unknown>;
				}>,
			};
			const layer = GitHubGraphQLTest.layer(state);
			const result = await Effect.runPromise(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) => gql.mutation("EnableAutoMerge", "mutation { enableAutoMerge { id } }")),
					Effect.provide(layer),
				),
			);
			expect(result).toEqual({ enableAutoMerge: { id: "123" } });
		});

		it("fails for unrecorded mutation", async () => {
			const { layer } = GitHubGraphQLTest.empty();
			const exit = await Effect.runPromiseExit(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) => gql.mutation("Unknown", "mutation { unknown }")),
					Effect.provide(layer),
				),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});

		it("records mutation calls", async () => {
			const { state, layer } = GitHubGraphQLTest.empty();
			await Effect.runPromiseExit(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) =>
						gql.mutation("AddLabel", "mutation { addLabel }", {
							labelId: "abc",
						}),
					),
					Effect.provide(layer),
				),
			);
			expect(state.mutationCalls).toHaveLength(1);
			expect(state.mutationCalls[0]).toEqual({
				operation: "AddLabel",
				query: "mutation { addLabel }",
				variables: { labelId: "abc" },
			});
		});

		it("error includes operation name", async () => {
			const { layer } = GitHubGraphQLTest.empty();
			const result = await Effect.runPromise(
				GitHubGraphQL.pipe(
					Effect.flatMap((gql) => gql.mutation("CreateProject", "mutation { createProject }")),
					Effect.catchAll((error) => Effect.succeed(error)),
					Effect.provide(layer),
				),
			);
			expect(result).toHaveProperty("operation", "CreateProject");
		});
	});
});
