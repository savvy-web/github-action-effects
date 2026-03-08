import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";

/**
 * Service interface for GitHub API operations via Octokit.
 *
 * @public
 */
export interface GitHubClient {
	/**
	 * Execute a REST API call via callback.
	 * The callback receives an Octokit instance and should return a response.
	 */
	readonly rest: <T>(
		operation: string,
		fn: (octokit: unknown) => Promise<{ data: T }>,
	) => Effect.Effect<T, GitHubClientError>;

	/**
	 * Execute a GraphQL query. Returns the response data.
	 */
	readonly graphql: <T>(query: string, variables?: Record<string, unknown>) => Effect.Effect<T, GitHubClientError>;

	/**
	 * Get the repository context (owner and repo name).
	 * Derived from GITHUB_REPOSITORY environment variable.
	 */
	readonly repo: Effect.Effect<{ owner: string; repo: string }, GitHubClientError>;
}

/**
 * GitHubClient tag for dependency injection.
 *
 * @public
 */
export const GitHubClient = Context.GenericTag<GitHubClient>("GitHubClient");
