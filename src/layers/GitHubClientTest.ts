import { Effect, Layer } from "effect";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import type { GitHubClient } from "../services/GitHubClient.js";
import { GitHubClient as GitHubClientTag } from "../services/GitHubClient.js";

/**
 * Recorded REST response for testing.
 *
 * @public
 */
export interface RestResponse {
	readonly data: unknown;
}

/**
 * Test state for GitHubClient.
 *
 * @public
 */
export interface GitHubClientTestState {
	readonly restResponses: Map<string, RestResponse>;
	readonly graphqlResponses: Map<string, unknown>;
	readonly paginateResponses: Map<string, Array<unknown[]>>;
	readonly repo: { owner: string; repo: string };
}

const makeTestClient = (state: GitHubClientTestState): typeof GitHubClient.Service => ({
	rest: <T>(operation: string, _fn: (octokit: unknown) => Promise<{ data: T }>) => {
		const response = state.restResponses.get(operation);
		if (response === undefined) {
			return Effect.fail(
				new GitHubClientError({
					operation,
					status: 404,
					reason: `No test response recorded for operation "${operation}"`,
					retryable: false,
				}),
			);
		}
		return Effect.succeed(response.data as T);
	},

	graphql: <T>(query: string, _variables?: Record<string, unknown>) => {
		const response = state.graphqlResponses.get(query);
		if (response === undefined) {
			return Effect.fail(
				new GitHubClientError({
					operation: "graphql",
					status: undefined,
					reason: "No test response recorded for query",
					retryable: false,
				}),
			);
		}
		return Effect.succeed(response as T);
	},

	paginate: <T>(
		operation: string,
		_fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
		_options?: { perPage?: number; maxPages?: number },
	) => {
		const pages = state.paginateResponses.get(operation);
		if (!pages) {
			return Effect.fail(
				new GitHubClientError({
					operation,
					status: 404,
					reason: `No paginate responses recorded for "${operation}"`,
					retryable: false,
				}),
			);
		}
		const allData = pages.flat() as T[];
		return Effect.succeed(allData);
	},

	repo: Effect.succeed(state.repo),
});

/**
 * Test implementation for GitHubClient.
 *
 * @public
 */
export const GitHubClientTest = {
	/** Create test layer with recorded responses. */
	layer: (state: GitHubClientTestState): Layer.Layer<GitHubClient> =>
		Layer.succeed(GitHubClientTag, makeTestClient(state)),

	/** Create test layer with default repo and no recorded responses. */
	empty: (): Layer.Layer<GitHubClient> =>
		Layer.succeed(
			GitHubClientTag,
			makeTestClient({
				restResponses: new Map(),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "test-owner", repo: "test-repo" },
			}),
		),
} as const;
