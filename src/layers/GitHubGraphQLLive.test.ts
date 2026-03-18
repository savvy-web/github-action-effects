import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubGraphQL } from "../services/GitHubGraphQL.js";
import { GitHubGraphQLLive } from "./GitHubGraphQLLive.js";

const makeMockGitHubClient = (
	graphqlFn: (query: string, variables?: Record<string, unknown>) => Effect.Effect<unknown, GitHubClientError>,
) =>
	Layer.succeed(GitHubClient, {
		rest: () => Effect.die("not used"),
		paginate: () => Effect.die("not used"),
		graphql: graphqlFn as (typeof GitHubClient.Service)["graphql"],
		repo: Effect.die("not used"),
	});

describe("GitHubGraphQLLive", () => {
	it("delegates query to GitHubClient.graphql", async () => {
		const mockClient = makeMockGitHubClient(() => Effect.succeed({ viewer: { login: "test" } }));
		const layer = GitHubGraphQLLive.pipe(Layer.provide(mockClient));
		const result = await Effect.runPromise(
			GitHubGraphQL.pipe(
				Effect.flatMap((gql) => gql.query("GetViewer", "{ viewer { login } }")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ viewer: { login: "test" } });
	});

	it("delegates mutation to GitHubClient.graphql", async () => {
		const mockClient = makeMockGitHubClient(() => Effect.succeed({ enableAutoMerge: { id: "1" } }));
		const layer = GitHubGraphQLLive.pipe(Layer.provide(mockClient));
		const result = await Effect.runPromise(
			GitHubGraphQL.pipe(
				Effect.flatMap((gql) => gql.mutation("EnableAutoMerge", "mutation { enableAutoMerge { id } }")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ enableAutoMerge: { id: "1" } });
	});

	it("maps GitHubClientError to GitHubGraphQLError", async () => {
		const mockClient = makeMockGitHubClient(() =>
			Effect.fail(
				new GitHubClientError({
					operation: "graphql",
					status: 401,
					reason: "Bad credentials",
					retryable: false,
				}),
			),
		);
		const layer = GitHubGraphQLLive.pipe(Layer.provide(mockClient));
		const result = await Effect.runPromise(
			GitHubGraphQL.pipe(
				Effect.flatMap((gql) => gql.query("GetViewer", "{ viewer { login } }")),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("_tag", "GitHubGraphQLError");
		expect(result).toHaveProperty("operation", "GetViewer");
		expect(result).toHaveProperty("reason", "Bad credentials");
	});

	it("extracts GraphQL errors from JSON error reason", async () => {
		const errorJson = JSON.stringify({
			errors: [{ message: "Field not found", type: "FIELD_ERROR" }],
		});
		const mockClient = makeMockGitHubClient(() =>
			Effect.fail(
				new GitHubClientError({
					operation: "graphql",
					status: 200,
					reason: errorJson,
					retryable: false,
				}),
			),
		);
		const layer = GitHubGraphQLLive.pipe(Layer.provide(mockClient));
		const result = await Effect.runPromise(
			GitHubGraphQL.pipe(
				Effect.flatMap((gql) => gql.query("GetRepo", "{ repository { name } }")),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("errors");
		const errors = (
			result as {
				errors: Array<{ message: string; type?: string }>;
			}
		).errors;
		expect(errors).toHaveLength(1);
		expect(errors[0]).toEqual({
			message: "Field not found",
			type: "FIELD_ERROR",
		});
	});
});
