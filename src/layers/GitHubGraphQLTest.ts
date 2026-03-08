import { Effect, Layer } from "effect";
import { GitHubGraphQLError } from "../errors/GitHubGraphQLError.js";
import type { GitHubGraphQL } from "../services/GitHubGraphQL.js";
import { GitHubGraphQL as GitHubGraphQLTag } from "../services/GitHubGraphQL.js";

/**
 * Test state for GitHubGraphQL.
 *
 * @public
 */
export interface GitHubGraphQLTestState {
	readonly queryResponses: Map<string, unknown>;
	readonly mutationResponses: Map<string, unknown>;
	readonly queryCalls: Array<{
		operation: string;
		query: string;
		variables?: Record<string, unknown>;
	}>;
	readonly mutationCalls: Array<{
		operation: string;
		query: string;
		variables?: Record<string, unknown>;
	}>;
}

const makeTestClient = (state: GitHubGraphQLTestState): GitHubGraphQL => ({
	query: <T>(operation: string, queryString: string, variables?: Record<string, unknown>) => {
		state.queryCalls.push({ operation, query: queryString, ...(variables !== undefined && { variables }) });
		const response = state.queryResponses.get(operation);
		if (response === undefined) {
			return Effect.fail(
				new GitHubGraphQLError({
					operation,
					reason: `No test response recorded for query "${operation}"`,
					errors: [
						{
							message: `No test response recorded for query "${operation}"`,
						},
					],
				}),
			);
		}
		return Effect.succeed(response as T);
	},

	mutation: <T>(operation: string, mutationString: string, variables?: Record<string, unknown>) => {
		state.mutationCalls.push({
			operation,
			query: mutationString,
			...(variables !== undefined && { variables }),
		});
		const response = state.mutationResponses.get(operation);
		if (response === undefined) {
			return Effect.fail(
				new GitHubGraphQLError({
					operation,
					reason: `No test response recorded for mutation "${operation}"`,
					errors: [
						{
							message: `No test response recorded for mutation "${operation}"`,
						},
					],
				}),
			);
		}
		return Effect.succeed(response as T);
	},
});

/**
 * Test implementation for GitHubGraphQL.
 *
 * @public
 */
export const GitHubGraphQLTest = {
	layer: (state: GitHubGraphQLTestState): Layer.Layer<GitHubGraphQL> =>
		Layer.succeed(GitHubGraphQLTag, makeTestClient(state)),

	empty: (): {
		state: GitHubGraphQLTestState;
		layer: Layer.Layer<GitHubGraphQL>;
	} => {
		const state: GitHubGraphQLTestState = {
			queryResponses: new Map(),
			mutationResponses: new Map(),
			queryCalls: [],
			mutationCalls: [],
		};
		return {
			state,
			layer: Layer.succeed(GitHubGraphQLTag, makeTestClient(state)),
		};
	},
} as const;
